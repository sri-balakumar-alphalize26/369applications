from odoo import api, models, fields, _
from odoo.exceptions import ValidationError


class EmployeeDevice(models.Model):
    _name = 'employee.device'
    _description = 'Employee Device'
    _order = 'last_used desc'

    employee_id = fields.Many2one('hr.employee', string='Employee', required=True, ondelete='cascade')
    device_id = fields.Char(string='Device ID', required=True)
    device_name = fields.Char(string='Device Name')
    device_type = fields.Selection([
        ('android', 'Android'),
        ('ios', 'iOS'),
    ], string='Device Type', default='android')
    active = fields.Boolean(string='Active', default=True)
    last_used = fields.Datetime(string='Last Used')

    @api.constrains('employee_id')
    def _check_single_device(self):
        """Only one device (active or archived) may be registered per employee."""
        for dev in self:
            if not dev.employee_id:
                continue
            count = self.with_context(active_test=False).search_count(
                [('employee_id', '=', dev.employee_id.id)])
            if count > 1:
                raise ValidationError(_(
                    "Only one device can be registered per employee. "
                    "Remove the existing device before adding a new one."))
