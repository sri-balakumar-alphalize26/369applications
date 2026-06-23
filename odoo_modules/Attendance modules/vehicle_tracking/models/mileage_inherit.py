from odoo import models, fields

class MileageInherit(models.Model):
    _inherit = 'vehicle.tracking'

    mileage = fields.Float(string="Mileage", compute='_compute_mileage', store=True)
