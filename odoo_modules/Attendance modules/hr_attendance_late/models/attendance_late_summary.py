from odoo import models, fields, api
from datetime import date
from .time_utils import minutes_to_hm


class AttendanceLateSummaryWizard(models.TransientModel):
    _name = 'hr.attendance.late.summary.wizard'
    _description = 'Late Attendance Summary Report Wizard'

    month = fields.Selection([
        ('1', 'January'), ('2', 'February'), ('3', 'March'),
        ('4', 'April'), ('5', 'May'), ('6', 'June'),
        ('7', 'July'), ('8', 'August'), ('9', 'September'),
        ('10', 'October'), ('11', 'November'), ('12', 'December'),
    ], string='Month', required=True,
       default=lambda self: str(date.today().month))
    year = fields.Integer(
        string='Year', required=True,
        default=lambda self: date.today().year,
    )
    department_id = fields.Many2one('hr.department', string='Department')
    employee_ids = fields.Many2many('hr.employee', string='Employees')

    def action_generate_summary(self):
        """Generate monthly late summary.
        Only counts late days AFTER the grace period.
        """
        self.ensure_one()
        month = int(self.month)
        year = self.year
        date_from = date(year, month, 1)
        if month == 12:
            date_to = date(year + 1, 1, 1)
        else:
            date_to = date(year, month + 1, 1)

        domain = [
            ('is_late', '=', True),
            ('late_minutes', '>', 0),
            ('date', '>=', date_from),
            ('date', '<', date_to),
            ('late_sequence', '>', 0),
        ]
        if self.employee_ids:
            domain.append(('employee_id', 'in', self.employee_ids.ids))
        if self.department_id:
            domain.append(('employee_id.department_id', '=', self.department_id.id))

        # Clear old summary lines
        self.env['hr.attendance.late.summary.line'].sudo().search([]).unlink()

        attendances = self.env['hr.attendance'].search(domain, order='date asc')

        Config = self.env['hr.attendance.late.config']

        # Group by employee - count late TIMES (not days)
        employee_data = {}
        for att in attendances:
            emp_id = att.employee_id.id
            if emp_id not in employee_data:
                config_data = Config.get_config_for_employee(att.employee_id.id)
                grace_times = config_data.get('grace_late_times',
                                              config_data.get('grace_late_days', 5))
                employee_data[emp_id] = {
                    'employee_id': emp_id,
                    'grace_times': grace_times,
                    'all_late_times': 0,
                    'total_late_days': 0,
                    'total_late_minutes': 0,
                    'total_deduction': 0.0,
                }

            # Each late record = 1 time (not grouped by date)
            employee_data[emp_id]['all_late_times'] += 1

            grace = employee_data[emp_id]['grace_times']
            if employee_data[emp_id]['all_late_times'] > grace:
                employee_data[emp_id]['total_late_days'] += 1
                employee_data[emp_id]['total_late_minutes'] += att.late_minutes
                employee_data[emp_id]['total_deduction'] += att.deduction_amount

        for vals in employee_data.values():
            del vals['grace_times']
            del vals['all_late_times']
            self.env['hr.attendance.late.summary.line'].create(vals)

        month_name = dict(self._fields['month'].selection).get(self.month, self.month)
        return {
            'name': f'Late Summary - {month_name} {self.year}',
            'type': 'ir.actions.act_window',
            'res_model': 'hr.attendance.late.summary.line',
            'view_mode': 'list',
            'target': 'current',
            'context': {'create': False},
        }


class AttendanceLateSummaryLine(models.TransientModel):
    _name = 'hr.attendance.late.summary.line'
    _description = 'Late Attendance Summary Line'
    _order = 'total_late_days desc'

    employee_id = fields.Many2one('hr.employee', string='Employee', readonly=True)
    employee_name = fields.Char(related='employee_id.name', store=True)
    department_name = fields.Char(
        related='employee_id.department_id.name', string='Department', store=True
    )
    total_late_days = fields.Integer(string='Total Late Days', readonly=True)
    total_late_minutes = fields.Integer(string='Total Late (Minutes)', readonly=True)
    total_late_time_display = fields.Char(
        string='Total Late Time',
        compute='_compute_late_time_display',
        store=True,
    )
    total_deduction = fields.Float(string='Total Deduction', readonly=True)

    @api.depends('total_late_minutes')
    def _compute_late_time_display(self):
        for rec in self:
            rec.total_late_time_display = minutes_to_hm(rec.total_late_minutes)
