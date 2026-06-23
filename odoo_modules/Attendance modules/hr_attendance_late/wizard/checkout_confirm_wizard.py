from odoo import models, fields, api, _


class CheckoutConfirmWizard(models.TransientModel):
    _name = 'hr.attendance.checkout.confirm.wizard'
    _description = 'Check-out Confirmation Wizard'

    attendance_id = fields.Many2one(
        'hr.attendance', string='Attendance', required=True, ondelete='cascade'
    )
    employee_name = fields.Char(
        related='attendance_id.employee_id.name', readonly=True
    )
    check_in = fields.Datetime(
        related='attendance_id.check_in', readonly=True
    )
    checkin_session = fields.Selection(
        related='attendance_id.checkin_session', readonly=True
    )

    def action_confirm_checkout(self):
        self.ensure_one()
        # Set check_out to NOW (reflects the moment of confirmation, same
        # as the mobile app's flow). Once written, the constraint
        # `_check_no_reentry_same_session` blocks any future check-in to
        # the same (date, session) bucket for this employee.
        self.attendance_id.write({'check_out': fields.Datetime.now()})
        return {'type': 'ir.actions.act_window_close'}
