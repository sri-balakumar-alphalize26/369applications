from odoo import models, fields


class LateConfigLeaveSync(models.Model):
    """Keep leave-request deductions in sync with the Office-Hours / working-days
    config.

    `hr.leave.request.deduction_amount` is a stored field whose dependencies do
    NOT include the attendance config, so it never recomputes when the working
    days or half-day-Friday settings change — it goes stale (e.g. computed at a
    26-day basis instead of 27). The config already recomputes affected
    attendances on change; here we extend that hook so the affected leave
    requests recompute too, keeping the leave list aligned with the report.
    """
    _inherit = 'hr.attendance.late.config'

    def _recompute_affected_attendances(self):
        res = super()._recompute_affected_attendances()
        self._recompute_affected_leaves()
        return res

    def _recompute_affected_leaves(self):
        """Recompute paid/unpaid status + deduction for recent leave requests of
        the employees this config covers, so the salary-based daily rate uses the
        current working-days figure."""
        from dateutil.relativedelta import relativedelta
        Leave = self.env['hr.leave.request']
        today = fields.Date.today()
        date_from = today - relativedelta(months=3)
        for cfg in self:
            domain = [('from_date', '>=', date_from)]
            if cfg.company_id:
                domain.append(('hr_employee_id.company_id', '=', cfg.company_id.id))
            if cfg.department_id:
                domain.append(('hr_employee_id.department_id', '=', cfg.department_id.id))
            leaves = Leave.search(domain)
            if leaves:
                leaves._compute_paid_status()
                leaves.flush_recordset()
