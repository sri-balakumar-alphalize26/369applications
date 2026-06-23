from odoo import models, fields


class VisitPurpose(models.Model):
    _name = 'visit.purpose'
    _description = 'Visit Purpose'
    _order = 'name'

    name = fields.Char(string='Purpose', required=True)
    active = fields.Boolean(string='Active', default=True)
