# -*- coding: utf-8 -*-
import logging
import pytz
from datetime import datetime, time, timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

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

    # Transient inputs (not stored) — the mobile app sends a captured place as a
    # name + coordinates (source from the driver's current GPS, destination from
    # the in-app map picker) instead of a pre-configured location id. create()/
    # write() resolve these into real vehicle.location records and set
    # source_id / destination_id, so every downstream feature that relies on
    # those Many2ones keeps working. See _resolve_location_inputs below.
    source_name = fields.Char(string='Source Name (input)', store=False)
    source_latitude = fields.Float(string='Source Latitude (input)', store=False, digits=(16, 8))
    source_longitude = fields.Float(string='Source Longitude (input)', store=False, digits=(16, 8))
    destination_name = fields.Char(string='Destination Name (input)', store=False)
    destination_latitude = fields.Float(string='Destination Latitude (input)', store=False, digits=(16, 8))
    destination_longitude = fields.Float(string='Destination Longitude (input)', store=False, digits=(16, 8))

    start_km = fields.Integer(string='Start Km', default=0)
    end_km = fields.Integer(string='End Km', default=0)
    km_travelled = fields.Integer(string='KM Travelled', compute='_compute_km_travelled', store=True)
    # Shared purpose model with customer.visit -- both fields point at
    # `visit.purpose` so adding a purpose in either place surfaces in both.
    # See migrations/19.0.2.0.0/pre-migration.py for the one-time data
    # migration from the old vehicle.purpose model.
    purpose_of_visit_id = fields.Many2one('visit.purpose', string="Purpose of Visit")

    start_time = fields.Datetime(string='Start Time', default=fields.Datetime.now)
    end_time = fields.Datetime(string='End Time')
    duration = fields.Float(string='Duration (Hrs)', compute='_compute_duration', store=True)
    invoice_number = fields.Char(string='Invoice Number')
    invoice_match = fields.Boolean(string="Invoice Match", readonly=True)
    invoice_message = fields.Char(string="Invoice Message", readonly=True)

    amount = fields.Float(string='Amount')
    estimated_time = fields.Float(string='Estimated Time (Hrs)', default=00.00)
    estimated_km = fields.Float(string='Estimated KM', default=0.00)

    # Trip comparison — actual minus estimated. Both stored so admins can
    # sort the list view by biggest variance. Positive = trip ran LONGER
    # than estimated.
    km_variance = fields.Float(
        string='KM Variance',
        compute='_compute_km_variance', store=True,
        help='Actual km_travelled minus estimated_km. '
             'Positive = trip was longer than estimated.')
    time_variance = fields.Float(
        string='Time Variance (Hrs)',
        compute='_compute_time_variance', store=True,
        help='Actual duration minus estimated_time. '
             'Positive = trip took longer than estimated.')

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

    # Auto-derived: the customer.visit rows logged by this trip's driver on
    # the same date. Stored so HR list views can sort/filter by stop count
    # without a per-record fan-out search. Kept live by the recompute hook
    # on customer.visit.create / write (see customer_visit.py).
    visit_ids = fields.Many2many(
        'customer.visit',
        relation='vehicle_tracking_customer_visit_rel',
        column1='tracking_id', column2='visit_id',
        string='Visits',
        compute='_compute_visit_ids', store=True,
    )
    visited_stops_display = fields.Char(
        string='Visited Stops',
        compute='_compute_visited_stops_display', store=True,
        help="Auto-filled from today's customer visits for this driver.",
    )
    visited_stop_count = fields.Integer(
        string='Stop Count',
        compute='_compute_visited_stop_count', store=True,
    )

    # Aggregates over fuel_log_ids — exposed as related fields on
    # hr.attendance so the Field Attendance form can show one tidy
    # "Trip Totals" row without re-walking the One2many on every render.
    total_fuel_litres = fields.Float(
        string='Total Fuel (Litres)',
        compute='_compute_fuel_totals', store=True,
        digits=(12, 2),
    )
    total_fuel_amount = fields.Float(
        string='Total Fuel Amount',
        compute='_compute_fuel_totals', store=True,
        digits=(12, 2),
    )

    @api.depends('fuel_log_ids', 'fuel_log_ids.fuel_level', 'fuel_log_ids.amount')
    def _compute_fuel_totals(self):
        for rec in self:
            rec.total_fuel_litres = sum(rec.fuel_log_ids.mapped('fuel_level')) or 0.0
            rec.total_fuel_amount = sum(rec.fuel_log_ids.mapped('amount')) or 0.0

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

    @api.depends('km_travelled', 'estimated_km')
    def _compute_km_variance(self):
        for rec in self:
            rec.km_variance = (rec.km_travelled or 0) - (rec.estimated_km or 0)

    @api.depends('duration', 'estimated_time')
    def _compute_time_variance(self):
        for rec in self:
            rec.time_variance = (rec.duration or 0) - (rec.estimated_time or 0)

    # --- Visited stops (auto-derived from customer.visit) -----------------

    def _resolve_employee_from_driver(self):
        """Find the hr.employee for driver_id (a res.partner).

        Tries work_contact_id, then user_id.partner_id, then address_home_id
        (older Odoo). Returns an empty recordset if no link can be made —
        callers handle that as "no visits".
        """
        self.ensure_one()
        if not self.driver_id:
            return self.env['hr.employee']
        Employee = self.env['hr.employee'].sudo()
        emp = Employee.search([('work_contact_id', '=', self.driver_id.id)], limit=1)
        if not emp:
            emp = Employee.search([('user_id.partner_id', '=', self.driver_id.id)], limit=1)
        if not emp and 'address_home_id' in Employee._fields:
            emp = Employee.search([('address_home_id', '=', self.driver_id.id)], limit=1)
        return emp

    @api.depends('driver_id', 'date')
    def _compute_visit_ids(self):
        """Stops on this trip = union of two sources:

        1. Visits already linked to a field-attendance whose source_trip_id
           is this trip — that's the canonical link recorded by
           create_field_attendance, and it's authoritative even when the
           visit's employee is NOT the same person as the trip's driver
           (common case: a dispatcher drives, a salesperson logs visits).

        2. Visits whose employee is the driver's resolved employee on the
           same calendar day — covers the in-progress case where the
           field-attendance hasn't been created yet (trip is still
           running, no attendance row exists to provide the M2M link).

        Storing the union gives HR the stops view from the moment the
        first visit is logged, and stays stable once the attendance
        wraps things up at end-of-day.
        """
        Visit = self.env['customer.visit'].sudo()
        Attendance = self.env['hr.attendance'].sudo() if 'hr.attendance' in self.env else None
        for rec in self:
            visit_ids = set()

            # Source 1: visits already linked via field-attendance
            if Attendance is not None and rec.id:
                attendances = Attendance.search([('source_trip_id', '=', rec.id)])
                for att in attendances:
                    visit_ids.update(att.source_visit_ids.ids)

            # Source 2: same-day visits for the driver's resolved employee
            employee = rec._resolve_employee_from_driver()
            if employee and rec.date:
                tz = pytz.timezone(employee.tz or 'UTC')
                local_start = tz.localize(datetime.combine(rec.date, time.min))
                local_end = local_start + timedelta(days=1)
                utc_start = local_start.astimezone(pytz.utc).replace(tzinfo=None)
                utc_end = local_end.astimezone(pytz.utc).replace(tzinfo=None)
                visits = Visit.search([
                    ('employee_id', '=', employee.id),
                    ('date_time', '>=', utc_start),
                    ('date_time', '<', utc_end),
                ], order='date_time asc')
                visit_ids.update(visits.ids)

            if not visit_ids:
                rec.visit_ids = [(5, 0, 0)]
                continue

            # Re-sort by date_time so visited_stops_display is chronological
            ordered = Visit.search(
                [('id', 'in', list(visit_ids))],
                order='date_time asc',
            )
            rec.visit_ids = [(6, 0, ordered.ids)]

    @api.depends('visit_ids', 'visit_ids.location_name', 'visit_ids.partner_id')
    def _compute_visited_stops_display(self):
        for rec in self:
            names = []
            for v in rec.visit_ids:
                label = v.location_name or (v.partner_id.name if v.partner_id else '')
                if label:
                    names.append(label)
            rec.visited_stops_display = ', '.join(names)

    @api.depends('visit_ids')
    def _compute_visited_stop_count(self):
        for rec in self:
            rec.visited_stop_count = len(rec.visit_ids)

    def action_view_visits(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Visits — %s' % (self.ref or ''),
            'res_model': 'customer.visit',
            'view_mode': 'list,form',
            'domain': [('id', 'in', self.visit_ids.ids)],
            'context': {'create': False},
        }

    @api.onchange(
        'date', 'vehicle_id', 'driver_id', 'number_plate',
        'source_id', 'destination_id', 'start_km', 'end_km', 'purpose_of_visit_id',
        'start_time', 'end_time', 'invoice_number', 'amount', 'estimated_time', 'estimated_km',
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

    def _resolve_location_inputs(self, vals):
        """Turn app-sent place name+coords into source_id / destination_id.

        Mutates `vals` in place: when the mobile app sends source_/destination_
        name + latitude + longitude (instead of an id), find-or-create the
        matching vehicle.location and set the corresponding Many2one. The
        transient keys are always stripped so they never reach the ORM (they are
        non-stored fields with no column). An explicit *_id in vals always wins.
        """
        Location = self.env['vehicle.location']
        for prefix, id_field in (('source', 'source_id'), ('destination', 'destination_id')):
            name = vals.pop('%s_name' % prefix, None)
            lat = vals.pop('%s_latitude' % prefix, None)
            lng = vals.pop('%s_longitude' % prefix, None)
            if vals.get(id_field):
                continue
            if lat in (None, False, '') or lng in (None, False, ''):
                continue
            location = Location.find_or_create_from_coords(name, lat, lng)
            if location:
                vals[id_field] = location.id

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            self._resolve_location_inputs(vals)
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
        # Resolve app-sent place name+coords into source_id/destination_id first,
        # stripping the transient keys before the lock guard inspects vals.
        self._resolve_location_inputs(vals)
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
        # Block the action if the driver hasn't entered the start odometer
        # reading. Without it the trip's km_travelled compute can't run and
        # downstream Trip Totals on hr.attendance show 0. Surface a popup so
        # the user is forced to fix it before continuing.
        if not self.start_km or self.start_km <= 0:
            raise UserError("Please enter the Start KM before starting the trip.")
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
        # Block End Trip until the driver has entered the end-of-trip
        # odometer reading. Same reasoning as action_start_trip — required
        # for km_travelled / Trip Totals to be meaningful, and the Field
        # Attendance close-previous-trip popup explicitly tells the user
        # to fill End KM before clicking End Trip.
        if not self.end_km or self.end_km <= 0:
            raise UserError("Please enter the End KM before ending the trip.")
        if self.end_km < self.start_km:
            raise UserError(
                "End KM (%s) cannot be less than Start KM (%s)."
                % (self.end_km, self.start_km)
            )
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
