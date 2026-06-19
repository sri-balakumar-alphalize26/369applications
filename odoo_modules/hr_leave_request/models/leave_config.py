from odoo import models, fields, api


class LeaveConfig(models.Model):
    _name = 'hr.leave.config'
    _description = 'Leave Configuration'
    _rec_name = 'display_name'

    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
        required=True,
    )

    # --- Paid Leave Configuration ---
    paid_leave_enabled = fields.Boolean(
        string='Enable Paid Leave',
        default=True,
        help='If enabled, employees get a fixed number of paid leave days per year.',
    )
    paid_leave_days_per_year = fields.Integer(
        string='Paid Leave Days Per Year',
        default=12,
        help='Total number of paid leave days allowed per year.',
    )
    paid_leave_days_per_month = fields.Float(
        string='Paid Leave Days Per Month',
        default=1.0,
        help='Number of paid leave days allowed per month.',
    )

    # --- Unpaid Leave Configuration ---
    unpaid_leave_deduction_enabled = fields.Boolean(
        string='Enable Unpaid Leave Deduction',
        default=True,
        help='When enabled, unpaid leave deduction is calculated as: '
             'Employee Monthly Wage ÷ Working Days in Month. '
             'Half day = half of that daily rate.',
    )

    # --- Grace / Carry Forward ---
    carry_forward_enabled = fields.Boolean(
        string='Allow Carry Forward',
        default=False,
        help='Allow unused paid leaves to carry forward to next year.',
    )
    max_carry_forward_days = fields.Integer(
        string='Max Carry Forward Days',
        default=5,
    )

    active = fields.Boolean(default=True)

    @api.depends('company_id')
    def _compute_display_name(self):
        for rec in self:
            rec.display_name = f'{rec.company_id.name} - Leave Policy'

    @api.model
    def get_config_for_company(self, company_id=None):
        """Get leave config for a company. Callable from mobile app."""
        company_id = company_id or self.env.company.id
        config = self.search([('company_id', '=', company_id)], limit=1)
        if not config:
            return {
                'paid_leave_enabled': True,
                'paid_leave_days_per_year': 12,
                'paid_leave_days_per_month': 1.0,
                'unpaid_leave_deduction_enabled': True,
                'carry_forward_enabled': False,
                'max_carry_forward_days': 5,
            }
        return {
            'id': config.id,
            'paid_leave_enabled': config.paid_leave_enabled,
            'paid_leave_days_per_year': config.paid_leave_days_per_year,
            'paid_leave_days_per_month': config.paid_leave_days_per_month,
            'unpaid_leave_deduction_enabled': config.unpaid_leave_deduction_enabled,
            'carry_forward_enabled': config.carry_forward_enabled,
            'max_carry_forward_days': config.max_carry_forward_days,
        }

    @api.model
    def get_employee_leave_balance(self, employee_id, year=None):
        """Calculate remaining paid leave for an employee."""
        from datetime import date
        year = year or date.today().year
        company_id = self.env['hr.employee'].browse(employee_id).company_id.id
        config = self.search([('company_id', '=', company_id)], limit=1)

        if not config or not config.paid_leave_enabled:
            return {'has_quota': False}

        # Count all approved leave days this year
        used_records = self.env['hr.leave.request'].search([
            ('hr_employee_id', '=', employee_id),
            ('state', '=', 'approved'),
            ('from_date', '>=', f'{year}-01-01'),
            ('from_date', '<=', f'{year}-12-31'),
        ])
        total_used = sum(r.number_of_days for r in used_records)
        total_allowed = config.paid_leave_days_per_year

        return {
            'has_quota': True,
            'total_allowed': total_allowed,
            'total_used': total_used,
            'remaining': max(0, total_allowed - total_used),
            'per_month': config.paid_leave_days_per_month,
            'unpaid_deduction_enabled': config.unpaid_leave_deduction_enabled,
        }
