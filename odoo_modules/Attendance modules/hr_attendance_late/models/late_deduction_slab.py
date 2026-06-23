from odoo import models, fields, api, exceptions
from .time_utils import minutes_to_hm


class LateDeductionSlab(models.Model):
    _name = 'hr.late.deduction.slab'
    _description = 'Late Arrival Deduction Slab'
    _order = 'from_minutes asc'

    name = fields.Char(
        string='Slab Name',
        compute='_compute_name',
        store=True,
    )
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
        required=True,
    )
    from_minutes = fields.Integer(
        string='Late From (Minutes)',
        required=True,
        help='Minimum late minutes for this slab (inclusive).',
    )
    from_display = fields.Char(
        string='Late From',
        compute='_compute_display_times',
        store=True,
    )
    to_minutes = fields.Integer(
        string='Late To (Minutes)',
        required=True,
        help='Maximum late minutes for this slab (inclusive). Set 0 for unlimited.',
    )
    to_display = fields.Char(
        string='Late To',
        compute='_compute_display_times',
        store=True,
    )
    deduction_amount = fields.Float(
        string='Deduction Amount',
        required=True,
        help='Amount to deduct per late occurrence in this slab.',
    )
    currency_id = fields.Many2one(
        'res.currency',
        related='company_id.currency_id',
        readonly=True,
    )
    active = fields.Boolean(default=True)

    def action_delete_slab(self):
        """Delete this slab row directly from the list (per-row trash button)."""
        return self.unlink()

    @api.depends('from_minutes', 'to_minutes')
    def _compute_name(self):
        for rec in self:
            from_str = minutes_to_hm(rec.from_minutes)
            to_str = minutes_to_hm(rec.to_minutes) if rec.to_minutes > 0 else 'unlimited'
            rec.name = f'{from_str} - {to_str}'

    @api.depends('from_minutes', 'to_minutes')
    def _compute_display_times(self):
        for rec in self:
            rec.from_display = minutes_to_hm(rec.from_minutes)
            rec.to_display = minutes_to_hm(rec.to_minutes) if rec.to_minutes > 0 else 'Unlimited'

    @api.constrains('from_minutes', 'to_minutes')
    def _check_minutes_range(self):
        for rec in self:
            if rec.to_minutes != 0 and rec.to_minutes <= rec.from_minutes:
                raise exceptions.ValidationError(
                    'The "Late To" minutes must be greater than "Late From" minutes, or 0 for unlimited.'
                )

    @api.model
    def get_deduction_for_minutes(self, late_minutes, company_id=None):
        """Return the deduction amount for a given number of late minutes."""
        company_id = company_id or self.env.company.id
        slabs = self.search([
            ('company_id', '=', company_id),
        ], order='from_minutes asc')

        for slab in slabs:
            if late_minutes >= slab.from_minutes:
                if slab.to_minutes == 0 or late_minutes <= slab.to_minutes:
                    return slab.deduction_amount
        return 0.0
