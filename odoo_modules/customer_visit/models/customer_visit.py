from odoo import models, fields, api
from markupsafe import Markup


class CustomerVisit(models.Model):
    _name = 'customer.visit'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _description = 'Customer Visit'
    _order = 'date_time desc, id desc'

    name = fields.Char(string='Reference', readonly=True, copy=False, default='New')
    employee_id = fields.Many2one('hr.employee', string='Visited By', index=True, tracking=True)
    partner_id = fields.Many2one('res.partner', string='Customer', required=True, index=True, tracking=True)
    date_time = fields.Datetime(string='Date and Time', default=fields.Datetime.now, tracking=True)
    purpose_id = fields.Many2one('visit.purpose', string='Visit Purpose', tracking=True)
    visit_duration = fields.Selection([
        ('0_15', '0 to 15 minutes'),
        ('15_30', '15 to 30 minutes'),
        ('30_60', '30 to 60 minutes'),
        ('60_plus', 'More than 60 minutes'),
    ], string='Visit Duration')
    remarks = fields.Text(string='Remarks')
    latitude = fields.Float(string='Latitude', digits=(16, 8))
    longitude = fields.Float(string='Longitude', digits=(16, 8))
    location_name = fields.Char(string='Location')
    visit_plan_id = fields.Many2one('visit.plan', string='Visit Plan', ondelete='set null')
    image_ids = fields.One2many('customer.visit.image', 'visit_id', string='Images')
    voice_note = fields.Binary(string='Voice Note', attachment=True)
    voice_note_filename = fields.Char(string='Voice Note Filename')
    voice_note_player = fields.Html(string='Play Voice Note', compute='_compute_voice_note_player', sanitize=False)
    state = fields.Selection([
        ('draft', 'Draft'),
        ('done', 'Done'),
    ], string='Status', default='draft', tracking=True)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    @api.depends('voice_note', 'voice_note_filename')
    def _compute_voice_note_player(self):
        """Force-render an inline <audio> tag using the REAL base64 payload.

        Three layers of defense:
        1. Read with `bin_size=False` so we get base64 not the file size int.
        2. Fallback: pull `datas` directly from the underlying ir.attachment.
        3. Validate the base64 length before building the data URI — anything
           less than ~100 chars can't be a real audio file and would render a
           grayed-out unplayable player.
        """
        import logging
        _logger = logging.getLogger(__name__)
        ext_to_mime = {
            'm4a': 'audio/mp4',
            'mp4': 'audio/mp4',
            'aac': 'audio/aac',
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'ogg': 'audio/ogg',
            'webm': 'audio/webm',
            '3gp': 'audio/3gpp',
        }
        for record in self:
            filename = record.voice_note_filename or 'voice_note.m4a'
            ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'm4a'
            mime = ext_to_mime.get(ext, 'audio/mp4')

            # ── Step 1: read with bin_size=False to bypass the size-only quirk
            try:
                rec_real = record.with_context(bin_size=False)
                raw = rec_real.voice_note
            except Exception as e:
                _logger.warning('[customer.visit] voice_note bin_size=False read failed: %s', e)
                raw = record.voice_note

            # Convert bytes → str if needed
            if isinstance(raw, (bytes, bytearray)):
                try:
                    raw = raw.decode('ascii')
                except Exception:
                    raw = raw.decode('utf-8', errors='ignore')
            elif isinstance(raw, int):
                # bin_size mode returned the size, not the data — force re-read via attachment.
                _logger.info('[customer.visit] voice_note returned int (size=%s), falling back to attachment', raw)
                raw = None
            elif not isinstance(raw, str):
                raw = None

            # ── Step 2: fallback to ir.attachment.datas if step 1 didn't yield
            if not raw or len(raw) < 100:
                try:
                    attachment = self.env['ir.attachment'].sudo().search([
                        ('res_model', '=', 'customer.visit'),
                        ('res_id', '=', record.id),
                        ('res_field', '=', 'voice_note'),
                    ], limit=1)
                    if attachment:
                        att_real = attachment.with_context(bin_size=False)
                        datas = att_real.datas
                        if isinstance(datas, (bytes, bytearray)):
                            datas = datas.decode('ascii', errors='ignore')
                        if isinstance(datas, str) and len(datas) >= 100:
                            raw = datas
                            _logger.info('[customer.visit] voice_note recovered from ir.attachment, %d chars', len(datas))
                        # Heal the mimetype so Edit/Download also work
                        if attachment.mimetype in (False, '', 'application/octet-stream', 'application/binary'):
                            attachment.sudo().write({'mimetype': mime})
                except Exception as e:
                    _logger.warning('[customer.visit] ir.attachment fallback failed: %s', e)

            # ── Step 3: validate before building the data URI
            if not raw or len(raw) < 100:
                record.voice_note_player = Markup(
                    '<span style="color: #999;">No voice note</span>'
                )
                continue

            data_uri = f'data:{mime};base64,{raw}'
            _logger.info('[customer.visit] rendering audio player rec=%s mime=%s b64_len=%s',
                         record.id, mime, len(raw))

            record.voice_note_player = Markup(
                '<audio controls preload="auto" style="width:100%%;">'
                '<source src="%s" type="%s">'
                'Your browser does not support the audio element.'
                '</audio>'
            ) % (data_uri, mime)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('customer.visit') or 'New'
        return super().create(vals_list)

    def action_done(self):
        self.filtered(lambda r: r.state == 'draft').write({'state': 'done'})

    def action_reset_to_draft(self):
        self.filtered(lambda r: r.state == 'done').write({'state': 'draft'})


class CustomerVisitImage(models.Model):
    _name = 'customer.visit.image'
    _description = 'Customer Visit Image'

    visit_id = fields.Many2one('customer.visit', string='Visit', required=True, ondelete='cascade')
    image = fields.Binary(string='Image', required=True, attachment=True)
    image_filename = fields.Char(string='Filename')
