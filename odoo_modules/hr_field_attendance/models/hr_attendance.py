# -*- coding: utf-8 -*-
import logging
import pytz
from datetime import datetime, time, timedelta

from odoo import api, fields, models, _
from odoo.exceptions import AccessError

_logger = logging.getLogger(__name__)


class HrAttendance(models.Model):
    _inherit = 'hr.attendance'

    # --- Field attendance (trip + customer visit) ---
    attendance_source = fields.Selection([
        ('manual', 'Manual'),
        ('field', 'Field (Trip + Visit)'),
    ], string='Source', default='manual')
    gps_latitude = fields.Float(string='GPS Latitude', digits=(10, 7))
    gps_longitude = fields.Float(string='GPS Longitude', digits=(10, 7))
    gps_location_name = fields.Char(string='Location')
    source_trip_id = fields.Many2one(
        'vehicle.tracking', string='Source Trip', ondelete='set null',
    )
    source_visit_ids = fields.Many2many(
        'customer.visit', 'hr_attendance_customer_visit_rel',
        'attendance_id', 'visit_id', string='Source Visits',
    )
    # Extra trips linked to this same field-attendance day. Each line is a
    # mini Field Attendance section (Source Trip + Visited Stops + GPS +
    # Visits) so HR can capture multiple separate trips (e.g. morning trip
    # in vehicle A, afternoon trip in vehicle B) under one attendance. Trip
    # Totals at the bottom sum across source_trip_id + every row here.
    trip_line_ids = fields.One2many(
        'field.attendance.trip.line',
        'attendance_id',
        string='Additional Trips',
    )
    visited_stops_display = fields.Char(
        string='Visited Stops',
        compute='_compute_visited_stops_display',
        store=False,
        readonly=True,
    )
    # Trip-derived location pair (replaces the old "Visited Stops" line on
    # the field-attendance card). Read-only and pulled live from the trip.
    source_trip_source_location = fields.Char(
        related='source_trip_id.source_id.name',
        string='Source Location',
        readonly=True,
    )
    source_trip_destination_location = fields.Char(
        related='source_trip_id.destination_id.name',
        string='Destination Location',
        readonly=True,
    )
    source_visit_count = fields.Integer(
        string='Visit Count',
        compute='_compute_source_visit_count',
    )
    # Boolean shadow of source_visit_ids — used by the popup view's
    # `invisible` modifiers because Odoo 19 doesn't always re-evaluate
    # `invisible="bool(source_visit_ids)"` cleanly when the M2M membership
    # changes inside the same form. A computed boolean re-fires the
    # modifier reliably.
    has_source_visits = fields.Boolean(
        string='Has Source Visits',
        compute='_compute_has_source_visits',
    )
    # Lock flag: once the primary trip is ended, the entire primary card
    # (and the Edit Primary Trip popup) become readonly. Mirrors the
    # vehicle.tracking lifecycle lock — ended trips are immutable.
    source_trip_ended = fields.Boolean(
        related='source_trip_id.end_trip', readonly=True,
    )
    # Trips NOT yet used by this employee on any attendance — feeds the
    # Source Trip domain in both the primary and additional popups so the
    # same trip can't be picked twice across the employee's records.
    # NON-STORED computed M2M — no relation/column args (Odoo would try to
    # create a relation table that we never use, so we omit them and rely
    # on the compute method to populate the value at read time).
    available_trip_ids = fields.Many2many(
        'vehicle.tracking',
        string='Available Trips',
        compute='_compute_available_trip_ids',
    )
    # Trip totals — surfaced on the Field Attendance form so HR sees
    # km_travelled / duration / fuel litres / fuel amount at a glance.
    # Defensive non-related computes (same pattern as visited_stops_display)
    # so the registry doesn't crash if vehicle.tracking's class is half
    # loaded after an autoreload cycle.
    trip_total_km = fields.Integer(
        string='Total KM Travelled',
        compute='_compute_trip_totals',
        store=False,
        readonly=True,
    )
    trip_total_duration = fields.Float(
        string='Total Duration',
        compute='_compute_trip_totals',
        store=False,
        readonly=True,
    )
    trip_total_fuel_litres = fields.Float(
        string='Total Fuel (Litres)',
        compute='_compute_trip_totals',
        store=False,
        readonly=True,
        digits=(12, 2),
    )
    trip_total_fuel_amount = fields.Float(
        string='Total Fuel Amount',
        compute='_compute_trip_totals',
        store=False,
        readonly=True,
        digits=(12, 2),
    )

    # --- Computes -----------------------------------------------------------

    @api.depends('source_trip_id')
    def _compute_visited_stops_display(self):
        # Pulled from source_trip_id.visited_stops_display via getattr so
        # the field declaration doesn't trigger a setup_related strict
        # check against vehicle.tracking at registry build time.
        for rec in self:
            trip = rec.source_trip_id
            rec.visited_stops_display = getattr(trip, 'visited_stops_display', False) or ''

    @api.depends('source_visit_ids')
    def _compute_source_visit_count(self):
        for rec in self:
            rec.source_visit_count = len(rec.source_visit_ids)

    @api.depends('source_visit_ids')
    def _compute_has_source_visits(self):
        for rec in self:
            rec.has_source_visits = bool(rec.source_visit_ids)

    @api.depends('employee_id', 'source_trip_id', 'trip_line_ids.trip_id')
    def _compute_available_trip_ids(self):
        """Trips that are still UNUSED across this employee's attendances.

        Excludes:
          - trips already linked on any OTHER attendance of this employee
          - trips already linked on THIS attendance (primary source_trip_id
            or any trip_line) so the same trip never gets picked twice
            across the employee's records.

        The primary popup view OR-includes the current `source_trip_id` in
        its domain so an existing selection stays visible/editable in that
        dialog. The additional-trip popup only shows truly available trips
        (this list as-is) so a new line can never duplicate an existing one.
        """
        Tracking = self.env['vehicle.tracking'].sudo()
        for rec in self:
            if not rec.employee_id:
                rec.available_trip_ids = Tracking
                continue
            others = self.sudo().search([
                ('employee_id', '=', rec.employee_id.id),
                ('id', '!=', rec.id if isinstance(rec.id, int) else 0),
            ])
            used_by_others = others.mapped('source_trip_id') | \
                             others.mapped('trip_line_ids.trip_id')
            self_used = rec.source_trip_id | rec.trip_line_ids.mapped('trip_id')
            used_total = used_by_others | self_used
            # Hard-exclude ended/cancelled trips so they never reach the
            # picker dropdown regardless of how the view domain parses.
            available = Tracking.search([
                ('id', 'not in', used_total.ids),
                ('trip_status', 'not in', ('ended', 'cancelled')),
            ])
            rec.available_trip_ids = available

    @api.depends(
        'source_trip_id', 'trip_line_ids', 'trip_line_ids.trip_id',
        'source_trip_id.km_travelled', 'source_trip_id.duration',
        'source_trip_id.total_fuel_litres', 'source_trip_id.total_fuel_amount',
        'trip_line_ids.km_travelled', 'trip_line_ids.duration',
        'trip_line_ids.total_fuel_litres', 'trip_line_ids.total_fuel_amount',
    )
    def _compute_trip_totals(self):
        """Sum primary source_trip_id PLUS every trip_line, treating each
        line entry as a SEPARATE contribution.

        Earlier this used `source_trip_id | trip_line_ids.mapped('trip_id')`
        which is a record-set union — it deduplicated repeated trip IDs and
        also short-circuited when `mapped()` returned cached/stale data.
        Iterating explicitly per row guarantees:
          - every trip_line counts even if it points to the same vehicle
            tracking record as the primary or another line
          - no caching surprises from `mapped()`
        """
        for rec in self:
            total_km = 0
            total_duration = 0.0
            total_fuel_litres = 0.0
            total_fuel_amount = 0.0
            primary = rec.source_trip_id
            if primary:
                total_km += getattr(primary, 'km_travelled', 0) or 0
                total_duration += getattr(primary, 'duration', 0.0) or 0.0
                total_fuel_litres += getattr(primary, 'total_fuel_litres', 0.0) or 0.0
                total_fuel_amount += getattr(primary, 'total_fuel_amount', 0.0) or 0.0
            for line in rec.trip_line_ids:
                trip = line.trip_id
                if not trip:
                    continue
                total_km += getattr(trip, 'km_travelled', 0) or 0
                total_duration += getattr(trip, 'duration', 0.0) or 0.0
                total_fuel_litres += getattr(trip, 'total_fuel_litres', 0.0) or 0.0
                total_fuel_amount += getattr(trip, 'total_fuel_amount', 0.0) or 0.0
            rec.trip_total_km = int(total_km)
            rec.trip_total_duration = float(total_duration)
            rec.trip_total_fuel_litres = float(total_fuel_litres)
            rec.trip_total_fuel_amount = float(total_fuel_amount)

    # --- Onchange -----------------------------------------------------------

    @api.onchange('source_trip_id')
    def _onchange_source_trip_id_default_gps(self):
        """When the user picks a Source Trip in the Edit Primary Trip popup,
        instantly fill GPS Latitude / Longitude / Location from the trip
        (mirrors the additional-trip popup which uses related fields).

        Only fills when the target field is currently empty so we never
        overwrite values the user typed manually or that came from the
        first-visit GPS sync.
        """
        if not self.source_trip_id:
            return
        trip = self.source_trip_id
        if not (self.gps_latitude or self.gps_longitude):
            self.gps_latitude = self._to_float_or_zero(trip.start_latitude)
            self.gps_longitude = self._to_float_or_zero(trip.start_longitude)
        if not self.gps_location_name and trip.source_id:
            self.gps_location_name = trip.source_id.name

    # --- Action methods -----------------------------------------------------

    def action_open_source_trip(self):
        self.ensure_one()
        if not self.source_trip_id:
            return False
        return {
            'type': 'ir.actions.act_window',
            'name': 'Edit Trip — %s' % (self.source_trip_id.ref or ''),
            'res_model': 'vehicle.tracking',
            'res_id': self.source_trip_id.id,
            'view_mode': 'form',
            'target': 'new',  # open in dialog so user edits without losing the attendance context
        }

    def action_view_source_visits(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Source Visits',
            'res_model': 'customer.visit',
            'view_mode': 'list,form',
            'domain': [('id', 'in', self.source_visit_ids.ids)],
            'context': {'create': False},
        }

    def action_add_additional_trip(self):
        """Orchestrate the "add a new additional trip" workflow.

        If a previous trip is still open (primary or last trip_line),
        FIRST open that trip in a popup with a disclaimer banner so the
        user enters End KM before closing it. After they save, they click
        "Add Additional Trips" again — by then the previous trip is ended,
        and this method falls through to opening the new trip-line
        creation popup.

        If there's no open previous trip, jump straight to the new
        trip-line creation popup.
        """
        self.ensure_one()
        # Find the most recent trip on this attendance
        if self.trip_line_ids:
            last_trip = self.trip_line_ids.sorted('sequence', reverse=True)[:1].trip_id
        else:
            last_trip = self.source_trip_id
        if last_trip and not last_trip.end_trip and not last_trip.trip_cancel:
            return {
                'type': 'ir.actions.act_window',
                'name': 'Close Previous Trip — %s' % (last_trip.ref or ''),
                'res_model': 'vehicle.tracking',
                'res_id': last_trip.id,
                'view_mode': 'form',
                'target': 'new',
                'context': {
                    'show_end_disclaimer': True,
                    'redirect_to_attendance_id': self.id,
                },
            }
        return {
            'type': 'ir.actions.act_window',
            'name': 'Add Additional Trip',
            'res_model': 'field.attendance.trip.line',
            'view_mode': 'form',
            'view_id': self.env.ref(
                'hr_field_attendance.view_field_attendance_trip_line_form'
            ).id,
            'target': 'new',
            'context': {'default_attendance_id': self.id},
        }

    def action_edit_primary_trip(self):
        """Open hr.attendance in a popup with a stripped form view that
        only exposes Source Trip + Visits — mirrors the additional-trip
        popup so the user edits both with the same flow.
        """
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Edit Primary Trip' if self.source_trip_id else 'Setup Primary Trip',
            'res_model': 'hr.attendance',
            'res_id': self.id,
            'view_mode': 'form',
            'view_id': self.env.ref(
                'hr_field_attendance.view_attendance_primary_trip_dialog'
            ).id,
            'target': 'new',
        }

    # --- Sync helpers (create / write side-effects) -------------------------

    def _sync_gps_from_first_visit(self):
        """Backfill gps_latitude/longitude from the earliest source visit's
        coords when the attendance has no GPS of its own.

        Only fires when the existing values are 0/empty — never overwrites
        manually-set coordinates. Lets old field-attendances created before
        the create_field_attendance fix self-heal on next save.
        """
        for rec in self:
            if rec.attendance_source != 'field' or not rec.source_visit_ids:
                continue
            if rec.gps_latitude or rec.gps_longitude:
                continue
            first_visit = rec.source_visit_ids.sorted('date_time')[:1]
            if not first_visit:
                continue
            lat = self._to_float_or_zero(first_visit.latitude)
            lng = self._to_float_or_zero(first_visit.longitude)
            if lat or lng:
                rec.write({'gps_latitude': lat, 'gps_longitude': lng})

    def _sync_source_trip_visits(self):
        """Nudge each linked vehicle.tracking row to refresh its visit_ids.

        Trip's @api.depends only fires on driver_id/date changes — but our
        trip._compute_visit_ids reads BACK from hr.attendance.source_trip_id
        as one of its sources. So creating an attendance with source_trip_id
        set, or reassigning the trip on an existing attendance, must trigger
        a manual recompute on the trip side.

        Soft dependency: skip if vehicle.tracking isn't in the registry.
        """
        if 'vehicle.tracking' not in self.env:
            return
        trips = self.mapped('source_trip_id')
        if not trips:
            return
        trips._compute_visit_ids()
        trips._compute_visited_stops_display()
        trips._compute_visited_stop_count()
        trips.flush_recordset()

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        # Field-attendance side-effects: when source_trip_id is set on the
        # new attendance, the trip's visit_ids/visited_stops_display won't
        # auto-recompute (its @api.depends only watches driver_id/date),
        # so we nudge it here. Defensive try/except so a vehicle_tracking
        # registry hiccup doesn't break attendance creation.
        try:
            recs._sync_source_trip_visits()
        except Exception:
            _logger.exception("[field-attendance] post-create trip stops sync failed")
        try:
            recs._sync_gps_from_first_visit()
        except Exception:
            _logger.exception("[field-attendance] post-create gps sync failed")
        return recs

    def write(self, vals):
        res = super().write(vals)
        if any(k in vals for k in ('source_trip_id', 'source_visit_ids')):
            try:
                self._sync_source_trip_visits()
            except Exception:
                _logger.exception("[field-attendance] post-write trip stops sync failed")
            try:
                self._sync_gps_from_first_visit()
            except Exception:
                _logger.exception("[field-attendance] post-write gps sync failed")
        # On checkout: end the last open trip (the one whose visits the user
        # just finished) and mark every linked visit as Done. Mirrors the UX
        # of the mobile app's "End Trip & Mark Attendance" tap.
        if 'check_out' in vals and vals.get('check_out'):
            try:
                self._on_checkout_finalize_trips_and_visits()
            except Exception:
                _logger.exception("[field-attendance] checkout finalize failed")
        return res

    def _on_checkout_finalize_trips_and_visits(self):
        """Auto-end the most recent unfinished trip and mark every visit
        on this attendance as Done.

        - "Most recent trip" = the last trip_line if any, else the primary
          source_trip_id. We end ONLY the last open trip — earlier trips
          should already have been ended when the next was added.
        - All source_visit_ids and trip_line.visit_ids are flipped from
          draft -> done.
        """
        for rec in self:
            if rec.attendance_source != 'field':
                continue
            # 1. End the last open trip
            if rec.trip_line_ids:
                last_line = rec.trip_line_ids.sorted('sequence', reverse=True)[:1]
                last_trip = last_line.trip_id
            else:
                last_trip = rec.source_trip_id
            if last_trip and not last_trip.end_trip and not last_trip.trip_cancel:
                last_trip.write({
                    'end_trip': True,
                    'end_time': last_trip.end_time or rec.check_out or fields.Datetime.now(),
                })
            # 2. Mark every linked visit as Done
            all_visits = rec.source_visit_ids | \
                         rec.trip_line_ids.mapped('visit_ids')
            draft_visits = all_visits.filtered(lambda v: v.state == 'draft')
            if draft_visits:
                draft_visits.write({'state': 'done'})

    # --- Field-attendance RPCs (used by the mobile app) ---------------------

    def _employee_today_window(self, employee):
        """Return (utc_today_start, utc_today_end, local_date) for the
        employee's local timezone."""
        tz = pytz.timezone(employee.tz or self.env.user.tz or 'UTC')
        local_now = datetime.now(tz)
        day_start_local = tz.localize(datetime.combine(local_now.date(), time.min))
        day_end_local = day_start_local + timedelta(days=1)
        return (
            day_start_local.astimezone(pytz.utc).replace(tzinfo=None),
            day_end_local.astimezone(pytz.utc).replace(tzinfo=None),
            local_now.date(),
        )

    def _employee_partner_ids(self, employee):
        """Map an hr.employee to res.partner ids that may be used as the
        driver_id on vehicle.tracking. Different mappings depending on how
        the trip was created: work_contact_id, user_id.partner_id,
        address_home_id (legacy)."""
        partner_ids = []
        if employee.work_contact_id:
            partner_ids.append(employee.work_contact_id.id)
        if employee.user_id and employee.user_id.partner_id:
            partner_ids.append(employee.user_id.partner_id.id)
        legacy = getattr(employee, 'address_home_id', False)
        if legacy:
            partner_ids.append(legacy.id)
        return list(set(partner_ids))

    def _check_field_attendance_access(self, employee):
        """Employee may only mark their own attendance. HR users override."""
        if self.env.user.has_group('hr.group_hr_user'):
            return
        if not employee.user_id or employee.user_id.id != self.env.user.id:
            raise AccessError(_(
                "You can only mark field attendance for yourself."
            ))

    def _serialize_trip(self, trip):
        return {
            'id': trip.id,
            'ref': trip.ref or '',
            'start_time': str(trip.start_time) if trip.start_time else None,
            'end_time': str(trip.end_time) if trip.end_time else None,
            'start_latitude': trip.start_latitude or '',
            'start_longitude': trip.start_longitude or '',
            'end_latitude': trip.end_latitude or '',
            'end_longitude': trip.end_longitude or '',
            'source': trip.source_id.name if trip.source_id else '',
            'destination': trip.destination_id.name if trip.destination_id else '',
            'purpose': trip.purpose_of_visit_id.name if trip.purpose_of_visit_id else '',
            'trip_status': trip.trip_status,
        }

    def _serialize_visit(self, visit):
        return {
            'id': visit.id,
            'name': visit.name or '',
            'customer': visit.partner_id.name if visit.partner_id else '',
            'date_time': str(visit.date_time) if visit.date_time else None,
            'latitude': visit.latitude,
            'longitude': visit.longitude,
            'location_name': visit.location_name or '',
            'purpose': visit.purpose_id.name if visit.purpose_id else '',
            'state': visit.state,
        }

    def _to_float_or_zero(self, value):
        """vehicle.tracking stores GPS as Char — coerce to float for storage."""
        if value in (None, False, ''):
            return 0.0
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    @api.model
    def get_today_field_attendance(self, employee_id):
        """Inspect today's field attendance for the given employee.

        State machine (mobile app uses these statuses verbatim):
          'eligible'         — no attendance today; ready to tap Check In
          'checked_in_open'  — field attendance exists, check_out is False
          'checked_out'      — field attendance exists, check_out is set
          'manual_exists'    — non-field attendance already exists today

        Trips/visits are no longer required to reach 'eligible'; the user
        can check in first and pick a trip / link visits later via Edit
        Primary Trip / Add Additional Trip.
        """
        employee = self.env['hr.employee'].sudo().browse(employee_id)
        if not employee.exists():
            return {'status': 'eligible', 'trip': None, 'visits': [],
                    'attendance_id': None, 'check_in': None, 'check_out': None}

        self._check_field_attendance_access(employee)

        utc_start, utc_end, _ = self._employee_today_window(employee)

        Attendance = self.env['hr.attendance'].sudo()
        existing = Attendance.search([
            ('employee_id', '=', employee.id),
            ('check_in', '>=', utc_start),
            ('check_in', '<', utc_end),
        ], limit=1, order='check_in asc')

        if existing:
            if existing.attendance_source == 'field':
                return {
                    'status': 'checked_out' if existing.check_out else 'checked_in_open',
                    'trip': self._serialize_trip(existing.source_trip_id) if existing.source_trip_id else None,
                    'visits': [self._serialize_visit(v) for v in existing.source_visit_ids],
                    'attendance_id': existing.id,
                    'check_in': str(existing.check_in) if existing.check_in else None,
                    'check_out': str(existing.check_out) if existing.check_out else None,
                }
            return {
                'status': 'manual_exists',
                'trip': None,
                'visits': [],
                'attendance_id': existing.id,
                'check_in': str(existing.check_in) if existing.check_in else None,
                'check_out': str(existing.check_out) if existing.check_out else None,
            }

        return {
            'status': 'eligible',
            'trip': None,
            'visits': [],
            'attendance_id': None,
            'check_in': None,
            'check_out': None,
        }

    @api.model
    def start_field_attendance(self, employee_id):
        """Open a field attendance for today (check_in=now, no check_out).

        Best-effort: auto-links today's earliest trip + all of the employee's
        visits IF they already exist; otherwise leaves them empty so the user
        can pick them later from the mobile app via Edit Primary Trip and
        Add Additional Trip. GPS prefers the first visit's coordinates over
        the trip's start coords (matches create_field_attendance behaviour).
        """
        employee = self.env['hr.employee'].sudo().browse(employee_id)
        if not employee.exists():
            return {'success': False, 'error': _('Employee not found.')}

        self._check_field_attendance_access(employee)

        utc_start, utc_end, local_date = self._employee_today_window(employee)

        Attendance = self.env['hr.attendance'].sudo()
        existing = Attendance.search([
            ('employee_id', '=', employee.id),
            ('check_in', '>=', utc_start),
            ('check_in', '<', utc_end),
        ], limit=1)
        if existing:
            if existing.attendance_source == 'field':
                return {
                    'success': False,
                    'error': _('Field attendance already started today.'),
                    'attendance_id': existing.id,
                }
            return {
                'success': False,
                'error': _('Manual attendance already exists for today.'),
                'attendance_id': existing.id,
            }

        # Best-effort auto-link to existing trip / visits.
        partner_ids = self._employee_partner_ids(employee)
        primary_trip_id = False
        visit_ids = []
        gps_lat = 0.0
        gps_lng = 0.0
        gps_name = ''
        if partner_ids:
            Trip = self.env['vehicle.tracking'].sudo()
            trips = Trip.search([
                ('driver_id', 'in', partner_ids),
                ('date', '=', local_date),
                ('trip_status', 'in', ['in_progress', 'ended']),
            ], order='start_time asc', limit=1)
            if trips:
                primary_trip_id = trips[0].id
                gps_lat = self._to_float_or_zero(trips[0].start_latitude)
                gps_lng = self._to_float_or_zero(trips[0].start_longitude)
                gps_name = trips[0].source_id.name if trips[0].source_id else ''
            Visit = self.env['customer.visit'].sudo()
            visits = Visit.search([
                ('employee_id', '=', employee.id),
                ('date_time', '>=', utc_start),
                ('date_time', '<', utc_end),
            ], order='date_time asc')
            visit_ids = visits.ids
            if visits:
                first_visit = visits[0]
                v_lat = self._to_float_or_zero(first_visit.latitude)
                v_lng = self._to_float_or_zero(first_visit.longitude)
                if v_lat or v_lng:
                    gps_lat, gps_lng = v_lat, v_lng
                if first_visit.location_name:
                    gps_name = first_visit.location_name

        vals = {
            'employee_id': employee.id,
            'check_in': fields.Datetime.now(),
            'attendance_source': 'field',
            'gps_latitude': gps_lat,
            'gps_longitude': gps_lng,
            'gps_location_name': gps_name,
        }
        if primary_trip_id:
            vals['source_trip_id'] = primary_trip_id
        if visit_ids:
            vals['source_visit_ids'] = [(6, 0, visit_ids)]

        new_record = Attendance.create(vals)
        new_record.flush_recordset()
        return {
            'success': True,
            'attendance_id': new_record.id,
            'is_late': bool(new_record.is_late),
            'late_minutes': int(new_record.late_minutes or 0),
            'late_minutes_display': new_record.late_minutes_display or '',
            'expected_start_time': float(new_record.expected_start_time or 0.0),
            'check_in': str(new_record.check_in) if new_record.check_in else None,
            'needs_late_reason': bool(new_record.is_late) and not new_record.late_reason,
        }

    @api.model
    def create_field_attendance(self, employee_id):
        """Create today's hr.attendance row from the employee's trip + visits.

        Idempotent: refuses unless get_today_field_attendance returns 'eligible'.
        Mirrors the eligibility logic so the conflict check is enforced
        server-side regardless of stale client state.

        Returns: {'success': True, 'attendance_id': id}
              or {'success': False, 'error': str}
        """
        employee = self.env['hr.employee'].sudo().browse(employee_id)
        if not employee.exists():
            return {'success': False, 'error': _('Employee not found.')}

        self._check_field_attendance_access(employee)

        utc_start, utc_end, local_date = self._employee_today_window(employee)

        Attendance = self.env['hr.attendance'].sudo()
        existing = Attendance.search([
            ('employee_id', '=', employee.id),
            ('check_in', '>=', utc_start),
            ('check_in', '<', utc_end),
        ], limit=1)
        if existing:
            if existing.attendance_source == 'field':
                return {'success': False, 'error': _('Field attendance already marked for today.')}
            return {'success': False, 'error': _('Manual attendance already exists for today.')}

        partner_ids = self._employee_partner_ids(employee)
        if not partner_ids:
            return {'success': False, 'error': _('No partner mapping for this employee.')}

        Trip = self.env['vehicle.tracking'].sudo()
        trips = Trip.search([
            ('driver_id', 'in', partner_ids),
            ('date', '=', local_date),
            ('trip_status', 'in', ['in_progress', 'ended']),
        ], order='start_time asc')

        if not trips:
            return {'success': False, 'error': _('No vehicle trip found for today.')}

        if any(t.trip_status == 'in_progress' for t in trips):
            return {'success': False, 'error': _('End your trip before marking attendance.')}

        Visit = self.env['customer.visit'].sudo()
        visits = Visit.search([
            ('employee_id', '=', employee.id),
            ('date_time', '>=', utc_start),
            ('date_time', '<', utc_end),
        ], order='date_time asc')

        if not visits:
            return {'success': False, 'error': _('Log at least one customer visit before marking attendance.')}

        # Span the day: earliest trip start → latest trip end.
        check_in_dt = min(t.start_time for t in trips if t.start_time)
        check_out_dt = max(t.end_time for t in trips if t.end_time)
        primary_trip = trips[0]
        first_visit = visits[0]

        # GPS: prefer the first visit's coords (the salesperson actually
        # stood at the customer location with their phone) over the trip's
        # start coords (often 0,0 because the driver didn't grant location
        # permission at trip start). Trip is only used as a fallback.
        visit_lat = self._to_float_or_zero(first_visit.latitude)
        visit_lng = self._to_float_or_zero(first_visit.longitude)
        if visit_lat or visit_lng:
            gps_lat, gps_lng = visit_lat, visit_lng
        else:
            gps_lat = self._to_float_or_zero(primary_trip.start_latitude)
            gps_lng = self._to_float_or_zero(primary_trip.start_longitude)

        vals = {
            'employee_id': employee.id,
            'check_in': check_in_dt,
            'check_out': check_out_dt,
            'attendance_source': 'field',
            'gps_latitude': gps_lat,
            'gps_longitude': gps_lng,
            'gps_location_name': first_visit.location_name or (
                primary_trip.source_id.name if primary_trip.source_id else ''
            ),
            'source_trip_id': primary_trip.id,
            'source_visit_ids': [(6, 0, visits.ids)],
        }

        new_record = Attendance.create(vals)
        new_record.flush_recordset()
        return {
            'success': True,
            'attendance_id': new_record.id,
            'is_late': bool(new_record.is_late),
            'late_minutes': int(new_record.late_minutes or 0),
            'late_minutes_display': new_record.late_minutes_display or '',
            'expected_start_time': float(new_record.expected_start_time or 0.0),
            'check_in': str(new_record.check_in) if new_record.check_in else None,
            'needs_late_reason': bool(new_record.is_late) and not new_record.late_reason,
        }
