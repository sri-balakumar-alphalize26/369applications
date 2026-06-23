from odoo import models, fields

class FleetVehicleInherit(models.Model):
    _inherit = 'fleet.vehicle'

    tank_capacity = fields.Float(string="Tank Capacity (Liters)")
