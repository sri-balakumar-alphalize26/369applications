from odoo import fields, models

class VehicleTrackingInvoice(models.Model):
    _name = 'vehicle.tracking.invoice'
    _description = 'Vehicle Tracking Invoice Line'

    name = fields.Char(string='Name', required=True)
    invoice_number = fields.Char(string='Invoice Number')
    tracking_id = fields.Many2one('vehicle.tracking', string='Tracking Reference', ondelete='cascade')
