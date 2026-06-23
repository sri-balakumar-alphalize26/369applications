from odoo import models, fields, api, exceptions


class PublicHoliday(models.Model):
    _name = 'hr.public.holiday'
    _description = 'Public Holiday'
    _order = 'date asc'
    _rec_name = 'name'

    name = fields.Char(string='Holiday Name', required=True)
    date = fields.Date(string='Date', required=True)
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
        required=True,
    )
    active = fields.Boolean(default=True)

    _sql_constraints = [
        ('unique_holiday_date_company',
         'UNIQUE(date, company_id)',
         'A holiday already exists for this date and company.'),
    ]

    @api.constrains('date')
    def _check_date(self):
        for rec in self:
            if not rec.date:
                raise exceptions.ValidationError('Holiday date is required.')

    @api.model
    def is_public_holiday(self, check_date, company_id=None):
        """Check if a given date is a public holiday."""
        company_id = company_id or self.env.company.id
        return bool(self.search([
            ('date', '=', check_date),
            ('company_id', '=', company_id),
        ], limit=1))

    @api.model
    def get_holidays_in_range(self, date_from, date_to, company_id=None):
        """Return all public holidays in a date range."""
        company_id = company_id or self.env.company.id
        return self.search([
            ('date', '>=', date_from),
            ('date', '<=', date_to),
            ('company_id', '=', company_id),
        ])
