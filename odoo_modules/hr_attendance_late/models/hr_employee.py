from odoo import models


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    def _attendance_action_change(self, geo_information=None):
        """Standard kiosk / systray self-service check-in/out (this method
        creates the hr.attendance record). The employee cannot type a late
        reason at the kiosk, so exempt this path from the late-reason
        constraint enforced in hr.attendance — the mobile app collects the
        reason via its own post-check-in popup instead."""
        return super(
            HrEmployee, self.with_context(skip_late_reason_required=True)
        )._attendance_action_change(geo_information=geo_information)
