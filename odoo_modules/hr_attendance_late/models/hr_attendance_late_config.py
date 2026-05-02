from odoo import models, fields, api, _
import math


class AttendanceLateConfig(models.Model):
    _name = 'hr.attendance.late.config'
    _description = 'Attendance Late Tracking Configuration'
    _rec_name = 'display_name'

    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
        required=True,
    )
    department_id = fields.Many2one(
        'hr.department',
        string='Department',
        help='Leave empty for company-wide setting. Set to apply only to this department.',
    )

    # --- Shift Type ---
    shift_type = fields.Selection([
        ('single', 'Single Shift'),
        ('split', 'Split Shift'),
    ], string='Shift Type', default='single', required=True,
       help='Single: one continuous work period. Split: two work periods with a break (e.g., morning + afternoon).')

    # --- Session 1 (always used) ---
    office_start_hour = fields.Float(
        string='Session 1 Start',
        default=8.0,
        help='First session start time in 24h format.',
    )
    office_end_hour = fields.Float(
        string='Session 1 End',
        default=17.0,
        help='First session end time in 24h format.',
    )

    # --- Session 2 (only for split shift) ---
    office_start_hour_2 = fields.Float(
        string='Session 2 Start',
        default=14.0,
        help='Second session start time (split shift only).',
    )
    office_end_hour_2 = fields.Float(
        string='Session 2 End',
        default=18.0,
        help='Second session end time (split shift only).',
    )

    late_threshold_minutes = fields.Integer(
        string='Late Threshold (Minutes)',
        default=15,
        help='Minutes after session start time before marking as late.',
    )

    # --- Grace: now "times" not "days" ---
    grace_late_times = fields.Integer(
        string='Grace Late Times Per Month',
        default=5,
        help='Number of late TIMES per month, PER SESSION, before deductions apply. '
             'Session 1 and Session 2 each maintain their own independent grace counter — '
             'e.g. with grace=1, the first Session 1 late AND the first Session 2 late '
             'of the month are both free; deductions kick in from the 2nd occurrence '
             'in either session.',
    )

    # --- Deduction Mode ---
    deduction_mode = fields.Selection([
        ('fixed', 'Fixed Amount (Slab-based)'),
        ('hourly', 'Hourly Wage Calculation'),
    ], string='Deduction Mode', default='fixed', required=True,
       help='Fixed: use deduction slab amounts. '
            'Hourly: auto-calculate based on employee wage, working days, and daily hours.')

    # --- Working Days Configuration ---
    work_monday = fields.Boolean(string='Monday', default=True)
    work_tuesday = fields.Boolean(string='Tuesday', default=True)
    work_wednesday = fields.Boolean(string='Wednesday', default=True)
    work_thursday = fields.Boolean(string='Thursday', default=True)
    work_friday = fields.Boolean(string='Friday', default=True)
    work_saturday = fields.Boolean(string='Saturday', default=True)
    work_sunday = fields.Boolean(string='Sunday', default=False)

    # --- Half-Day Friday Configuration ---
    half_day_friday_enabled = fields.Boolean(
        string='Enable Half-Day Fridays',
        default=False,
    )
    half_day_friday_positions = fields.Char(
        string='Half-Day Friday Positions',
        default='2,4',
        help='Comma-separated positions of Fridays that are half-day. '
             'E.g., "2,4" means 2nd and 4th Friday of every month.',
    )
    half_day_start_hour = fields.Float(
        string='Half-Day Start Time',
        default=17.0,
    )
    half_day_end_hour = fields.Float(
        string='Half-Day End Time',
        default=21.0,
    )

    active = fields.Boolean(default=True)

    # --- Computed: daily hours for hourly calc ---
    daily_work_hours = fields.Float(
        string='Daily Work Hours',
        compute='_compute_daily_work_hours',
        store=True,
        help='Total daily working hours (auto-calculated from session times).',
    )

    @api.depends('office_start_hour', 'office_end_hour', 'shift_type',
                 'office_start_hour_2', 'office_end_hour_2')
    def _compute_daily_work_hours(self):
        for rec in self:
            session1 = max(0, rec.office_end_hour - rec.office_start_hour)
            if rec.shift_type == 'split':
                session2 = max(0, rec.office_end_hour_2 - rec.office_start_hour_2)
                rec.daily_work_hours = session1 + session2
            else:
                rec.daily_work_hours = session1

    @api.depends('company_id', 'department_id')
    def _compute_display_name(self):
        for rec in self:
            if rec.department_id:
                rec.display_name = f'{rec.company_id.name} / {rec.department_id.name}'
            else:
                rec.display_name = f'{rec.company_id.name} (Company-wide)'

    def get_working_days_list(self):
        """Return list of weekday integers (0=Monday..6=Sunday) that are working days."""
        self.ensure_one()
        days = []
        if self.work_monday:
            days.append(0)
        if self.work_tuesday:
            days.append(1)
        if self.work_wednesday:
            days.append(2)
        if self.work_thursday:
            days.append(3)
        if self.work_friday:
            days.append(4)
        if self.work_saturday:
            days.append(5)
        if self.work_sunday:
            days.append(6)
        return days

    def get_half_day_friday_positions(self):
        self.ensure_one()
        if not self.half_day_friday_enabled or not self.half_day_friday_positions:
            return []
        try:
            return [int(x.strip()) for x in self.half_day_friday_positions.split(',') if x.strip()]
        except (ValueError, AttributeError):
            return []

    @api.model
    def is_half_day_friday(self, check_date, employee_id=None):
        if check_date.weekday() != 4:
            return False

        config_data = self.get_config_for_employee(employee_id) if employee_id else {}
        config_id = config_data.get('id')
        if not config_id:
            return False

        config = self.browse(config_id)
        if not config.exists() or not config.half_day_friday_enabled:
            return False

        positions = config.get_half_day_friday_positions()
        if not positions:
            return False

        day = check_date.day
        friday_count = 0
        for d in range(1, day + 1):
            test_date = check_date.replace(day=d)
            if test_date.weekday() == 4:
                friday_count += 1

        return friday_count in positions

    @api.model
    def is_working_day(self, check_date, employee_id):
        config_data = self.get_config_for_employee(employee_id)
        working_days = config_data.get('working_days', [0, 1, 2, 3, 4, 5])

        if check_date.weekday() not in working_days:
            return False

        Holiday = self.env['hr.public.holiday']
        employee = self.env['hr.employee'].browse(employee_id)
        company_id = employee.company_id.id if employee.exists() else self.env.company.id
        if Holiday.is_public_holiday(check_date, company_id):
            return False

        return True

    def get_working_days_in_month(self, year, month, company_id):
        """Calculate total working days in a given month based on config and holidays."""
        self.ensure_one()
        import calendar
        from datetime import date as dt_date
        working_days_list = self.get_working_days_list()
        Holiday = self.env['hr.public.holiday']

        total = 0
        days_in_month = calendar.monthrange(year, month)[1]
        for day_num in range(1, days_in_month + 1):
            d = dt_date(year, month, day_num)
            if d.weekday() in working_days_list:
                if not Holiday.is_public_holiday(d, company_id):
                    total += 1
        return total

    def get_hourly_deduction(self, employee_id, late_minutes, late_date=None):
        """Calculate deduction based on employee's hourly wage.
        Working days are auto-calculated from config + holidays for the month.
        Each started hour of lateness = 1 hour deduction.
        """
        self.ensure_one()
        from datetime import date as dt_date
        employee = self.env['hr.employee'].browse(employee_id)
        if not employee.exists():
            return 0.0

        # Wage lookup priority:
        #   1. running contract's wage (employee.contract_wage)
        #   2. direct employee.wage field set on the employee form
        # Falling back to employee.wage means HR doesn't have to maintain a
        # Running contract just to drive late-deduction maths — typing the
        # wage on the employee's Payroll tab is enough.
        wage = 0.0
        for fname in ('contract_wage', 'wage'):
            try:
                v = getattr(employee, fname, 0.0) or 0.0
                if v > 0:
                    wage = v
                    break
            except Exception:
                continue

        if wage <= 0 or self.daily_work_hours <= 0:
            return 0.0

        # Auto-calculate working days for the month
        if late_date:
            year, month = late_date.year, late_date.month
        else:
            today = dt_date.today()
            year, month = today.year, today.month

        working_days = self.get_working_days_in_month(year, month, employee.company_id.id)
        if working_days <= 0:
            return 0.0

        hourly_rate = wage / working_days / self.daily_work_hours

        # Each started hour counts as full hour deduction
        late_hours = math.ceil(late_minutes / 60.0)
        return round(hourly_rate * late_hours, 2)

    @api.model
    def get_config_for_employee(self, employee_id):
        employee = self.env['hr.employee'].browse(employee_id)
        defaults = {
            'office_start_hour': 8.0,
            'office_end_hour': 17.0,
            'shift_type': 'single',
            'office_start_hour_2': 14.0,
            'office_end_hour_2': 18.0,
            'late_threshold_minutes': 15,
            'grace_late_times': 5,
            'deduction_mode': 'fixed',
            'daily_work_hours': 9.0,
            'half_day_friday_enabled': False,
            'half_day_friday_positions': '2,4',
            'half_day_start_hour': 17.0,
            'half_day_end_hour': 21.0,
            'working_days': [0, 1, 2, 3, 4, 5],
        }
        if not employee.exists():
            return defaults

        config = self.search([
            ('company_id', '=', employee.company_id.id),
            ('department_id', '=', employee.department_id.id),
        ], limit=1)

        if not config:
            config = self.search([
                ('company_id', '=', employee.company_id.id),
                ('department_id', '=', False),
            ], limit=1)

        if not config:
            return defaults

        return {
            'id': config.id,
            'office_start_hour': config.office_start_hour,
            'office_end_hour': config.office_end_hour,
            'shift_type': config.shift_type,
            'office_start_hour_2': config.office_start_hour_2,
            'office_end_hour_2': config.office_end_hour_2,
            'late_threshold_minutes': config.late_threshold_minutes,
            'grace_late_times': config.grace_late_times,
            'deduction_mode': config.deduction_mode,
            'daily_work_hours': config.daily_work_hours,
            'half_day_friday_enabled': config.half_day_friday_enabled,
            'half_day_friday_positions': config.half_day_friday_positions,
            'half_day_start_hour': config.half_day_start_hour,
            'half_day_end_hour': config.half_day_end_hour,
            'working_days': config.get_working_days_list(),
            # Keep backward compat
            'grace_late_days': config.grace_late_times,
        }

    @api.model
    def get_config_record_for_employee(self, employee_id):
        employee = self.env['hr.employee'].browse(employee_id)
        if not employee.exists():
            return self.browse()

        config = self.search([
            ('company_id', '=', employee.company_id.id),
            ('department_id', '=', employee.department_id.id),
        ], limit=1)

        if not config:
            config = self.search([
                ('company_id', '=', employee.company_id.id),
                ('department_id', '=', False),
            ], limit=1)

        return config or self.browse()

    # --- Recompute hooks ---

    def _recompute_affected_attendances(self):
        """Force-recompute stored late-tracking fields on attendance records
        whose configuration may have been affected by changes to this config.
        Walks the rolling 3-month window so stale stored values (e.g. wrong
        deduction because wage was missing at compute time) get refreshed.
        """
        from datetime import date as dt_date
        from dateutil.relativedelta import relativedelta
        Att = self.env['hr.attendance']
        today = dt_date.today()
        date_from = today - relativedelta(months=3)
        for cfg in self:
            domain = [('date', '>=', date_from), ('date', '<=', today)]
            if cfg.company_id:
                domain.append(('employee_id.company_id', '=', cfg.company_id.id))
            if cfg.department_id:
                domain.append(('employee_id.department_id', '=', cfg.department_id.id))
            recs = Att.search(domain)
            if not recs:
                continue
            # Trigger every stored compute that depends on lateness, flushing
            # between steps so that downstream searches (notably
            # `_compute_late_sequence`, which counts sibling late records via
            # `self.search([('is_late','=',True), ...])`) see the values
            # written by the previous compute. Without these flushes the
            # search runs against pre-compute DB state, returns 0 siblings,
            # and the deduction stays 0 forever.
            recs._compute_is_first_checkin_of_day()
            recs.flush_recordset()
            recs._compute_late_info()
            recs.flush_recordset()
            recs._compute_late_minutes_display()
            recs._compute_late_sequence()
            recs.flush_recordset()
            recs._compute_deduction_amount()
            recs.flush_recordset()

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        recs._recompute_affected_attendances()
        return recs

    def write(self, vals):
        res = super().write(vals)
        # Only recompute when a rule-affecting field changed.
        recompute_fields = {
            'office_start_hour', 'office_end_hour', 'office_start_hour_2',
            'office_end_hour_2', 'shift_type', 'late_threshold_minutes',
            'grace_late_times', 'deduction_mode', 'daily_work_hours',
            'half_day_friday_enabled', 'half_day_friday_positions',
            'half_day_start_hour', 'half_day_end_hour', 'company_id',
            'department_id', 'active',
        }
        if recompute_fields & set(vals.keys()):
            self._recompute_affected_attendances()
        return res

