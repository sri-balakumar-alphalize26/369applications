from odoo import models, fields, api


class CashCollection(models.Model):
    _name = 'cash.collection'
    _description = 'Vehicle Maintenance'
    _order = 'date desc, id desc'
    _rec_name = 'ref'

    ref = fields.Char(
        string='Ref',
        required=True,
        copy=False,
        readonly=True,
        default='New',
    )
    date = fields.Datetime(string='Date', default=fields.Datetime.now)
    vehicle_id = fields.Many2one('fleet.vehicle', string='Vehicle')
    driver_id = fields.Many2one('res.partner', string='Driver')
    number_plate = fields.Char(string='Number Plate')
    maintenance_type_id = fields.Many2one('maintenance.type', string='Maintenance Type')
    handover_to_partner_id = fields.Many2one('res.partner', string='Handover To')
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
    )

    current_km = fields.Float(string='Current KM', digits=(12, 2))
    amount = fields.Float(string='Amount', digits=(12, 4))

    handover_from = fields.Binary(string='Handover From', attachment=True)
    handover_to = fields.Binary(string='Handover To Image', attachment=True)

    image_url = fields.Image(string='Image Url', attachment=True)

    is_validated = fields.Boolean(string='Validate', default=False)
    validated_by = fields.Many2one('res.users', string='Validated By', readonly=True)
    validation_date = fields.Date(string='Validation Date', readonly=True)

    remarks = fields.Text(string='Remarks')

    def action_validate(self):
        for rec in self:
            rec.is_validated = True
            rec.validated_by = self.env.user.id
            rec.validation_date = fields.Date.today()

    @api.onchange('vehicle_id')
    def _onchange_vehicle_id(self):
        if self.vehicle_id:
            self.number_plate = self.vehicle_id.license_plate or ''
            if self.vehicle_id.driver_id:
                self.driver_id = self.vehicle_id.driver_id.id

    @api.model
    def create(self, vals):
        if isinstance(vals, list):
            for v in vals:
                if v.get('ref', 'New') == 'New':
                    v['ref'] = self.env['ir.sequence'].next_by_code('cash.collection') or 'New'
        elif isinstance(vals, dict):
            if vals.get('ref', 'New') == 'New':
                vals['ref'] = self.env['ir.sequence'].next_by_code('cash.collection') or 'New'
        return super().create(vals)
