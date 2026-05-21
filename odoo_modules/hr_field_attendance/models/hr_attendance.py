# -*- coding: utf-8 -*-
import logging
import pytz
from datetime import datetime, time, timedelta

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError

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
    # Split views of trip_line_ids by is_return_trip flag. Using one
    # `<field name="trip_line_ids">` per section with a `domain=` attribute
    # in the XML view did NOT filter reliably under Odoo 19 (two fields with
    # the same name in the same form view race on the records they display).
    # Computed one2manys with explicit Python filters render correctly.
    outbound_trip_line_ids = fields.One2many(
        'field.attendance.trip.line',
        compute='_compute_split_trip_lines',
        string='Outbound Trip Lines',
    )
    return_trip_line_ids = fields.One2many(
        'field.attendance.trip.line',
        compute='_compute_split_trip_lines',
        string='Return Trip Lines',
    )
    # Count of trip lines -- gates the "Secondary Trip" vs "Additional Trips"
    # section heading. 1 line = Secondary, 2+ = Additional, 0 = section hidden.
    trip_line_count = fields.Integer(
        string='Trip Line Count',
        compute='_compute_trip_line_count',
    )
    # Visibility of the two Return-Home buttons that appear under the
    # Additional Trips section once outbound trips are done.
    show_primary_return_button = fields.Boolean(
        string='Show Return Trip Button',
        compute='_compute_return_buttons',
    )
    show_office_to_home_button = fields.Boolean(
        string='Show Office-to-Home Button',
        compute='_compute_return_buttons',
    )
    has_return_trip_lines = fields.Boolean(
        string='Has Return Trip Lines',
        compute='_compute_return_buttons',
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
    # Per-primary-trip metrics — exposed so PrimaryTripCard shows the trip's
    # OWN KM/duration/fuel, not the day's aggregate (which lives in
    # trip_total_* below and is rendered separately in TripTotalsSection).
    source_trip_km_travelled = fields.Integer(
        related='source_trip_id.km_travelled', readonly=True,
    )
    source_trip_duration = fields.Float(
        related='source_trip_id.duration', readonly=True,
    )
    source_trip_fuel_litres = fields.Float(
        related='source_trip_id.total_fuel_litres', readonly=True,
    )
    source_trip_fuel_amount = fields.Float(
        related='source_trip_id.total_fuel_amount', readonly=True,
    )
    # Writable related — lets the Edit Primary Trip popup set/edit Start KM
    # without forcing the user to open the source trip in another tab.
    # Propagates through to vehicle.tracking.start_km on save.
    source_trip_start_km = fields.Integer(
        related='source_trip_id.start_km',
        string='Start KM',
        readonly=False,
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
    # Lock flag for Start KM — true once the user clicks Start Trip on the
    # vehicle.tracking record (or the popup auto-starts it). Tightens the
    # readonly gate beyond source_trip_ended so the odometer reading can't
    # be edited mid-trip.
    source_trip_started = fields.Boolean(
        related='source_trip_id.start_trip', readonly=True,
    )
    # Single source of truth for "this day's field attendance is finalised":
    # gates every state-mutating action button on the form so the page goes
    # fully read-only once Check Out Now is clicked. View-only actions
    # (Open Source Trip, View Visits) are NOT gated by this flag.
    is_checked_out = fields.Boolean(
        string='Checked Out',
        compute='_compute_is_checked_out',
    )
    # Mirror of `available_trip_ids` on the visit side: excludes any
    # customer.visit already attached to this OR any other attendance for
    # the same employee so a visit can never be picked twice.
    available_visit_ids = fields.Many2many(
        'customer.visit',
        string='Available Visits',
        compute='_compute_available_visit_ids',
    )
    # Aggregate display strings used by the field-attendance kanban view's
    # expandable details panel. They concatenate every trip / visit attached
    # to the day so HR sees the full picture without opening the form.
    all_trips_display = fields.Char(
        string='All Trips',
        compute='_compute_all_trips_visits_display',
    )
    all_visits_display = fields.Char(
        string='All Visits',
        compute='_compute_all_trips_visits_display',
    )
    # Inline label shown next to the Add Fuel button so the user can confirm
    # how many fuel logs have been added without opening the trip form.
    # Empty string when the trip has no fuel logs yet (the view hides the
    # span entirely in that case).
    source_trip_fuel_log_summary = fields.Char(
        string='Fuel Log Summary',
        compute='_compute_source_trip_fuel_log_summary',
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

    @api.depends('trip_line_ids', 'trip_line_ids.is_return_trip')
    def _compute_trip_line_count(self):
        """Count of OUTBOUND trip lines only (return-home lines are excluded
        so the Secondary / Additional Trips section heading doesn't flip
        when the user adds a return leg)."""
        for rec in self:
            rec.trip_line_count = len(
                rec.trip_line_ids.filtered(lambda l: not l.is_return_trip)
            )

    @api.depends('trip_line_ids', 'trip_line_ids.is_return_trip')
    def _compute_split_trip_lines(self):
        """Split trip_line_ids into outbound and return-home subsets, each
        as its own one2many. The view binds each kanban to ONE of these
        fields so the SECONDARY TRIP card grid only ever shows outbound
        lines and the RETURN HOME card grid only ever shows return lines —
        with no duplicate rendering across sections."""
        for rec in self:
            rec.outbound_trip_line_ids = rec.trip_line_ids.filtered(
                lambda l: not l.is_return_trip
            )
            rec.return_trip_line_ids = rec.trip_line_ids.filtered(
                lambda l: l.is_return_trip
            )

    @api.depends('trip_line_ids.is_return_trip',
                 'trip_line_ids.return_leg_type',
                 'trip_line_ids.is_office_to_home_leg',
                 'trip_line_ids.sequence')
    def _compute_return_buttons(self):
        """Drive visibility of the Return-Home buttons based on the LAST
        trip line's state — supporting a CYCLE workflow where the user
        can: secondary trip -> return -> add additional trip -> return -> ...

        Logic keys off the highest-sequence trip line:
          - Last line is OUTBOUND   -> show "Via Office or Direct"
                                       (user is at a visit, ready to return)
          - Last line is via_office FIRST leg (not yet Office->Home)
                                    -> show "Office to Home"
                                       (user is at office, needs to get home)
          - Last line is DIRECT or OFFICE_TO_HOME
                                    -> cycle complete; both return buttons hidden.
                                       Add Additional Trip starts the next cycle,
                                       which re-enables "Via Office or Direct"
                                       because the new last line is outbound.

        has_return_trip_lines stays a simple "any return line exists" flag,
        driving the Return Home section's visibility.
        """
        for rec in self:
            return_lines = rec.trip_line_ids.filtered(lambda l: l.is_return_trip)
            sorted_lines = rec.trip_line_ids.sorted('sequence')
            last_line = sorted_lines[-1] if sorted_lines else None
            rec.has_return_trip_lines = bool(return_lines)
            if last_line is None:
                rec.show_primary_return_button = False
                rec.show_office_to_home_button = False
                continue
            if not last_line.is_return_trip:
                rec.show_primary_return_button = True
                rec.show_office_to_home_button = False
            elif (last_line.return_leg_type == 'via_office'
                  and not last_line.is_office_to_home_leg):
                rec.show_primary_return_button = False
                rec.show_office_to_home_button = True
            else:
                rec.show_primary_return_button = False
                rec.show_office_to_home_button = False

    @api.depends('check_out')
    def _compute_is_checked_out(self):
        for rec in self:
            rec.is_checked_out = bool(rec.check_out)

    @api.depends(
        'source_trip_id.ref', 'source_visit_ids.name',
        'trip_line_ids.trip_id.ref',
        'trip_line_ids.visit_id.name',
        'trip_line_ids.is_return_trip',
        'trip_line_ids.return_leg_type',
        'trip_line_ids.is_office_to_home_leg',
    )
    def _compute_all_trips_visits_display(self):
        for rec in self:
            trip_parts = []
            if rec.source_trip_id:
                trip_parts.append(rec.source_trip_id.ref or '')
            for line in rec.trip_line_ids:
                ref = line.trip_id.ref or ''
                if line.is_return_trip:
                    if line.is_office_to_home_leg:
                        ref = '%s Office→Home' % ref if ref else 'Office→Home'
                    elif line.return_leg_type == 'via_office':
                        ref = '%s Visit→Office' % ref if ref else 'Visit→Office'
                    elif line.return_leg_type == 'direct':
                        ref = '%s Visit→Home' % ref if ref else 'Visit→Home'
                if ref:
                    trip_parts.append(ref)
            rec.all_trips_display = ', '.join(trip_parts)

            visit_parts = list(rec.source_visit_ids.mapped('name'))
            visit_parts.extend(rec.trip_line_ids.mapped('visit_id.name'))
            rec.all_visits_display = ', '.join(v for v in visit_parts if v)

    @api.depends('source_trip_id', 'source_trip_id.fuel_log_ids')
    def _compute_source_trip_fuel_log_summary(self):
        for rec in self:
            trip = rec.source_trip_id
            count = len(trip.fuel_log_ids) if trip else 0
            if count == 0:
                rec.source_trip_fuel_log_summary = ''
            elif count == 1:
                rec.source_trip_fuel_log_summary = _('1 fuel log added')
            else:
                rec.source_trip_fuel_log_summary = _('%d fuel logs added') % count

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
            # Only draft trips, never already-used. The previous-destination
            # source filter is applied at the FORM DOMAIN layer (so it
            # re-evaluates per popup context) — not here, because non-stored
            # computes are cached per record and would otherwise return the
            # first-evaluated (unfiltered) list to every later context.
            rec.available_trip_ids = Tracking.search([
                ('id', 'not in', used_total.ids),
                ('trip_status', '=', 'draft'),
            ])

    @api.depends('employee_id', 'source_visit_ids',
                 'trip_line_ids.visit_id', 'trip_line_ids.visit_ids')
    def _compute_available_visit_ids(self):
        """Visits that are still UNUSED across this employee's attendances.
        Excludes visits already attached to this OR any other attendance
        via source_visit_ids OR via trip_line_ids.visit_id / visit_ids.
        Mirrors `_compute_available_trip_ids` on the trip side."""
        Visit = self.env['customer.visit'].sudo()
        for rec in self:
            if not rec.employee_id:
                rec.available_visit_ids = Visit
                continue
            others = self.sudo().search([
                ('employee_id', '=', rec.employee_id.id),
                ('id', '!=', rec.id if isinstance(rec.id, int) else 0),
            ])
            used_by_others = (
                others.mapped('source_visit_ids')
                | others.mapped('trip_line_ids.visit_id')
                | others.mapped('trip_line_ids.visit_ids')
            )
            self_used = (
                rec.source_visit_ids
                | rec.trip_line_ids.mapped('visit_id')
                | rec.trip_line_ids.mapped('visit_ids')
            )
            used_total = used_by_others | self_used
            rec.available_visit_ids = Visit.search([
                ('id', 'not in', used_total.ids),
                ('state', '=', 'draft'),
            ])

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
            lat, lng = self._resolve_trip_gps(trip)
            self.gps_latitude = lat
            self.gps_longitude = lng
        if not self.gps_location_name and trip.source_id:
            self.gps_location_name = trip.source_id.name

    # --- Constraints --------------------------------------------------------

    @api.constrains('source_trip_id', 'source_trip_start_km')
    def _check_source_trip_start_km(self):
        """Prevent saving the Primary Trip popup with Start KM = 0 on a draft
        trip. A trip cannot logically start without an odometer reading.
        Skips trips that have already started or been cancelled — those are
        locked or out of scope respectively.
        """
        for rec in self:
            trip = rec.source_trip_id
            if not trip or trip.start_trip or trip.trip_cancel:
                continue
            if trip.start_km <= 0:
                raise UserError(_(
                    "Please enter Start KM (greater than 0) for trip %s "
                    "before saving the Primary Trip."
                ) % (trip.ref or ''))

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

    def action_add_source_trip_fuel(self):
        """Open the vehicle.fuel.log popup pre-linked to source_trip_id so the
        user can log a fuel stop without navigating into the trip itself.
        Pre-fills vehicle/driver from the trip and the odometer from the last
        fuel log (or start_km when there is no prior fuel log)."""
        self.ensure_one()
        trip = self.source_trip_id
        if not trip:
            raise UserError(_("Set up a Primary Trip first."))
        last_fuel = trip.fuel_log_ids.sorted('create_date', reverse=True)[:1]
        default_odometer = last_fuel.odometer if last_fuel else trip.start_km
        return {
            'type': 'ir.actions.act_window',
            'name': _('Add Fuel'),
            'res_model': 'vehicle.fuel.log',
            'view_mode': 'form',
            'view_id': self.env.ref(
                'vehicle_tracking.view_vehicle_fuel_log_form_popup'
            ).id,
            'target': 'new',
            'context': {
                'default_vehicle_tracking_id': trip.id,
                'default_vehicle_id': trip.vehicle_id.id if trip.vehicle_id else False,
                'default_driver_id': trip.driver_id.id if trip.driver_id else False,
                'default_odometer': default_odometer,
            },
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

    def _previous_trip_destination_id(self, only_outbound=False, only_via_office_first=False):
        """Resolve the destination_id of the trip the user is currently AT
        (i.e., the trip they just finished). Used to filter the next-trip
        picker so it only offers trips that START at the same location.

        Falls back from the most recent matching trip-line to the primary
        trip's destination, returning False when neither exists (fresh
        attendance) — in which case the caller's filter is skipped and
        the picker behaves as today.
        """
        self.ensure_one()
        last_line = self._last_trip_line(
            only_outbound=only_outbound,
            only_via_office_first=only_via_office_first,
        )
        if last_line and last_line.trip_id and last_line.trip_id.destination_id:
            return last_line.trip_id.destination_id.id
        if self.source_trip_id and self.source_trip_id.destination_id:
            return self.source_trip_id.destination_id.id
        return False

    def _last_trip_line(self, only_outbound=False, only_via_office_first=False):
        """Return the most recently added trip line on this attendance.

        Uses a compound (sequence, id) sort so ties on the default
        sequence=10 (which every line shares unless explicitly bumped)
        are broken deterministically by creation order — without this
        tiebreaker, Python's stable sort on a flat sequence key returns
        the FIRST-created line instead of the latest, which breaks the
        "close previous trip" detection for return-trip legs.

        Optional filters narrow the candidate set:
          - only_outbound: exclude return-trip lines
          - only_via_office_first: keep only via_office FIRST legs
            (return_leg_type='via_office' AND not is_office_to_home_leg)

        Returns an empty recordset when no lines match.
        """
        self.ensure_one()
        lines = self.trip_line_ids
        if only_outbound:
            lines = lines.filtered(lambda l: not l.is_return_trip)
        if only_via_office_first:
            lines = lines.filtered(
                lambda l: l.is_return_trip
                          and l.return_leg_type == 'via_office'
                          and not l.is_office_to_home_leg
            )
        if not lines:
            return self.env['field.attendance.trip.line']
        return lines.sorted(lambda l: (l.sequence, l.id))[-1:]

    def action_add_additional_trip(self):
        """Orchestrate the "add a new additional trip" workflow.

        If a previous trip is still open (primary or latest trip_line —
        outbound OR return), FIRST open that trip in a popup with a
        disclaimer banner so the user enters End KM before closing it.
        After they save, the chained flow lands them on the new
        trip-line creation popup automatically.

        If there's no open previous trip, jump straight to the new
        trip-line creation popup.
        """
        self.ensure_one()
        last_line = self._last_trip_line()
        last_trip = last_line.trip_id if last_line else self.source_trip_id
        prev_dest_id = self._previous_trip_destination_id()
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
                    'previous_trip_destination_id': prev_dest_id,
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
            'context': {
                'default_attendance_id': self.id,
                'previous_trip_destination_id': prev_dest_id,
            },
        }

    def action_open_return_trip_popup(self):
        """Opens the Setup Return Trip popup for the FIRST leg. If the
        previous trip (primary or last outbound trip_line) is still open
        (not ended and not cancelled), shows the close-previous-trip
        dialog FIRST -- mirrors Add Additional Trip's behaviour. After
        Save & Exit closes that trip, the action_save_and_end_trip /
        action_custom_save override sees `redirect_to_return_trip_attendance_id`
        in context and opens this return-trip popup automatically."""
        self.ensure_one()
        # Find the last open OUTBOUND trip on this attendance (the one the
        # user is returning from), else fall back to the primary trip.
        last_line = self._last_trip_line(only_outbound=True)
        last_trip = last_line.trip_id if last_line else self.source_trip_id
        prev_dest_id = self._previous_trip_destination_id(only_outbound=True)
        if last_trip and not last_trip.end_trip and not last_trip.trip_cancel:
            return {
                'type': 'ir.actions.act_window',
                'name': _('Close Previous Trip — %s') % (last_trip.ref or ''),
                'res_model': 'vehicle.tracking',
                'res_id': last_trip.id,
                'view_mode': 'form',
                'target': 'new',
                'context': {
                    'show_end_disclaimer': True,
                    'redirect_to_return_trip_attendance_id': self.id,
                    'previous_trip_destination_id': prev_dest_id,
                },
            }
        # Previous trip already closed -- go straight to the return-trip popup.
        return {
            'type': 'ir.actions.act_window',
            'name': _('Primary Trip (Via Office or Direct)'),
            'res_model': 'field.attendance.trip.line',
            'view_mode': 'form',
            'view_id': self.env.ref(
                'hr_field_attendance.view_field_attendance_return_trip_form'
            ).id,
            'target': 'new',
            'context': {
                'default_attendance_id': self.id,
                'default_is_return_trip': True,
                'show_return_route_field': True,
                'previous_trip_destination_id': prev_dest_id,
            },
        }

    def action_open_office_to_home_popup(self):
        """Opens the SECOND-leg popup (Office -> Home). Same form view as
        the first-leg popup but the Route radio is hidden -- the leg is
        flagged as office_to_home via context default.

        If the previous via_office_leg1 trip is still open (not ended,
        not cancelled), shows the close-previous-trip dialog FIRST.
        After Save & Exit closes that trip, action_save_and_end_trip /
        action_custom_save sees `redirect_to_office_to_home_attendance_id`
        and opens this Office-to-Home popup automatically.
        """
        self.ensure_one()
        # Find the latest via_office FIRST leg (not yet office_to_home).
        # If it's still open, show close-previous-trip dialog first.
        first_leg = self._last_trip_line(only_via_office_first=True)
        prev_dest_id = self._previous_trip_destination_id(only_via_office_first=True)
        if first_leg:
            last_trip = first_leg.trip_id
            if last_trip and not last_trip.end_trip and not last_trip.trip_cancel:
                return {
                    'type': 'ir.actions.act_window',
                    'name': _('Close Previous Trip — %s') % (last_trip.ref or ''),
                    'res_model': 'vehicle.tracking',
                    'res_id': last_trip.id,
                    'view_mode': 'form',
                    'target': 'new',
                    'context': {
                        'show_end_disclaimer': True,
                        'redirect_to_office_to_home_attendance_id': self.id,
                        'previous_trip_destination_id': prev_dest_id,
                    },
                }
        # Previous leg already closed (or doesn't exist) -- straight to the popup.
        return {
            'type': 'ir.actions.act_window',
            'name': _('Primary Trip (Office to Home)'),
            'res_model': 'field.attendance.trip.line',
            'view_mode': 'form',
            'view_id': self.env.ref(
                'hr_field_attendance.view_field_attendance_return_trip_form'
            ).id,
            'target': 'new',
            'context': {
                'default_attendance_id': self.id,
                'default_is_return_trip': True,
                'default_return_leg_type': 'via_office',
                'default_is_office_to_home_leg': True,
                'show_return_route_field': False,
                'previous_trip_destination_id': prev_dest_id,
            },
        }

    def action_open_checkout_confirm_wizard(self):
        """Field-attendance intercept on Check Out Now. If a return trip leg
        is still open (start_trip=True but end_trip=False, not cancelled),
        redirect the user to that trip's End Trip dialog FIRST -- the
        action_end_trip override sees the `redirect_to_checkout_attendance_id`
        context flag and finalizes the checkout after End KM is entered.

        For non-field attendance OR when no open return trip exists, fall
        through to the standard late-checkout-confirm wizard.
        """
        self.ensure_one()
        if self.attendance_source == 'field':
            open_return = self.trip_line_ids.filtered(
                lambda l: l.is_return_trip and l.trip_id
                          and l.trip_id.start_trip and not l.trip_id.end_trip
                          and not l.trip_id.trip_cancel
            )
            if open_return:
                last = open_return.sorted('sequence', reverse=True)[:1]
                trip = last.trip_id
                return {
                    'type': 'ir.actions.act_window',
                    'name': _('Close Return Trip — %s') % (trip.ref or ''),
                    'res_model': 'vehicle.tracking',
                    'res_id': trip.id,
                    'view_mode': 'form',
                    'target': 'new',
                    'context': {
                        'show_end_disclaimer': True,
                        'redirect_to_checkout_attendance_id': self.id,
                    },
                }
        return super().action_open_checkout_confirm_wizard()

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
        # Auto-start the source trip when the user saves the Edit Primary Trip
        # popup with Start KM filled. Mirrors the manual "Start Trip" button on
        # the vehicle.tracking record. The @api.constrains above already
        # guarantees start_km > 0 by this point, so the helper only checks the
        # draft-not-cancelled state.
        if any(k in vals for k in ('source_trip_id', 'source_trip_start_km')):
            try:
                self._auto_start_source_trip()
            except Exception:
                _logger.exception("[field-attendance] auto-start source trip failed")
        # On checkout: end the last open trip (the one whose visits the user
        # just finished) and mark every linked visit as Done. Mirrors the UX
        # of the mobile app's "End Trip & Mark Attendance" tap.
        if 'check_out' in vals and vals.get('check_out'):
            try:
                self._on_checkout_finalize_trips_and_visits()
            except Exception:
                _logger.exception("[field-attendance] checkout finalize failed")
        return res

    def _auto_start_source_trip(self):
        """Transition source_trip_id from draft -> in_progress when the popup
        save brought it to a startable state (start_km > 0). Mirrors the
        'Start Trip' button on the trip form so the user doesn't have to open
        the trip in another tab just to flip start_trip."""
        for rec in self:
            trip = rec.source_trip_id
            if not trip or trip.start_trip or trip.trip_cancel:
                continue
            if trip.start_km > 0:
                trip.write({
                    'start_trip': True,
                    'start_time': trip.start_time or fields.Datetime.now(),
                })

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
            # start_km / end_km are needed by the mobile Close-Previous-Trip
            # popup so it can display "Start KM was X. End KM must be higher."
            # and run the same client-side validation the server enforces.
            'start_km': trip.start_km if trip.start_km is not None else 0,
            'end_km':   trip.end_km   if trip.end_km   is not None else 0,
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
            # vehicle_id (+ display name) lets the mobile "Create New Trip" CTA
            # pre-select the same vehicle on the new trip so the odometer chain
            # stays continuous. Sent as an Odoo M2O tuple shape so the client's
            # existing Array.isArray helpers keep working.
            'vehicle_id': [trip.vehicle_id.id, trip.vehicle_id.name] if trip.vehicle_id else False,
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

    def _resolve_trip_gps(self, trip):
        """Return (lat, lng) for a vehicle.tracking record, falling back to the
        trip's source vehicle.location when the trip's own GPS chars are empty.

        Backend-created trips never have start_latitude/start_longitude filled —
        those are only populated when the trip is started from the mobile app
        with phone GPS. The vehicle.location records, however, always have
        latitude/longitude set during configuration, so they're a reliable
        fallback for the attendance's GPS sync.
        """
        if not trip:
            return 0.0, 0.0
        lat = self._to_float_or_zero(trip.start_latitude)
        lng = self._to_float_or_zero(trip.start_longitude)
        if not (lat or lng) and trip.source_id:
            lat = trip.source_id.latitude or 0.0
            lng = trip.source_id.longitude or 0.0
        return lat, lng

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
                gps_lat, gps_lng = self._resolve_trip_gps(trips[0])
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
        # source_visit_ids deliberately left empty — per user requirement, the
        # visit list inside the Setup Primary Trip popup must start empty and
        # the user picks ONE via "Add a line" (single-visit cap enforced by
        # the view's `invisible="has_source_visits"` gate on the editable
        # list variant).

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
            'should_show_trip_popup': (
                not new_record.source_trip_id
                and new_record._is_first_field_checkin_today()
            ),
        }

    def _is_first_field_checkin_today(self):
        """True when this record is the employee's only field attendance for
        their local day. Used by the mobile app to decide whether to show the
        post-check-in Primary/Secondary trip popup."""
        self.ensure_one()
        if not self.employee_id:
            return True
        utc_start, utc_end, _local = self._employee_today_window(self.employee_id)
        prior_count = self.env['hr.attendance'].sudo().search_count([
            ('employee_id', '=', self.employee_id.id),
            ('attendance_source', '=', 'field'),
            ('check_in', '>=', utc_start),
            ('check_in', '<', utc_end),
            ('id', '!=', self.id),
        ])
        return prior_count == 0

    # =========================================================================
    # NEW Field Attendance Flow RPCs (mobile-app-facing)
    # =========================================================================
    # Single state RPC + one action RPC per user action. The mobile app reads
    # `get_field_attendance_state` once per screen render and renders buttons
    # / cards based on the returned flags. Each user tap fires one of the
    # `field_action_*` RPCs and then re-reads the state.

    def _serialize_trip_line(self, line):
        """Serialise a field.attendance.trip.line for the mobile state RPC."""
        return {
            'id': line.id,
            'sequence': line.sequence,
            'trip': self._serialize_trip(line.trip_id) if line.trip_id else None,
            'visit': self._serialize_visit(line.visit_id) if line.visit_id else None,
            'is_return_trip': line.is_return_trip,
            'return_leg_type': line.return_leg_type,
            'is_office_to_home_leg': line.is_office_to_home_leg,
            'km_travelled': line.km_travelled,
            'duration': line.duration,
            'trip_fuel_log_summary': line.trip_fuel_log_summary or '',
            'gps_latitude': line.gps_latitude or '',
            'gps_longitude': line.gps_longitude or '',
        }

    @api.model
    def get_field_attendance_state(self, attendance_id):
        """Single source of truth for the mobile Field Attendance screen.

        Returns every flag the web button-row visibility logic uses, plus
        serialised primary trip / trip lines / return lines so the mobile
        app can render the full UI off one call.
        """
        att = self.browse(attendance_id)
        if not att.exists():
            return {'error': 'not_found'}
        self._check_field_attendance_access(att.employee_id)
        outbound = att.trip_line_ids.filtered(lambda l: not l.is_return_trip).sorted(
            lambda l: (l.sequence, l.id)
        )
        returns = att.trip_line_ids.filtered(lambda l: l.is_return_trip).sorted(
            lambda l: (l.sequence, l.id)
        )
        return {
            'attendance': {
                'id': att.id,
                'check_in': str(att.check_in) if att.check_in else None,
                'check_out': str(att.check_out) if att.check_out else None,
                'is_checked_out': bool(att.check_out),
                'employee_id': att.employee_id.id,
                'employee_name': att.employee_id.name or '',
                'attendance_source': att.attendance_source,
                'gps_latitude': att.gps_latitude or 0.0,
                'gps_longitude': att.gps_longitude or 0.0,
                'gps_location_name': att.gps_location_name or '',
                'trip_total_km': att.trip_total_km,
                'trip_total_duration': att.trip_total_duration,
                'trip_total_fuel_litres': att.trip_total_fuel_litres,
                'trip_total_fuel_amount': att.trip_total_fuel_amount,
            },
            'source_trip': self._serialize_trip(att.source_trip_id) if att.source_trip_id else None,
            'source_visits': [self._serialize_visit(v) for v in att.source_visit_ids],
            'trip_lines': [att._serialize_trip_line(l) for l in outbound],
            'return_lines': [att._serialize_trip_line(l) for l in returns],
            'show_primary_return_button': att.show_primary_return_button,
            'show_office_to_home_button': att.show_office_to_home_button,
            'has_return_trip_lines': att.has_return_trip_lines,
            'previous_trip_destination_id': att._previous_trip_destination_id(),
            'available_trip_ids': att.available_trip_ids.ids,
            'available_visit_ids': att.available_visit_ids.ids,
        }

    @api.model
    def field_action_close_previous_trip(self, attendance_id, end_km):
        """Close the latest open trip on this attendance. End KM must be
        > Start KM. Mirrors the web close-previous-trip dialog."""
        att = self.browse(attendance_id)
        if not att.exists():
            return {'error': 'not_found'}
        self._check_field_attendance_access(att.employee_id)
        last_line = att._last_trip_line()
        trip = last_line.trip_id if last_line else att.source_trip_id
        if not trip:
            return {'error': 'no_previous_trip'}
        if trip.end_trip or trip.trip_cancel:
            return {'error': 'already_closed'}
        try:
            end_km_int = int(end_km or 0)
        except (TypeError, ValueError):
            return {'error': 'end_km_invalid'}
        if end_km_int <= (trip.start_km or 0):
            return {'error': 'end_km_too_low', 'start_km': trip.start_km or 0}
        trip.with_context(skip_auto_end_trip=True).write({
            'end_km': end_km_int,
            'end_trip': True,
            'end_time': trip.end_time or fields.Datetime.now(),
        })
        try:
            trip._mark_linked_visits_done()
        except Exception:
            _logger.exception("[field-attendance] _mark_linked_visits_done failed in RPC close-prev")
        return {'success': True}

    @api.model
    def field_action_setup_primary_trip(self, attendance_id, trip_id, start_km,
                                        gps_latitude=0.0, gps_longitude=0.0,
                                        gps_location_name=''):
        """Set source_trip_id + Start KM + GPS on the attendance. Mirrors the
        web 'Setup Primary Trip (Home → Office)' popup save."""
        att = self.browse(attendance_id)
        if not att.exists():
            return {'error': 'not_found'}
        self._check_field_attendance_access(att.employee_id)
        if bool(att.check_out):
            return {'error': 'checked_out'}
        trip = self.env['vehicle.tracking'].browse(trip_id)
        if not trip.exists():
            return {'error': 'trip_not_found'}
        try:
            start_km_int = int(start_km or 0)
        except (TypeError, ValueError):
            return {'error': 'start_km_invalid'}
        if start_km_int <= 0:
            return {'error': 'start_km_required'}
        trip.write({'start_km': start_km_int})
        att.write({
            'source_trip_id': trip.id,
            'gps_latitude': gps_latitude or 0.0,
            'gps_longitude': gps_longitude or 0.0,
            'gps_location_name': gps_location_name or '',
        })
        try:
            att._auto_start_source_trip()
        except Exception:
            _logger.exception("[field-attendance] _auto_start_source_trip failed in RPC")
        return {'success': True, 'attendance_id': att.id, 'trip_id': trip.id}

    @api.model
    def field_action_create_additional_trip(self, attendance_id, trip_id, visit_id,
                                            start_km, gps_latitude=0.0,
                                            gps_longitude=0.0, gps_location_name=''):
        """Create an OUTBOUND trip line. Used by both Setup Secondary Trip
        (first trip after primary, or first trip ever when going home →
        visit) and Add Additional Trip."""
        att = self.browse(attendance_id)
        if not att.exists():
            return {'error': 'not_found'}
        self._check_field_attendance_access(att.employee_id)
        if bool(att.check_out):
            return {'error': 'checked_out'}
        trip = self.env['vehicle.tracking'].browse(trip_id)
        if not trip.exists():
            return {'error': 'trip_not_found'}
        try:
            start_km_int = int(start_km or 0)
        except (TypeError, ValueError):
            return {'error': 'start_km_invalid'}
        if start_km_int <= 0:
            return {'error': 'start_km_required'}
        trip.write({'start_km': start_km_int})
        line_vals = {
            'attendance_id': att.id,
            'trip_id': trip.id,
            'is_return_trip': False,
        }
        if visit_id:
            visit = self.env['customer.visit'].browse(visit_id)
            if visit.exists():
                line_vals['visit_id'] = visit.id
        if gps_location_name:
            line_vals['gps_location_name'] = gps_location_name
        line = self.env['field.attendance.trip.line'].create(line_vals)
        return {'success': True, 'trip_line_id': line.id, 'trip_id': trip.id}

    @api.model
    def field_action_create_return_trip(self, attendance_id, trip_id, start_km,
                                        return_leg_type, is_office_to_home=False,
                                        gps_latitude=0.0, gps_longitude=0.0,
                                        gps_location_name=''):
        """Create a RETURN trip line. `return_leg_type` is 'via_office' or
        'direct'. `is_office_to_home=True` flags the second leg of a
        via_office return."""
        att = self.browse(attendance_id)
        if not att.exists():
            return {'error': 'not_found'}
        self._check_field_attendance_access(att.employee_id)
        if bool(att.check_out):
            return {'error': 'checked_out'}
        if return_leg_type not in ('via_office', 'direct'):
            return {'error': 'invalid_leg_type'}
        trip = self.env['vehicle.tracking'].browse(trip_id)
        if not trip.exists():
            return {'error': 'trip_not_found'}
        try:
            start_km_int = int(start_km or 0)
        except (TypeError, ValueError):
            return {'error': 'start_km_invalid'}
        if start_km_int <= 0:
            return {'error': 'start_km_required'}
        trip.write({'start_km': start_km_int})
        line_vals = {
            'attendance_id': att.id,
            'trip_id': trip.id,
            'is_return_trip': True,
            'return_leg_type': return_leg_type,
            'is_office_to_home_leg': bool(is_office_to_home),
        }
        if gps_location_name:
            line_vals['gps_location_name'] = gps_location_name
        line = self.env['field.attendance.trip.line'].create(line_vals)
        return {'success': True, 'trip_line_id': line.id, 'trip_id': trip.id}

    @api.model
    def field_action_check_out(self, attendance_id):
        """Finalise the attendance: ends any open trip + marks visits Done +
        sets check_out timestamp. Wraps _on_checkout_finalize_trips_and_visits."""
        att = self.browse(attendance_id)
        if not att.exists():
            return {'error': 'not_found'}
        self._check_field_attendance_access(att.employee_id)
        if att.check_out:
            return {'error': 'already_checked_out'}
        att.write({'check_out': fields.Datetime.now()})
        return {'success': True, 'check_out': str(att.check_out)}

    # =========================================================================
    # END new Field Attendance Flow RPCs
    # =========================================================================

    def attach_primary_trip(self, vehicle_tracking_id):
        """Attach a vehicle.tracking record to this attendance as
        source_trip_id. Called by the mobile app right after the user starts
        a trip from the post-check-in popup. Refuses if a primary is already
        set so we never silently overwrite a trip the user already picked."""
        self.ensure_one()
        self._check_field_attendance_access(self.employee_id)
        if self.source_trip_id:
            return {
                'success': False,
                'message': _('Primary trip already set for today.'),
                'attendance_id': self.id,
                'trip_id': self.source_trip_id.id,
            }
        trip = self.env['vehicle.tracking'].sudo().browse(vehicle_tracking_id)
        if not trip.exists():
            return {'success': False, 'message': _('Trip not found.')}
        self.write({'source_trip_id': trip.id})
        return {'success': True, 'attendance_id': self.id, 'trip_id': trip.id}

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
            gps_lat, gps_lng = self._resolve_trip_gps(primary_trip)

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
            # source_visit_ids deliberately empty — user must pick ONE visit
            # via the Setup Primary Trip popup's "Add a line" (single-visit
            # cap enforced by the view).
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
