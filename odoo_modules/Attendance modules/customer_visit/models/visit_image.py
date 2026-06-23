from odoo import models, fields


class CustomerVisitImage(models.Model):
    _name = 'customer.visit.image'
    _description = 'Customer Visit Image'

    visit_id = fields.Many2one('customer.visit', string='Visit', required=True, ondelete='cascade')
    image = fields.Binary(string='Image', required=True, attachment=True)
    image_filename = fields.Char(string='Filename')
