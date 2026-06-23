from odoo import models, fields


class ResPartner(models.Model):
    _inherit = 'res.partner'

    partner_latitude = fields.Float(string='Latitude', digits=(10, 7))
    partner_longitude = fields.Float(string='Longitude', digits=(10, 7))
