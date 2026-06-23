from odoo import models, fields, api
from odoo.exceptions import ValidationError


class VisitPlan(models.Model):
    _name = 'visit.plan'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _description = 'Customer Visit Plan'
    _order = 'visit_date desc, id desc'

    name = fields.Char(string='Reference', readonly=True, copy=False, default='New')
    partner_id = fields.Many2one('res.partner', string='Customer', required=True, index=True, tracking=True)
    employee_id = fields.Many2one('hr.employee', string='Assigned To', index=True, tracking=True)
    created_by_id = fields.Many2one('hr.employee', string='Created By')
    manager_id = fields.Many2one('hr.employee', string='Manager')
    visit_date = fields.Datetime(string='Date and Time', tracking=True)
    purpose_id = fields.Many2one('visit.purpose', string='Visit Purpose', tracking=True)
    remarks = fields.Text(string='Remarks')
    approval_status = fields.Selection([
        ('new', 'New'),
        ('pending', 'Pending Approval'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ], string='Approval Status', default='new', tracking=True)
    visit_status = fields.Selection([
        ('not_visited', 'Not Visited'),
        ('visited', 'Visited'),
    ], string='Visit Status', default='not_visited', tracking=True)
    visit_ids = fields.One2many('customer.visit', 'visit_plan_id', string='Visits')
    visit_count = fields.Integer(string='Visit Count', compute='_compute_visit_count')
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    @api.depends('visit_ids')
    def _compute_visit_count(self):
        for record in self:
            record.visit_count = len(record.visit_ids)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('visit.plan') or 'New'
        return super().create(vals_list)

    def action_send_for_approval(self):
        for record in self.filtered(lambda r: r.approval_status == 'new'):
            if not record.manager_id:
                raise ValidationError("Please assign a Manager before sending for approval.")
            record.approval_status = 'pending'

    def action_approve(self):
        self.filtered(lambda r: r.approval_status == 'pending').write({'approval_status': 'approved'})

    def action_reject(self):
        self.filtered(lambda r: r.approval_status == 'pending').write({'approval_status': 'rejected'})

    def action_reset_to_new(self):
        self.filtered(lambda r: r.approval_status in ('rejected', 'pending')).write({'approval_status': 'new'})

    def action_create_visit(self):
        self.ensure_one()
        if self.approval_status != 'approved':
            raise ValidationError("Only approved plans can create visits.")
        visit = self.env['customer.visit'].create({
            'partner_id': self.partner_id.id,
            'employee_id': self.employee_id.id,
            'date_time': self.visit_date or fields.Datetime.now(),
            'purpose_id': self.purpose_id.id if self.purpose_id else False,
            'visit_plan_id': self.id,
        })
        self.visit_status = 'visited'
        return {
            'type': 'ir.actions.act_window',
            'name': 'Customer Visit',
            'res_model': 'customer.visit',
            'res_id': visit.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def action_view_visits(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Visits',
            'res_model': 'customer.visit',
            'view_mode': 'list,form',
            'domain': [('visit_plan_id', '=', self.id)],
            'context': {'default_visit_plan_id': self.id},
        }
