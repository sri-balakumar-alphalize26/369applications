import logging
import pytz

from odoo import models, fields, api
from markupsafe import Markup

_logger = logging.getLogger(__name__)


class CustomerVisit(models.Model):
    _name = 'customer.visit'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _description = 'Customer Visit'
    _order = 'date_time desc, id desc'

    name = fields.Char(string='Reference', readonly=True, copy=False, default='New')
    employee_id = fields.Many2one('hr.employee', string='Visited By', index=True, tracking=True)
    partner_id = fields.Many2one('res.partner', string='Customer', required=True, index=True, tracking=True)
    date_time = fields.Datetime(string='Date and Time', default=fields.Datetime.now, tracking=True)
    # Office-timezone display string (shown in views instead of the raw
    # date_time Datetime, which always renders in the viewer's tz).
    date_time_office = fields.Char(string='Date and Time', compute='_compute_date_time_office')
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
        ('in_progress', 'Started'),
        ('done', 'Done'),
    ], string='Status', default='draft', tracking=True)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    # NOTE: the cross-module `source_trip_id` field that references
    # vehicle.tracking lives in hr_field_attendance/models/customer_visit_inherit.py.
    # customer_visit cannot reference vehicle_tracking directly because
    # vehicle_tracking already depends on customer_visit (declaring the FK here
    # would form a circular dependency).

    @api.model
    def name_search(self, name='', domain=None, operator='ilike', limit=100):
        """Restrict Visit dropdowns that pass `hide_done_visits=True` in
        context to draft visits only. Mirrors vehicle.tracking.name_search."""
        domain = list(domain or [])
        if self.env.context.get('hide_done_visits'):
            domain = domain + [('state', '=', 'draft')]
        return super().name_search(
            name=name, domain=domain, operator=operator, limit=limit,
        )

    def action_open_picker_edit(self):
        """Open this visit in a dialog form so the user can edit it without
        leaving the Visit picker dialog. Triggered by the per-row Edit
        button in view_customer_visit_picker."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Edit Visit — %s' % (self.name or ''),
            'res_model': 'customer.visit',
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'new',
        }

    @api.depends('date_time', 'employee_id')
    def _compute_date_time_office(self):
        Config = self.env['hr.attendance.late.config']
        for rec in self:
            rec.date_time_office = Config.format_datetime_office(
                rec.date_time, rec.employee_id.id)

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
        records = super().create(vals_list)
        try:
            records._sync_vehicle_tracking_visits()
        except Exception:
            _logger.exception("[customer.visit] post-create vehicle.tracking sync failed")
        return records

    def write(self, vals):
        res = super().write(vals)
        if any(k in vals for k in ('employee_id', 'date_time', 'location_name', 'partner_id')):
            try:
                self._sync_vehicle_tracking_visits()
            except Exception:
                _logger.exception("[customer.visit] post-write vehicle.tracking sync failed")
        return res

    def unlink(self):
        # Capture (employee_id, date_time) tuples before delete so we can
        # nudge the right trips to recompute after the rows are gone.
        snapshot = [(v.employee_id, v.date_time) for v in self if v.employee_id and v.date_time]
        res = super().unlink()
        if not snapshot or 'vehicle.tracking' not in self.env:
            return res
        try:
            Tracking = self.env['vehicle.tracking'].sudo()
            for emp, dt in snapshot:
                partner_ids = []
                if emp.work_contact_id:
                    partner_ids.append(emp.work_contact_id.id)
                if emp.user_id and emp.user_id.partner_id:
                    partner_ids.append(emp.user_id.partner_id.id)
                if 'address_home_id' in emp._fields and emp.address_home_id:
                    partner_ids.append(emp.address_home_id.id)
                if not partner_ids:
                    continue
                tz = pytz.timezone(emp.tz or 'UTC')
                local_date = pytz.utc.localize(dt).astimezone(tz).date()
                trips = Tracking.search([
                    ('driver_id', 'in', partner_ids),
                    ('date', '=', local_date),
                ])
                if not trips:
                    continue
                trips._compute_visit_ids()
                trips._compute_visited_stops_display()
                trips._compute_visited_stop_count()
                trips.flush_recordset()
        except Exception:
            _logger.exception("[customer.visit] post-unlink vehicle.tracking sync failed")
        return res

    def _sync_vehicle_tracking_visits(self):
        """Re-trigger the visit_ids compute on any vehicle.tracking row that
        spans this visit's employee + local date.

        vehicle.tracking depends on (driver_id, date) — neither of which a
        customer.visit edit changes — so the ORM won't fire the compute on
        its own. We nudge it manually here.

        Soft dependency: customer_visit can be installed without
        vehicle_tracking, in which case this is a no-op.
        """
        if 'vehicle.tracking' not in self.env:
            return
        Tracking = self.env['vehicle.tracking'].sudo()
        for visit in self:
            if not visit.employee_id or not visit.date_time:
                continue
            emp = visit.employee_id
            partner_ids = []
            if emp.work_contact_id:
                partner_ids.append(emp.work_contact_id.id)
            if emp.user_id and emp.user_id.partner_id:
                partner_ids.append(emp.user_id.partner_id.id)
            if 'address_home_id' in emp._fields and emp.address_home_id:
                partner_ids.append(emp.address_home_id.id)
            if not partner_ids:
                continue
            tz = pytz.timezone(emp.tz or 'UTC')
            local_date = pytz.utc.localize(visit.date_time).astimezone(tz).date()
            trips = Tracking.search([
                ('driver_id', 'in', partner_ids),
                ('date', '=', local_date),
            ])
            if not trips:
                continue
            trips._compute_visit_ids()
            trips._compute_visited_stops_display()
            trips._compute_visited_stop_count()
            trips.flush_recordset()

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
