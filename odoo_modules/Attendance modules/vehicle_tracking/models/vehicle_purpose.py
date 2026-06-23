# -*- coding: utf-8 -*-
from odoo import fields, models


class VehiclePurpose(models.Model):
    _name = 'vehicle.purpose'
    _description = 'Vehicle Purpose of Visit'
    _order = 'name'

    name = fields.Char(string='Purpose', required=True)
