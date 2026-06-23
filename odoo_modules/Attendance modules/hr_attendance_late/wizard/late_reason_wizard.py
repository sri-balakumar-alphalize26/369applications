from odoo import models, fields, api, _
from odoo.exceptions import UserError


class LateReasonWizard(models.TransientModel):
    _name = 'hr.attendance.late.reason.wizard'
    _description = 'Late Reason Entry Wizard'

    attendance_id = fields.Many2one(
        'hr.attendance', string='Attendance', required=True, ondelete='cascade'
    )
    employee_name = fields.Char(
        related='attendance_id.employee_id.name', readonly=True
    )
    late_minutes = fields.Integer(
        related='attendance_id.late_minutes', readonly=True
    )
    late_minutes_display = fields.Char(
        related='attendance_id.late_minutes_display', readonly=True
    )
    checkin_session = fields.Selection(
        related='attendance_id.checkin_session', readonly=True
    )
    expected_start_time = fields.Float(
        related='attendance_id.expected_start_time', readonly=True
    )
    late_sequence = fields.Integer(
        related='attendance_id.late_sequence', readonly=True
    )
    deduction_amount = fields.Float(
        related='attendance_id.deduction_amount', readonly=True
    )
    late_reason = fields.Text(string='Late Reason', required=True)

    def action_submit(self):
        self.ensure_one()
        reason = (self.late_reason or '').strip()
        if not reason:
            raise UserError(_('Please enter a late reason.'))
        # Mirrors the mobile app's submitLateReason: writes to the same
        # `late_reason` field on the same hr.attendance record.
        self.attendance_id.write({'late_reason': reason})
        return {'type': 'ir.actions.act_window_close'}
