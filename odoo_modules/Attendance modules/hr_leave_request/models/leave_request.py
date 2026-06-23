from odoo import models, fields, api, exceptions
import calendar
from datetime import datetime, timedelta
import logging

_logger = logging.getLogger(__name__)


class LeaveRequest(models.Model):
    _name = "hr.leave.request"
    _description = "Leave Request"
    _order = "from_date desc, create_date desc"
    _rec_name = "display_name"

    # --- Core Fields ---
    hr_employee_id = fields.Many2one(
        'hr.employee',
        string='Employee',
        required=True,
        readonly=True,
        states={'draft': [('readonly', False)]},
    )
    employee_user_id = fields.Many2one(
        'res.users',
        string='Related User',
        related='hr_employee_id.user_id',
        store=True,
        readonly=True,
    )
    employee_name = fields.Char(
        string='Employee Name',
        related='hr_employee_id.name',
        store=True,
    )

    # --- Leave Details ---
    leave_type = fields.Selection([
        ('sick', 'Sick Leave'),
        ('casual', 'Casual Leave'),
        ('annual', 'Annual Leave'),
        ('personal', 'Personal Leave'),
        ('emergency', 'Emergency Leave'),
        ('other', 'Other'),
    ], string='Leave Type', required=True, default='casual',
       readonly=True, states={'draft': [('readonly', False)]})

    from_date = fields.Date(
        string='From Date',
        required=True,
        readonly=True,
        states={'draft': [('readonly', False)]},
    )
    to_date = fields.Date(
        string='To Date',
        readonly=True,
        states={'draft': [('readonly', False)]},
        help='Leave empty for single day leave.',
    )
    is_half_day = fields.Boolean(
        string='Half Day',
        default=False,
        readonly=True,
        states={'draft': [('readonly', False)]},
        help='Check for half day leave (0.5 day).',
    )
    reason = fields.Text(
        string='Reason for Leave',
        required=True,
        readonly=True,
        states={'draft': [('readonly', False)], 'pending': [('readonly', False)]},
    )
    number_of_days = fields.Float(
        string='Number of Days',
        compute='_compute_number_of_days',
        store=True,
    )

    # --- Paid / Unpaid ---
    is_paid = fields.Boolean(
        string='Fully Paid',
        compute='_compute_paid_status',
        store=True,
        help='True if entire leave is within paid quota.',
    )
    paid_days = fields.Float(
        string='Paid Days',
        compute='_compute_paid_status',
        store=True,
        help='Number of days covered by paid leave quota.',
    )
    unpaid_days = fields.Float(
        string='Unpaid Days',
        compute='_compute_paid_status',
        store=True,
        help='Number of days exceeding paid leave quota.',
    )
    deduction_amount = fields.Float(
        string='Deduction Amount',
        compute='_compute_paid_status',
        store=True,
        help='Amount to deduct for unpaid days.',
    )

    # --- State Machine ---
    state = fields.Selection([
        ('draft', 'Draft'),
        ('pending', 'Pending Approval'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('cancelled', 'Cancelled'),
    ], string='Status', default='draft', required=True, tracking=True)

    # --- Approval Fields ---
    approved_by = fields.Many2one(
        'res.users',
        string='Approved/Rejected By',
        readonly=True,
    )
    approval_date = fields.Datetime(
        string='Approval Date',
        readonly=True,
    )
    rejection_reason = fields.Text(
        string='Rejection Reason',
        readonly=True,
    )

    # --- Display ---
    display_name = fields.Char(
        compute='_compute_display_name',
        store=True,
    )

    # --- Computed Fields ---

    @api.depends('hr_employee_id', 'from_date', 'leave_type')
    def _compute_display_name(self):
        type_labels = dict(self._fields['leave_type'].selection)
        for rec in self:
            name = rec.hr_employee_id.name or 'New'
            date_str = str(rec.from_date) if rec.from_date else ''
            leave_label = type_labels.get(rec.leave_type, '')
            rec.display_name = f"{leave_label} - {name} - {date_str}"

    @api.depends('from_date', 'to_date', 'is_half_day')
    def _compute_number_of_days(self):
        for rec in self:
            if rec.from_date:
                if rec.is_half_day:
                    rec.number_of_days = 0.5
                elif rec.to_date and rec.to_date >= rec.from_date:
                    rec.number_of_days = (rec.to_date - rec.from_date).days + 1
                else:
                    rec.number_of_days = 1
            else:
                rec.number_of_days = 0

    @api.depends('hr_employee_id', 'leave_type', 'number_of_days', 'state', 'from_date')
    def _compute_paid_status(self):
        Config = self.env['hr.leave.config']
        for rec in self:
            # Default a leave to UNPAID. It only becomes paid when an *enabled*
            # paid-leave policy with remaining quota grants it (handled below).
            # This makes both "no policy configured" and "paid leave off" unpaid,
            # instead of silently treating leaves as paid.
            rec.is_paid = False
            rec.paid_days = 0.0
            rec.unpaid_days = 0.0
            rec.deduction_amount = 0.0

            if not rec.hr_employee_id or not rec.from_date or rec.state in ('rejected', 'cancelled'):
                continue

            # Real, active leave → fully-unpaid baseline.
            rec.unpaid_days = rec.number_of_days

            company_id = rec.hr_employee_id.company_id.id
            config = Config.search([('company_id', '=', company_id)], limit=1)

            # Daily-rate denominator = working days in the leave's month
            # (half-day-Friday aware), so a full month of unpaid leave wipes the
            # wage exactly and matches the employee report. Falls back to calendar
            # days only when no attendance config / no working days are defined.
            late_config = self.env['hr.attendance.late.config'].get_config_record_for_employee(
                rec.hr_employee_id.id
            )
            daily_basis = late_config.get_working_days_in_month(
                rec.from_date.year, rec.from_date.month, company_id
            ) if late_config else 0
            if daily_basis <= 0:
                daily_basis = calendar.monthrange(
                    rec.from_date.year, rec.from_date.month
                )[1]

            def _unpaid_deduction(unpaid_days, _rec=rec, _config=config, _basis=daily_basis):
                # Salary-based unpaid deduction: wage ÷ working days × unpaid days.
                # Deduct by default — only a SAVED policy with the box UNticked
                # turns it off. (No policy at all still deducts, since unpaid
                # leave means the day isn't paid.)
                if _config and not _config.unpaid_leave_deduction_enabled:
                    return 0.0
                try:
                    emp_wage = _rec.hr_employee_id.contract_wage or 0.0
                except Exception:
                    emp_wage = 0.0
                if emp_wage > 0 and _basis > 0:
                    # Round the daily rate to currency precision first, then per
                    # record, so it matches the report (185.19 × days).
                    daily_rate = round(emp_wage / _basis, 2)
                    return round(unpaid_days * daily_rate, 2)
                return 0.0

            if not config or not config.paid_leave_enabled:
                # No policy at all, or Paid Leave switched OFF → fully unpaid
                # (deducted at the salary-based rate when deduction is enabled).
                rec.deduction_amount = _unpaid_deduction(rec.unpaid_days)
                continue

            year = rec.from_date.year
            month = rec.from_date.month

            # Check both yearly and monthly limits
            yearly_allowed = config.paid_leave_days_per_year
            monthly_allowed = config.paid_leave_days_per_month

            # Count already used PAID days this YEAR (excluding current record, only earlier records)
            used_year_records = self.search([
                ('hr_employee_id', '=', rec.hr_employee_id.id),
                ('state', 'not in', ('rejected', 'cancelled', 'draft')),
                ('from_date', '>=', f'{year}-01-01'),
                ('from_date', '<=', f'{year}-12-31'),
                ('id', '!=', rec.id),
                ('id', '<', rec.id),
            ])
            used_year_days = sum(r.paid_days for r in used_year_records)

            # Count already used PAID days this MONTH (excluding current record, only earlier records)
            month_start = f'{year}-{str(month).zfill(2)}-01'
            if month == 12:
                month_end = f'{year + 1}-01-01'
            else:
                month_end = f'{year}-{str(month + 1).zfill(2)}-01'

            used_month_records = self.search([
                ('hr_employee_id', '=', rec.hr_employee_id.id),
                ('state', 'not in', ('rejected', 'cancelled', 'draft')),
                ('from_date', '>=', month_start),
                ('from_date', '<', month_end),
                ('id', '!=', rec.id),
                ('id', '<', rec.id),
            ])
            used_month_days = sum(r.paid_days for r in used_month_records)

            # Remaining by year and month
            remaining_year = max(0, yearly_allowed - used_year_days)
            remaining_month = max(0, monthly_allowed - used_month_days)

            # Effective remaining = minimum of both
            remaining = min(remaining_year, remaining_month)

            if rec.number_of_days <= remaining:
                # Fully paid
                rec.is_paid = True
                rec.paid_days = rec.number_of_days
                rec.unpaid_days = 0.0
                rec.deduction_amount = 0.0
            else:
                # Partially or fully unpaid — split the days; the over-quota part
                # is unpaid and deducted at the salary-based rate.
                rec.paid_days = remaining
                rec.unpaid_days = rec.number_of_days - remaining
                rec.is_paid = rec.unpaid_days == 0
                rec.deduction_amount = _unpaid_deduction(rec.unpaid_days)

    # --- Constraints ---

    @api.constrains('from_date', 'to_date')
    def _check_dates(self):
        for rec in self:
            if rec.to_date and rec.from_date and rec.to_date < rec.from_date:
                raise exceptions.ValidationError(
                    'To Date cannot be before From Date.'
                )

    @api.constrains('hr_employee_id', 'from_date', 'to_date', 'state')
    def _check_duplicate_request(self):
        for rec in self:
            if rec.state in ('rejected', 'cancelled'):
                continue
            domain = [
                ('hr_employee_id', '=', rec.hr_employee_id.id),
                ('state', 'not in', ('rejected', 'cancelled')),
                ('id', '!=', rec.id),
            ]
            to_date = rec.to_date or rec.from_date
            domain += [
                ('from_date', '<=', to_date),
                '|',
                ('to_date', '>=', rec.from_date),
                '&',
                ('to_date', '=', False),
                ('from_date', '>=', rec.from_date),
            ]
            existing = self.search(domain, limit=1)
            if existing:
                raise exceptions.ValidationError(
                    f'A leave request already exists for overlapping dates. '
                    f'Existing request: {existing.display_name}'
                )

    # --- Action Methods ---

    def action_submit(self):
        """draft → pending"""
        for rec in self:
            if rec.state != 'draft':
                raise exceptions.UserError('Only draft requests can be submitted.')
            rec.state = 'pending'
        _logger.info('[Leave] Request submitted: %s', self.mapped('display_name'))

    def action_approve(self):
        """pending → approved"""
        for rec in self:
            if rec.state != 'pending':
                raise exceptions.UserError('Only pending requests can be approved.')
            rec.write({
                'state': 'approved',
                'approved_by': self.env.user.id,
                'approval_date': fields.Datetime.now(),
                'rejection_reason': False,
            })
        _logger.info('[Leave] Request approved: %s by %s', self.mapped('display_name'), self.env.user.name)

    def action_reject(self):
        """pending → rejected (rejection reason via wizard or direct)"""
        for rec in self:
            if rec.state != 'pending':
                raise exceptions.UserError('Only pending requests can be rejected.')
            rec.write({
                'state': 'rejected',
                'approved_by': self.env.user.id,
                'approval_date': fields.Datetime.now(),
            })
        _logger.info('[Leave] Request rejected: %s by %s', self.mapped('display_name'), self.env.user.name)

    def action_cancel(self):
        """Cancel from draft/pending/approved → cancelled"""
        for rec in self:
            if rec.state not in ('draft', 'pending', 'approved'):
                raise exceptions.UserError('Cannot cancel this request.')
            rec.state = 'cancelled'
        _logger.info('[Leave] Request cancelled: %s', self.mapped('display_name'))

    def action_reset_to_draft(self):
        """rejected/cancelled → draft"""
        for rec in self:
            if rec.state not in ('rejected', 'cancelled'):
                raise exceptions.UserError('Only rejected or cancelled requests can be reset.')
            rec.write({
                'state': 'draft',
                'approved_by': False,
                'approval_date': False,
                'rejection_reason': False,
            })

    # --- API Helper Methods (for mobile app) ---

    @api.model
    def get_my_leave_requests(self, user_id=None, state_filter=None):
        """Get leave requests for an employee."""
        domain = []
        if user_id:
            # Search by employee_user_id OR hr_employee_id
            employee = self.env['hr.employee'].sudo().search([('user_id', '=', user_id)], limit=1)
            if employee:
                domain.append(('hr_employee_id', '=', employee.id))
            else:
                domain.append(('employee_user_id', '=', user_id))
        if state_filter:
            domain.append(('state', '=', state_filter))

        records = self.search(domain, order='from_date desc', limit=50)
        type_labels = dict(self._fields['leave_type'].selection)
        return [{
            'id': r.id,
            'employee_name': r.employee_name or '',
            'leave_type': r.leave_type,
            'leave_type_label': type_labels.get(r.leave_type, ''),
            'from_date': str(r.from_date) if r.from_date else '',
            'to_date': str(r.to_date) if r.to_date else '',
            'number_of_days': r.number_of_days,
            'reason': r.reason or '',
            'state': r.state,
            'approved_by': r.approved_by.name if r.approved_by else '',
            'approval_date': str(r.approval_date) if r.approval_date else '',
            'rejection_reason': r.rejection_reason or '',
        } for r in records]

    @api.model
    def get_pending_requests_for_approval(self):
        """Get all pending leave requests for manager."""
        records = self.search([('state', '=', 'pending')], order='from_date asc')
        type_labels = dict(self._fields['leave_type'].selection)
        return [{
            'id': r.id,
            'employee_name': r.employee_name or '',
            'leave_type': r.leave_type,
            'leave_type_label': type_labels.get(r.leave_type, ''),
            'from_date': str(r.from_date) if r.from_date else '',
            'to_date': str(r.to_date) if r.to_date else '',
            'number_of_days': r.number_of_days,
            'reason': r.reason or '',
            'state': r.state,
            'created_on': str(r.create_date) if r.create_date else '',
        } for r in records]

    @api.model
    def get_leave_report(self, employee_id=None, department_id=None,
                         date_from=None, date_to=None, state_filter=None):
        """Get leave report data for reporting."""
        domain = [('state', '=', 'approved')]
        if state_filter:
            domain = [('state', '=', state_filter)]
        if employee_id:
            domain.append(('hr_employee_id', '=', employee_id))
        if department_id:
            domain.append(('hr_employee_id.department_id', '=', department_id))
        if date_from:
            domain.append(('from_date', '>=', date_from))
        if date_to:
            domain.append(('from_date', '<=', date_to))

        records = self.search(domain, order='from_date desc')
        type_labels = dict(self._fields['leave_type'].selection)
        return [{
            'id': r.id,
            'employee_name': r.employee_name or '',
            'department': r.hr_employee_id.department_id.name if r.hr_employee_id and r.hr_employee_id.department_id else '',
            'leave_type': r.leave_type,
            'leave_type_label': type_labels.get(r.leave_type, ''),
            'from_date': str(r.from_date) if r.from_date else '',
            'to_date': str(r.to_date) if r.to_date else '',
            'number_of_days': r.number_of_days,
            'reason': r.reason or '',
            'state': r.state,
            'approved_by': r.approved_by.name if r.approved_by else '',
        } for r in records]
