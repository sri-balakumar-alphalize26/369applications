from odoo import models, fields, api, _
from odoo.exceptions import UserError, ValidationError
from datetime import date


class EasySales(models.Model):
    _name = 'easy.sales'
    _description = 'Easy Sales Entry'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'date desc, id desc'

    name = fields.Char(
        string='Reference',
        required=True,
        copy=False,
        readonly=True,
        default=lambda self: _('New')
    )
    date = fields.Date(
        string='Date',
        required=True,
        default=fields.Date.context_today,
        tracking=True
    )
    partner_id = fields.Many2one(
        'res.partner',
        string='Customer',
        required=True,
        tracking=True
    )
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        required=True,
        default=lambda self: self.env.company
    )
    currency_id = fields.Many2one(
        'res.currency',
        string='Currency',
        required=True,
        default=lambda self: self.env.company.currency_id
    )
    discount_type = fields.Selection([
        ('percentage', 'Percentage'),
        ('amount', 'Amount'),
    ], string='Discount Type', default='percentage', required=True)
    line_ids = fields.One2many(
        'easy.sales.line',
        'sales_id',
        string='Sales Lines',
        copy=True
    )
    state = fields.Selection([
        ('draft', 'Draft'),
        ('done', 'Done'),
        ('cancelled', 'Cancelled')
    ], string='Status', default='draft', tracking=True)
    
    amount_untaxed = fields.Monetary(
        string='Untaxed Amount',
        compute='_compute_amounts',
        store=True,
        currency_field='currency_id'
    )
    amount_tax = fields.Monetary(
        string='Taxes',
        compute='_compute_amounts',
        store=True,
        currency_field='currency_id'
    )
    amount_total = fields.Monetary(
        string='Total',
        compute='_compute_amounts',
        store=True,
        currency_field='currency_id'
    )
    
    # Payment Fields
    payment_line_ids = fields.One2many(
        'easy.sales.payment.line',
        'sales_id',
        string='Payments',
        copy=True
    )
    amount_paid = fields.Monetary(
        string='Amount Paid',
        compute='_compute_payment_amounts',
        store=True,
        currency_field='currency_id'
    )
    amount_due = fields.Monetary(
        string='Amount Due',
        compute='_compute_payment_amounts',
        store=True,
        currency_field='currency_id'
    )
    is_paid = fields.Boolean(
        string='Is Paid',
        compute='_compute_payment_amounts',
        store=True
    )
    payment_state = fields.Selection([
        ('not_paid', 'Not Paid'),
        ('partial', 'Partially Paid'),
        ('paid', 'Paid'),
        ('over_paid', 'Over Paid'),
        ('invoiced', 'Fully Invoiced'),
    ], string='Payment Status', compute='_compute_payment_amounts', store=True)
    
    sale_order_id = fields.Many2one(
        'sale.order',
        string='Sale Order',
        readonly=True,
        copy=False
    )
    picking_id = fields.Many2one(
        'stock.picking',
        string='Delivery',
        readonly=True,
        copy=False
    )
    invoice_id = fields.Many2one(
        'account.move',
        string='Customer Invoice',
        readonly=True,
        copy=False
    )
    invoice_date = fields.Date(
        related='invoice_id.invoice_date',
        string='Invoice Date',
        readonly=True,
    )
    payment_ids = fields.Many2many(
        'account.payment',
        'easy_sales_payment_rel',
        'easy_sales_id',
        'payment_id',
        string='Registered Payments',
        readonly=True,
        copy=False
    )
    
    reference = fields.Char(string='Customer Reference')
    notes = fields.Text(string='Notes')
    
    auto_validate_invoice = fields.Boolean(
        string='Auto-Post Invoice',
        default=True,
        help='Automatically post the customer invoice'
    )
    auto_register_payment = fields.Boolean(
        string='Auto-Register Payment',
        default=True,
        help='Automatically register payments on the invoice'
    )
    warehouse_id = fields.Many2one(
        'stock.warehouse',
        string='Warehouse',
        required=True,
        default=lambda self: self.env['stock.warehouse'].search(
            [('company_id', '=', self.env.company.id)], limit=1
        )
    )
    
    pricelist_id = fields.Many2one(
        'product.pricelist',
        string='Pricelist',
        compute='_compute_pricelist_id',
        store=True,
        readonly=False,
        precompute=True,
        help='Pricelist for current sales order.'
    )
    
    # Quick Payment Method - displayed directly on form (REQUIRED)
    quick_payment_method_id = fields.Many2one(
        'easy.sales.payment.method',
        string='Payment method',
        required=True,
        domain="[('company_id', '=', company_id)]",
        default=lambda self: self.env['easy.sales.payment.method'].get_default_payment_method(),
        help='Select payment method before proceeding. This determines how the payment is processed.'
    )

    @api.depends('partner_id')
    def _compute_pricelist_id(self):
        for record in self:
            if record.partner_id and record.partner_id.property_product_pricelist:
                record.pricelist_id = record.partner_id.property_product_pricelist
            else:
                record.pricelist_id = self.env['product.pricelist'].search(
                    [('company_id', 'in', [record.company_id.id, False])], limit=1
                )

    @api.onchange('quick_payment_method_id')
    def _onchange_quick_payment_method_id(self):
        """Sync quick payment method with payment lines"""
        if self.quick_payment_method_id:
            # Clear existing payment lines and create one with quick method
            self.payment_line_ids = [(5, 0, 0)]  # Clear all
            if self.amount_total > 0:
                self.payment_line_ids = [(0, 0, {
                    'payment_method_id': self.quick_payment_method_id.id,
                    'amount': self.amount_total,
                })]
        else:
            # If quick method is cleared, also clear payment lines
            self.payment_line_ids = [(5, 0, 0)]

    @api.onchange('amount_total')
    def _onchange_amount_total_update_payment(self):
        """Update payment line amount when total changes"""
        if self.quick_payment_method_id and self.payment_line_ids:
            # Update the payment line amount to match the new total
            for line in self.payment_line_ids:
                if line.payment_method_id == self.quick_payment_method_id:
                    line.amount = self.amount_total
                    break

    @api.depends('line_ids.subtotal', 'line_ids.tax_amount')
    def _compute_amounts(self):
        for record in self:
            record.amount_untaxed = sum(record.line_ids.mapped('subtotal'))
            record.amount_tax = sum(record.line_ids.mapped('tax_amount'))
            record.amount_total = record.amount_untaxed + record.amount_tax

    @api.depends('payment_line_ids.amount', 'payment_line_ids.payment_method_id', 'amount_total', 'state')
    def _compute_payment_amounts(self):
        for record in self:
            paid = sum(record.payment_line_ids.mapped('amount'))
            record.amount_paid = paid
            record.amount_due = record.amount_total - paid
            
            # Check if this is a credit/customer account sale
            is_credit_sale = any(
                line.payment_method_id.is_customer_account
                for line in record.payment_line_ids
                if line.payment_method_id
            )
            
            if is_credit_sale:
                # Credit sale: invoice created but no actual payment made
                record.payment_state = 'invoiced'
                record.is_paid = False
            elif paid <= 0:
                record.payment_state = 'not_paid'
                record.is_paid = False
            elif paid < record.amount_total:
                record.payment_state = 'partial'
                record.is_paid = False
            elif paid == record.amount_total:
                record.payment_state = 'paid'
                record.is_paid = True
            else:
                record.payment_state = 'over_paid'
                record.is_paid = True

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', _('New')) == _('New'):
                vals['name'] = self.env['ir.sequence'].next_by_code('easy.sales') or _('New')
        return super().create(vals_list)

    def action_add_payment(self):
        """Open wizard to add payment - useful for quick payment addition"""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Add Payment'),
            'res_model': 'easy.sales.payment.line',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_sales_id': self.id,
                'default_amount': self.amount_due,
            }
        }

    def action_set_full_payment(self):
        """Quick action to set payment equal to total amount using default method"""
        self.ensure_one()
        if self.state != 'draft':
            raise UserError(_('Cannot modify payments on a confirmed sale.'))
        
        # Get default payment method
        default_method = self.env['easy.sales.payment.method'].get_default_payment_method(
            self.company_id.id
        )
        if not default_method:
            raise UserError(_('Please configure at least one payment method.'))
        
        # Clear existing payments and add full payment
        self.payment_line_ids.unlink()
        self.env['easy.sales.payment.line'].create({
            'sales_id': self.id,
            'payment_method_id': default_method.id,
            'amount': self.amount_total,
        })
        return True

    def action_confirm(self):
        for record in self:
            # ── Validate: Customer is mandatory ──
            if not record.partner_id:
                raise UserError(_('Please select a Customer before confirming the sale.'))
            
            # ── Validate: Payment method is mandatory ──
            if not record.quick_payment_method_id:
                raise UserError(_('Please select a Payment Method before confirming the sale.'))
            
            if not record.line_ids.filtered(lambda l: not l.display_type):
                raise UserError(_('Please add at least one product line.'))
            
            # ── Auto-set full payment if no payment lines exist ──
            if record.auto_register_payment and not record.payment_line_ids:
                payment_method = record.quick_payment_method_id
                if not payment_method:
                    payment_method = self.env['easy.sales.payment.method'].get_default_payment_method(
                        record.company_id.id
                    )
                if not payment_method:
                    raise UserError(
                        _('Please select a Payment Method or configure a default one.')
                    )
                self.env['easy.sales.payment.line'].create({
                    'sales_id': record.id,
                    'payment_method_id': payment_method.id,
                    'amount': record.amount_total,
                })
            
            # ── CRITICAL: Switch to the correct company context ──
            # This ensures Sale Order, Invoice, Payment, Stock all belong
            # to the same company and reflect in that company's reports
            record_company = record.with_company(record.company_id)
            
            so = record_company._create_sale_order()
            record.sale_order_id = so.id
            
            so.action_confirm()
            
            picking = so.picking_ids.filtered(lambda p: p.state not in ('done', 'cancel'))
            if picking:
                picking = picking[0]
                record.picking_id = picking.id
                record_company._validate_picking(picking)
            
            invoice = record_company._create_customer_invoice(so)
            if invoice:
                record.invoice_id = invoice.id
                
                if record.auto_validate_invoice:
                    invoice.action_post()
                    
                    # Register payments on the invoice
                    if record.auto_register_payment and record.payment_line_ids:
                        record_company._register_payments(invoice)
            
            record.state = 'done'
        
        return True

    def _create_sale_order(self):
        self.ensure_one()
        
        so_lines = []
        for line in self.line_ids:
            if line.display_type:
                continue
            so_lines.append((0, 0, {
                'product_id': line.product_id.id,
                'name': line.description or line.product_id.display_name,
                'product_uom_qty': line.quantity,
                'product_uom_id': line.uom_id.id if line.uom_id else line.product_id.uom_id.id,
                'price_unit': line.price_unit,
                'discount': (line.discount / line.price_unit * 100.0) if self.discount_type == 'amount' and line.price_unit else line.discount,
                'tax_ids': [(6, 0, line.tax_ids.ids)] if line.tax_ids else False,
            }))
        
        so_vals = {
            'partner_id': self.partner_id.id,
            'date_order': self.date,
            'company_id': self.company_id.id,
            'currency_id': self.currency_id.id,
            'client_order_ref': self.reference,
            'pricelist_id': self.pricelist_id.id,
            'warehouse_id': self.warehouse_id.id,
            'order_line': so_lines,
            'origin': self.name,
        }
        
        # Create SO in the correct company context
        so = self.env['sale.order'].with_company(self.company_id).create(so_vals)
        
        if self.notes:
            so.message_post(body=self.notes, message_type='comment')
        
        return so

    def _validate_picking(self, picking):
        """Validate delivery in the correct company context.
        This ensures stock moves reflect in inventory reports.
        """
        self.ensure_one()
        picking = picking.with_company(self.company_id)
        for move in picking.move_ids:
            move.quantity = move.product_uom_qty
        
        # Use skip_backorder and skip_immediate contexts to bypass
        # any confirmation wizards and validate directly
        picking = picking.with_context(
            skip_backorder=True,
            skip_immediate=True,
            skip_sms=True,
            cancel_backorder=True,
        )
        result = picking.button_validate()
        
        # If a wizard was still returned, process it
        if isinstance(result, dict) and result.get('res_model'):
            wizard_model = result.get('res_model')
            wizard_context = result.get('context', {})
            try:
                wizard = self.env[wizard_model].with_context(**wizard_context).create({
                    'pick_ids': [(4, picking.id)],
                })
                wizard.process()
            except Exception:
                pass  # Wizard may not need processing

    def _create_customer_invoice(self, so):
        self.ensure_one()
        # Check if there are any lines that can be invoiced
        invoiceable_lines = so.order_line.filtered(lambda l: l.qty_to_invoice > 0)
        if not invoiceable_lines:
            return False
        
        # Create invoice in the correct company context
        invoice = so.with_company(self.company_id)._create_invoices()
        if invoice:
            invoice.write({
                'invoice_date': self.date,
                'ref': self.reference or self.name,
            })
        return invoice

    def _register_payments(self, invoice):
        """Register payments on the invoice using the payment register wizard.
        
        For Easy Sales (cash/instant sales), we want payments to go directly
        to "Paid" status without requiring bank statement reconciliation.
        
        The approach:
        1. Temporarily set the journal's payment method outstanding account
           to the journal's default account (cash/bank account).
        2. Register payment via the wizard — this creates:
           - Dr. Cash/Bank Account (= outstanding account)
           - Cr. Account Receivable
        3. The wizard auto-reconciles the Receivable with the invoice.
        4. Since outstanding account = default account, Odoo marks payment as "Paid" directly.
        5. Restore the original outstanding account for normal Odoo operations.
        
        This is the Odoo-recommended approach for POS/cash sales — see:
        https://www.odoo.com/documentation/19.0/applications/finance/accounting/payments.html
        """
        self.ensure_one()
        
        created_payments = self.env['account.payment']
        
        for payment_line in self.payment_line_ids:
            if payment_line.amount <= 0:
                continue
            
            # Customer Account (credit sale): skip payment, invoice stays unpaid
            if payment_line.payment_method_id.is_customer_account:
                continue
            
            journal = payment_line.payment_method_id.journal_id
            
            # Get inbound payment method line from the journal
            payment_method_line = journal.inbound_payment_method_line_ids[:1]
            if not payment_method_line:
                raise UserError(
                    _('Journal "%s" has no inbound payment methods configured.\n'
                      'Go to Accounting → Configuration → Journals → %s → '
                      'Incoming Payments tab and add a payment method.',
                      journal.name, journal.name)
                )
            
            # ── STEP 1: Force direct payment by setting outstanding = default account ──
            # Save original outstanding account to restore later
            original_outstanding_account = payment_method_line.payment_account_id
            journal_default_account = journal.default_account_id
            need_restore = False
            
            if journal_default_account and original_outstanding_account != journal_default_account:
                payment_method_line.sudo().write({
                    'payment_account_id': journal_default_account.id,
                })
                need_restore = True
            
            try:
                # ── STEP 2: Register payment via wizard ──
                PaymentRegister = self.env['account.payment.register'].with_company(
                    self.company_id
                ).with_context(
                    active_model='account.move',
                    active_ids=invoice.ids,
                )
                
                wizard = PaymentRegister.create({
                    'journal_id': journal.id,
                    'payment_method_line_id': payment_method_line.id,
                    'amount': payment_line.amount,
                    'payment_date': self.date,
                })
                
                # This creates payment, posts it, and auto-reconciles with invoice
                # Journal entry: Dr Cash Account / Cr Account Receivable
                # Since outstanding = cash, payment goes directly to "Paid"
                result = wizard.action_create_payments()
                
                # ── STEP 3: Extract the created payment record ──
                payment = False
                if isinstance(result, dict):
                    if result.get('res_id'):
                        payment = self.env['account.payment'].browse(result['res_id'])
                    elif result.get('domain'):
                        payment = self.env['account.payment'].search(
                            result['domain'], limit=1, order='id desc'
                        )
                    elif result.get('res_model') == 'account.payment':
                        payment = self.env['account.payment'].search([
                            ('partner_id', '=', self.partner_id.id),
                            ('journal_id', '=', journal.id),
                            ('amount', '=', payment_line.amount),
                        ], limit=1, order='id desc')
                
                if payment:
                    created_payments |= payment
                    
            except Exception as e:
                raise UserError(
                    _('Error registering payment for method "%(method)s": %(error)s\n\n'
                      'Please check:\n'
                      '• Payment Journal "%(journal)s" is correctly configured\n'
                      '• The journal has inbound payment methods\n'
                      '• The customer has a receivable account set',
                      method=payment_line.payment_method_id.name,
                      error=str(e),
                      journal=journal.name)
                )
            finally:
                # ── STEP 4: Restore original outstanding account ──
                if need_restore:
                    payment_method_line.sudo().write({
                        'payment_account_id': original_outstanding_account.id if original_outstanding_account else False,
                    })
        
        if created_payments:
            self.payment_ids = [(6, 0, created_payments.ids)]
        
        return created_payments

    def action_cancel(self):
        for record in self:
            if record.state == 'done':
                raise UserError(_('Cannot cancel a completed sale. Please reverse the related documents.'))
            record.state = 'cancelled'
        return True

    def action_draft(self):
        for record in self:
            if record.state == 'cancelled':
                record.state = 'draft'
        return True

    def action_view_sale_order(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Sale Order'),
            'res_model': 'sale.order',
            'res_id': self.sale_order_id.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def action_view_delivery(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Delivery'),
            'res_model': 'stock.picking',
            'res_id': self.picking_id.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def action_view_invoice(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Customer Invoice'),
            'res_model': 'account.move',
            'res_id': self.invoice_id.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def action_view_payments(self):
        self.ensure_one()
        if len(self.payment_ids) == 1:
            return {
                'type': 'ir.actions.act_window',
                'name': _('Payment'),
                'res_model': 'account.payment',
                'res_id': self.payment_ids.id,
                'view_mode': 'form',
                'target': 'current',
            }
        return {
            'type': 'ir.actions.act_window',
            'name': _('Payments'),
            'res_model': 'account.payment',
            'view_mode': 'list,form',
            'domain': [('id', 'in', self.payment_ids.ids)],
            'target': 'current',
        }


class EasySalesLine(models.Model):
    _name = 'easy.sales.line'
    _description = 'Easy Sales Line'
    _order = 'sequence, id'

    sequence = fields.Integer(default=10)
    display_type = fields.Selection(
        selection=[
            ('line_section', 'Section'),
            ('line_note', 'Note'),
        ],
        default=False,
    )
    name = fields.Text(string='Description')
    sales_id = fields.Many2one(
        'easy.sales',
        string='Sales',
        required=True,
        ondelete='cascade'
    )
    product_id = fields.Many2one(
        'product.product',
        string='Product',
        domain=[('sale_ok', '=', True)]
    )
    description = fields.Char(string='Description')
    quantity = fields.Float(
        string='Quantity',
        required=True,
        default=1.0
    )
    uom_id = fields.Many2one(
        'uom.uom',
        string='Unit',
        required=True,
        compute='_compute_uom_id',
        store=True,
        readonly=False,
        precompute=True
    )
    price_unit = fields.Float(
        string='Unit Price',
        required=True,
        digits='Product Price'
    )
    discount = fields.Float(
        string='Discount',
        digits='Discount',
        default=0.0,
    )
    discount_type = fields.Selection(
        related='sales_id.discount_type',
        string='Discount Type',
    )
    tax_ids = fields.Many2many(
        'account.tax',
        string='Taxes',
        domain=[('type_tax_use', '=', 'sale')]
    )
    currency_id = fields.Many2one(
        related='sales_id.currency_id',
        string='Currency'
    )
    subtotal = fields.Monetary(
        string='Subtotal',
        compute='_compute_amounts',
        store=True,
        currency_field='currency_id'
    )
    tax_amount = fields.Monetary(
        string='Tax Amount',
        compute='_compute_amounts',
        store=True,
        currency_field='currency_id'
    )
    total = fields.Monetary(
        string='Total',
        compute='_compute_amounts',
        store=True,
        currency_field='currency_id'
    )

    @api.depends('product_id')
    def _compute_uom_id(self):
        for line in self:
            if line.product_id and not line.uom_id:
                line.uom_id = line.product_id.uom_id
            elif not line.product_id:
                line.uom_id = False

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('product_id') and not vals.get('uom_id'):
                product = self.env['product.product'].browse(vals['product_id'])
                vals['uom_id'] = product.uom_id.id
        return super().create(vals_list)

    @api.depends('quantity', 'price_unit', 'discount', 'discount_type', 'tax_ids')
    def _compute_amounts(self):
        for line in self:
            if line.discount_type == 'amount':
                price = line.price_unit - (line.discount or 0.0)
            else:
                price = line.price_unit * (1 - (line.discount or 0.0) / 100.0)
            price = max(price, 0.0)
            line.subtotal = line.quantity * price
            if line.tax_ids:
                taxes = line.tax_ids.compute_all(
                    price,
                    line.currency_id,
                    line.quantity,
                    product=line.product_id,
                    partner=line.sales_id.partner_id
                )
                line.tax_amount = taxes['total_included'] - taxes['total_excluded']
                line.total = taxes['total_included']
            else:
                line.tax_amount = 0.0
                line.total = line.subtotal

    @api.onchange('product_id')
    def _onchange_product_id(self):
        if self.product_id:
            self.description = self.product_id.display_name
            self.uom_id = self.product_id.uom_id
            
            if self.sales_id.pricelist_id:
                self.price_unit = self.sales_id.pricelist_id._get_product_price(
                    self.product_id, self.quantity or 1.0
                )
            else:
                self.price_unit = self.product_id.lst_price
            
            if self.product_id.taxes_id:
                self.tax_ids = self.product_id.taxes_id.filtered(
                    lambda t: t.company_id == self.sales_id.company_id
                )
            else:
                self.tax_ids = self.env.company.account_sale_tax_id

    @api.onchange('uom_id')
    def _onchange_uom_id(self):
        if self.product_id and self.uom_id:
            if self.product_id.uom_id != self.uom_id:
                self.price_unit = self.product_id.uom_id._compute_price(
                    self.product_id.lst_price,
                    self.uom_id
                )

    @api.onchange('quantity')
    def _onchange_quantity(self):
        if self.product_id and self.sales_id.pricelist_id:
            self.price_unit = self.sales_id.pricelist_id._get_product_price(
                self.product_id, self.quantity or 1.0
            )


class EasySalesPaymentLine(models.Model):
    _name = 'easy.sales.payment.line'
    _description = 'Easy Sales Payment Line'
    _order = 'id'

    sales_id = fields.Many2one(
        'easy.sales',
        string='Sales',
        required=True,
        ondelete='cascade'
    )
    payment_method_id = fields.Many2one(
        'easy.sales.payment.method',
        string='Payment Method',
        required=True,
        domain="[('company_id', '=', parent.company_id)]"
    )
    amount = fields.Monetary(
        string='Amount',
        required=True,
        currency_field='currency_id'
    )
    currency_id = fields.Many2one(
        related='sales_id.currency_id',
        string='Currency'
    )
    company_id = fields.Many2one(
        related='sales_id.company_id',
        string='Company'
    )
    
    journal_type = fields.Selection(
        related='payment_method_id.journal_type',
        string='Type',
        readonly=True
    )
    
    note = fields.Char(string='Reference/Note')

    @api.onchange('payment_method_id')
    def _onchange_payment_method_id(self):
        """Auto-fill remaining amount when payment method is selected"""
        if self.payment_method_id and not self.amount:
            self.amount = self.sales_id.amount_due
