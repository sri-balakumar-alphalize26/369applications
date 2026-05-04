# -*- coding: utf-8 -*-
from odoo import api, fields, models
from odoo.exceptions import UserError
from datetime import datetime

class VehicleTracking(models.Model):
    _name = 'vehicle.tracking'
    _description = 'Vehicle Tracking'
    _rec_name = 'ref'

    # Header info
    ref = fields.Char(string='Ref', readonly=True, copy=False, default='New')
    date = fields.Date(string='Date', default=fields.Date.context_today)
    vehicle_id = fields.Many2one('fleet.vehicle', string='Vehicle')
    driver_id = fields.Many2one('res.partner', string='Driver',
                                domain="[('is_company','=',False)]")
    number_plate = fields.Char(string='Number Plate')
    company_id = fields.Many2one('res.company', string='Company',
                                 default=lambda self: self.env.company,
                                 readonly=True)
    tank_capacity = fields.Float(string="Tank Capacity", readonly=True)

    # Tracking Details
    source_id = fields.Many2one('vehicle.location', string='Source Location')
    destination_id = fields.Many2one('vehicle.location', string='Destination Location')

    start_km = fields.Integer(string='Start Km', default=0)
    end_km = fields.Integer(string='End Km', default=0)
    km_travelled = fields.Integer(string='KM Travelled', compute='_compute_km_travelled', store=True)
    purpose_of_visit_id = fields.Many2one('vehicle.purpose', string="Purpose of Visit")

    start_time = fields.Datetime(string='Start Time', default=fields.Datetime.now)
    end_time = fields.Datetime(string='End Time')
    duration = fields.Float(string='Duration (Hrs)', compute='_compute_duration', store=True)
    invoice_number = fields.Char(string='Invoice Number')
    invoice_match = fields.Boolean(string="Invoice Match", readonly=True)
    invoice_message = fields.Char(string="Invoice Message", readonly=True)

    amount = fields.Float(string='Amount')
    estimated_time = fields.Float(string='Estimated Time (Hrs)', default=00.00)

    coolant_water = fields.Boolean(string='Coolant Water')
    oil_checking = fields.Boolean(string='Oil Checking')
    tyre_checking = fields.Boolean(string='Tyre Checking')
    battery_checking = fields.Boolean(string='Battery Checking')
    daily_checks = fields.Boolean(string='Daily Checks')
    fuel_checking = fields.Boolean(string="Fuel Checking")
    fuel_status = fields.Char(string="Fuel Status", readonly=True)
    fuel_log_ids = fields.One2many('vehicle.fuel.log', 'vehicle_tracking_id', string='Fuel Logs')

    invoice_line_ids = fields.One2many(
        'vehicle.tracking.invoice',
        'tracking_id',
        string='Invoice Details'
    )

    # Info section
    start_trip = fields.Boolean(string='Start Trip')
    end_trip = fields.Boolean(string='End Trip')
    trip_cancel = fields.Boolean(string='Trip Cancel')

    start_latitude = fields.Char(string='Start Latitude')
    start_longitude = fields.Char(string='Start Longitude')
    end_latitude = fields.Char(string='End Latitude')
    end_longitude = fields.Char(string='End Longitude')

    # `fields.Image` is the proper choice for an image upload widget — it
    # auto-validates the bytes are a recognised image, sets the right mimetype
    # on the ir.attachment, and renders cleanly via /web/image/... .
    # The React Native app already sends base64-encoded image bytes to this
    # field; Image accepts that the same way Binary does — no app-side change.
    image_url = fields.Image(string='Trip Image')
    image_filename = fields.Char(string='Image Filename')
    remarks = fields.Text(string='Remarks')

    state = fields.Selection([
        ('draft', 'Draft'),
        ('validated', 'Validated'),
    ], default='draft', string='Status', readonly=True)

    # Lifecycle status derived from start_trip / end_trip / trip_cancel.
    # Mirrors the React Native app's UI states so the list view shows
    # "Trip Started", "Trip Ended", "Cancelled" instead of just draft/validated.
    trip_status = fields.Selection([
        ('draft', 'Draft'),
        ('in_progress', 'Trip Started'),
        ('ended', 'Trip Ended'),
        ('cancelled', 'Cancelled'),
    ], string='Trip Status', compute='_compute_trip_status', store=True, readonly=True)

    # Transient (non-stored) flag that the form view watches to enable the
    # Update Trip button only when the user has unsaved changes. Reset to
    # False on every record load (default) and after each successful write.
    is_dirty = fields.Boolean(string='Is Dirty', store=False, default=False)

    @api.depends('start_trip', 'end_trip', 'trip_cancel')
    def _compute_trip_status(self):
        for rec in self:
            if rec.trip_cancel:
                rec.trip_status = 'cancelled'
            elif rec.end_trip:
                rec.trip_status = 'ended'
            elif rec.start_trip:
                rec.trip_status = 'in_progress'
            else:
                rec.trip_status = 'draft'

    # Compute fields
    @api.depends('start_km', 'end_km')
    def _compute_km_travelled(self):
        for rec in self:
            rec.km_travelled = max(rec.end_km - rec.start_km, 0)

    @api.depends('start_time', 'end_time')
    def _compute_duration(self):
        for rec in self:
            if rec.start_time and rec.end_time:
                delta = rec.end_time - rec.start_time
                rec.duration = round(delta.total_seconds() / 3600, 2)
            else:
                rec.duration = 0.0

    @api.onchange(
        'date', 'vehicle_id', 'driver_id', 'number_plate',
        'source_id', 'destination_id', 'start_km', 'end_km', 'purpose_of_visit_id',
        'start_time', 'end_time', 'invoice_number', 'amount', 'estimated_time',
        'coolant_water', 'oil_checking', 'tyre_checking',
        'battery_checking', 'daily_checks', 'fuel_checking',
        'image_url', 'remarks', 'invoice_line_ids',
    )
    def _onchange_mark_dirty(self):
        # Flip the transient flag so the view's `disabled="not is_dirty"` on the
        # Update Trip button enables instantly when the user edits any field.
        self.is_dirty = True

    @api.onchange('vehicle_id')
    def _onchange_vehicle_id(self):
        if self.vehicle_id:
            self.number_plate = self.vehicle_id.license_plate
            self.tank_capacity = self.vehicle_id.tank_capacity
        else:
            self.number_plate = False
            self.tank_capacity = 0.0

    @api.onchange('fuel_checking')
    def _onchange_fuel_checking(self):
        if self.fuel_checking:
            self.fuel_status = "Full"
        else:
            self.fuel_status = ""

    @api.onchange('invoice_number')
    def _onchange_invoice_number(self):
        if not self.invoice_number:
            self.invoice_match = False
            self.invoice_message = ""
            return

        invoice = self.env['account.move'].search([
            ('name', '=', self.invoice_number),
            ('move_type', '=', 'out_invoice')
        ], limit=1)

        if invoice:
            self.invoice_match = True
            self.invoice_message = "Invoice number matches ✓"
        else:
            self.invoice_match = False
            self.invoice_message = "Invoice number doesn't match ✗"

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            # Assign sequence — and skip past any ref that already exists on
            # another record (defensive: a previously-reset sequence could
            # otherwise hand out a duplicate VT-0001).
            if vals.get('ref', 'New') == 'New' or not vals.get('ref'):
                seq = self.env['ir.sequence']
                next_ref = seq.next_by_code('vehicle.tracking.seq') or 'New'
                # Up to 50 retries should be more than enough to walk past
                # any existing duplicates on a freshly-reset sequence.
                for _ in range(50):
                    if not self.search_count([('ref', '=', next_ref)]):
                        break
                    next_ref = seq.next_by_code('vehicle.tracking.seq') or 'New'
                vals['ref'] = next_ref
            # Set tank capacity from vehicle
            if vals.get('vehicle_id'):
                vehicle = self.env['fleet.vehicle'].browse(vals['vehicle_id'])
                vals['tank_capacity'] = vehicle.tank_capacity
            # Fuel checking validation
            if not vals.get('fuel_checking'):
                raise UserError("Fuel checking is not updated")
            # Default image_filename when the app sends image_url without one.
            if vals.get('image_url') and not vals.get('image_filename'):
                vals['image_filename'] = 'trip_image.jpg'
        return super(VehicleTracking, self).create(vals_list)

    # Fields that lifecycle buttons (End / Cancel / Reset to Draft) are allowed
    # to change even on a finalized record. Anything else is locked.
    _LIFECYCLE_FIELDS = {'start_trip', 'end_trip', 'trip_cancel', 'state', 'end_time'}

    def write(self, vals):
        # Lock guard: once a trip is ended or cancelled it becomes immutable.
        # Only lifecycle transitions (Reset to Draft, etc.) are allowed.
        for rec in self:
            if (rec.end_trip or rec.trip_cancel) and not self.env.context.get('bypass_lock'):
                invalid = set(vals.keys()) - self._LIFECYCLE_FIELDS
                if invalid:
                    raise UserError(
                        "This trip is finalized and cannot be edited. "
                        "Use 'Reset to Draft' first if you need to change %s."
                        % ', '.join(sorted(invalid))
                    )

        # Set tank capacity from vehicle
        if vals.get('vehicle_id'):
            vehicle = self.env['fleet.vehicle'].browse(vals['vehicle_id'])
            vals['tank_capacity'] = vehicle.tank_capacity
        # Fuel checking validation
        fuel_checking_value = vals.get('fuel_checking', self.fuel_checking)
        if not fuel_checking_value:
            raise UserError("Fuel checking is not updated")
        # Default image_filename when the app sends image_url without one.
        if 'image_url' in vals and vals.get('image_url') and not vals.get('image_filename'):
            vals['image_filename'] = 'trip_image.jpg'
        return super(VehicleTracking, self).write(vals)

    def action_add_fuel_log(self):
        self.ensure_one()
        return {
            'name': 'Add Fuel Entry',
            'type': 'ir.actions.act_window',
            'res_model': 'vehicle.fuel.log',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_vehicle_tracking_id': self.id,
                'default_vehicle_id': self.vehicle_id.id,
                'default_driver_id': self.driver_id.id,
            }
        }

    def action_validate(self):
        for rec in self:
            if rec.invoice_number:
                invoice = rec.env['account.move'].search([
                    ('name', '=', rec.invoice_number),
                    ('move_type', '=', 'out_invoice')
                ], limit=1)

                if not invoice:
                    rec.invoice_match = False
                    rec.invoice_message = "Invoice number doesn't match ✗"
                    raise UserError("Invoice number doesn't match any existing invoice!")

                rec.invoice_match = True
                rec.invoice_message = "Invoice number matches ✓"

            rec.state = 'validated'

    # --- Trip lifecycle (mirrors the React Native app's Start / Update / End flow) ---

    def _notify(self, title, message, kind='success'):
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': title,
                'message': message,
                'type': kind,
                'sticky': False,
            },
        }

    def action_start_trip(self):
        self.ensure_one()
        if self.trip_cancel:
            raise UserError("This trip is cancelled and cannot be started.")
        if self.end_trip:
            raise UserError("This trip is already ended.")
        if self.start_trip:
            raise UserError("This trip is already in progress.")
        # Force fuel_checking=True so the create/write constraint passes,
        # matches what the app does when the driver taps Start Trip.
        self.write({
            'start_trip': True,
            'fuel_checking': True,
            'start_time': self.start_time or fields.Datetime.now(),
        })
        # Returning None lets Odoo's web client refresh the record in place
        # — fastest path so the buttons' invisible expressions re-evaluate
        # immediately without a toast render pass.

    def action_update_trip(self):
        self.ensure_one()
        # The form auto-saves edits before invoking the button.
        self.write({})

    def action_end_trip(self):
        self.ensure_one()
        if self.trip_cancel:
            raise UserError("This trip is cancelled.")
        if not self.start_trip:
            raise UserError("Start the trip before ending it.")
        if self.end_trip:
            raise UserError("This trip is already ended.")
        self.write({
            'end_trip': True,
            'end_time': self.end_time or fields.Datetime.now(),
        })

    def action_cancel_trip(self):
        self.ensure_one()
        if self.end_trip:
            raise UserError("Completed trips cannot be cancelled.")
        if self.trip_cancel:
            raise UserError("This trip is already cancelled.")
        self.write({
            'trip_cancel': True,
            'start_trip': False,
        })

    def action_reset_to_draft(self):
        self.ensure_one()
        # Bring the trip back to its initial Draft state — clears every
        # lifecycle flag and the validation state so the user can re-edit
        # and re-trigger Start Trip from scratch.
        self.write({
            'start_trip': False,
            'end_trip': False,
            'trip_cancel': False,
            'state': 'draft',
            'end_time': False,
        })

    def action_save_fuel_log(self):
        """Close the popup window after saving."""
        return {'type': 'ir.actions.act_window_close'}

    def action_discard_custom(self):
        """Custom discard button – redirect to list view with a clean breadcrumb."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Vehicle Tracking',
            'res_model': 'vehicle.tracking',
            'view_mode': 'list,form',
            'view_id': False,
            # `target: main` resets the breadcrumb stack so we land on a fresh
            # list view without `VT-0002` lingering at the top.
            'target': 'main',
            'context': self.env.context,
        }

    def action_custom_save(self):
        self.ensure_one()
        if self.ref == 'New' and self.state == 'draft':
            self.ref = self.env['ir.sequence'].next_by_code('vehicle.tracking.seq') or 'New'
        return {
            'type': 'ir.actions.act_window',
            'name': 'Vehicle Tracking',
            'res_model': 'vehicle.tracking',
            'view_mode': 'list,form',
            # `target: main` resets the breadcrumb stack so we land on a fresh
            # list view (matches `/odoo/action-923`) without `VT-0002` lingering.
            'target': 'main',
            'context': self.env.context,
        }
