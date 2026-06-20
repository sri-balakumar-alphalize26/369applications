# -*- coding: utf-8 -*-
import logging
from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError

_logger = logging.getLogger(__name__)


class FieldAttendanceTripLine(models.Model):
    """One row = one extra vehicle trip attached to a hr.attendance day.

    The form view of this line renders the same shape as the primary
    Field Attendance section (Source Trip, Visited Stops, GPS, Visits)
    so HR adds another trip by clicking the One2many '+ Add a line'
    button instead of cramming it all into a flat table.
    """
    _name = 'field.attendance.trip.line'
    _description = 'Field Attendance Trip Line'
    _order = 'sequence, id'

    attendance_id = fields.Many2one(
        'hr.attendance', string='Attendance',
        required=True, ondelete='cascade', index=True,
    )
    sequence = fields.Integer(default=10)
    trip_id = fields.Many2one(
        'vehicle.tracking', string='Source Trip', required=True,
        ondelete='restrict',
    )

    # Mirrors of the primary Field Attendance fields, all related so the
    # line view looks and reads exactly like the parent section.
    visited_stops_display = fields.Char(
        related='trip_id.visited_stops_display', readonly=True,
    )
    # GPS — read from the trip's start coords FIRST, then fall back to the
    # first customer.visit's lat/long if the trip has no GPS captured
    # (drivers often skip granting location permission at trip start).
    # Mirrors how hr.attendance.create_field_attendance derives GPS.
    gps_latitude = fields.Char(
        compute='_compute_gps_from_trip_or_visit',
        string='GPS Latitude', readonly=True,
    )
    gps_longitude = fields.Char(
        compute='_compute_gps_from_trip_or_visit',
        string='GPS Longitude', readonly=True,
    )
    # User-editable location label for parity with the primary popup
    # (hr.attendance.gps_location_name plays the same role).
    gps_location_name = fields.Char(string='Location')

    @api.depends(
        'trip_id', 'trip_id.start_latitude', 'trip_id.start_longitude',
        'trip_id.source_id', 'trip_id.source_id.latitude', 'trip_id.source_id.longitude',
    )
    def _compute_gps_from_trip_or_visit(self):
        """Trip GPS — depends ONLY on the trip's own data, never on the visit.
        The picked visit has its own visit_latitude / visit_longitude related
        fields; keeping these two computes independent means changing the
        visit doesn't drift the trip GPS (and vice versa)."""
        for rec in self:
            lat = rec.trip_id.start_latitude or ''
            lng = rec.trip_id.start_longitude or ''
            # Fall back to the trip's source vehicle.location coords.
            # Mirrors hr.attendance._resolve_trip_gps. Covers backend-created
            # trips that never went through the mobile start-trip flow.
            if not lat and not lng and rec.trip_id.source_id:
                src = rec.trip_id.source_id
                if src.latitude:
                    lat = '%.7f' % float(src.latitude)
                if src.longitude:
                    lng = '%.7f' % float(src.longitude)
            rec.gps_latitude = lat
            rec.gps_longitude = lng
    # Source + destination location of the trip — replaces the old
    # "Visited Stops" line on the kanban cards.
    source_location = fields.Char(
        related='trip_id.source_id.name', string='Source Location', readonly=True,
    )
    destination_location = fields.Char(
        related='trip_id.destination_id.name', string='Destination Location', readonly=True,
    )
    # NEW single-visit field — replaces the legacy visit_ids M2M for new
    # records. The popup shows this as a dropdown picker (similar to
    # source_trip_id). Legacy visit_ids stays as a fallback on existing
    # rows; the post-migrate script backfills visit_id from visit_ids[0].
    visit_id = fields.Many2one(
        'customer.visit', string='Visit',
        domain="[('state', '=', 'draft')]",
    )
    # Legacy: kept for backward compat with pre-migration trip lines whose
    # visit selection lives in this M2M. New rows should use visit_id.
    visit_ids = fields.Many2many(
        'customer.visit',
        'field_attendance_trip_line_visit_rel',
        'line_id', 'visit_id',
        string='Visits (legacy)',
    )

    # Writable related Start KM so the popup matches the primary popup parity.
    start_km = fields.Integer(
        related='trip_id.start_km', readonly=False,
        string='Start KM',
    )

    # Seed value for a NEW trip's Start Km (odometer continuity): the End Km of
    # this attendance's previous trip. Related to hr.attendance — mirrors how
    # attendance_available_trip_ids is exposed — so it resolves reliably on the
    # new (unsaved) trip-line record via default_attendance_id. Referenced as
    # `default_start_km` in the trip_id picker context so the "Create Source
    # Trip" form pre-fills Start Km without the user picking a vehicle first.
    attendance_previous_trip_end_km = fields.Integer(
        related='attendance_id.previous_trip_end_km', readonly=True,
    )

    # Marks a trip line as a Return-Home leg (Visit -> Office, Office -> Home,
    # or Visit -> Home direct). Excluded from the Additional Trips kanban and
    # surfaced in a dedicated Return Home section instead.
    is_return_trip = fields.Boolean(
        string='Is Return Trip', default=False, index=True,
    )
    # The user's route choice. Only TWO options because the user is at a
    # visit when this is set: either go via office (Visit -> Office, then
    # later Office -> Home as a separate leg) or go direct (Visit -> Home).
    return_leg_type = fields.Selection([
        ('via_office', 'Via Office: Visit → Office'),
        ('direct', 'Direct: Visit → Home'),
    ], string='Return Leg Type')
    # Distinguishes the SECOND via_office leg (Office -> Home) from the first
    # via_office leg (Visit -> Office). Set automatically by the
    # "Primary Trip (Office to Home)" button via context default.
    is_office_to_home_leg = fields.Boolean(
        string='Is Office → Home Leg', default=False,
    )

    # Readonly detail fields populated from the picked visit. Used by the
    # popup view to show customer / date-time / location / lat / lng under
    # the Visit selector -- mirrors how source_location / destination_location
    # show under source_trip_id.
    visit_partner_id = fields.Many2one(
        related='visit_id.partner_id', readonly=True,
        string='Visit Customer',
    )
    visit_date_time = fields.Datetime(
        related='visit_id.date_time', readonly=True,
        string='Visit Date / Time',
    )
    # Office-timezone display string for the visit time — shown in the field
    # attendance views instead of visit_date_time (a raw Datetime that renders
    # in the viewer's tz). Reuses customer.visit.date_time_office.
    visit_date_time_office = fields.Char(
        related='visit_id.date_time_office', readonly=True,
        string='Date / Time',
    )
    visit_location_name = fields.Char(
        related='visit_id.location_name', readonly=True,
        string='Visit Location',
    )
    visit_latitude = fields.Float(
        related='visit_id.latitude', readonly=True,
        string='Visit Latitude', digits=(16, 8),
    )
    visit_longitude = fields.Float(
        related='visit_id.longitude', readonly=True,
        string='Visit Longitude', digits=(16, 8),
    )

    @api.model
    def _validate_vals_start_km_or_raise(self, vals):
        """Validate a single create/write vals dict: if trip_id is present and
        the trip is still in draft state, start_km MUST be > 0.

        This is called BEFORE super().create() / super().write() so it reads
        directly from the incoming vals dict, avoiding the timing issues that
        plague @api.constrains on related fields (writeback ordering, cache
        staleness, deferred constraint firing).
        """
        trip_id = vals.get('trip_id')
        if not trip_id:
            return
        trip = self.env['vehicle.tracking'].browse(trip_id)
        if not trip.exists():
            return
        if trip.start_trip or trip.end_trip or trip.trip_cancel:
            return  # already past this validation point
        # When start_km is in vals (user touched it), use that value.
        # When it's not, fall back to the trip's current start_km.
        if 'start_km' in vals:
            start_km = vals.get('start_km') or 0
        else:
            start_km = trip.start_km or 0
        if start_km <= 0:
            raise ValidationError(_(
                "Please enter Start KM (greater than 0) for trip %s "
                "before saving."
            ) % (trip.ref or ''))

    def _resolve_primary_visit(self):
        """Single source of truth for 'which visit drives this trip line'.
        Prefers the new visit_id field; falls back to the first legacy
        visit_ids entry so pre-migration rows keep rendering correctly."""
        self.ensure_one()
        if self.visit_id:
            return self.visit_id
        if self.visit_ids:
            return self.visit_ids.sorted('date_time')[:1]
        return self.env['customer.visit']

    # NOTE: visit_id / visit_ids are intentionally NOT auto-populated when
    # trip_id is picked. Per user requirement, the visit dropdown inside
    # the trip-line popup stays empty until the user picks one explicitly.

    # Lock flag: when the underlying trip has been ended, this trip line
    # is treated as readonly on the field-attendance form (no edits allowed).
    trip_ended = fields.Boolean(
        related='trip_id.end_trip', readonly=True,
    )
    # Mirror of the parent attendance's is_checked_out gate. Exposed here so
    # kanban-card buttons (Add Fuel etc.) can hide themselves once the
    # attendance is finalised, without needing parent.* lookups in the
    # kanban template (which Odoo 19's kanban arch doesn't support for
    # button visibility expressions).
    attendance_checked_out = fields.Boolean(
        related='attendance_id.is_checked_out', readonly=True,
    )
    # Mirror of the parent's available trips list so STANDALONE trip-line
    # popups (target='new', no parent.* lookup available) can scope their
    # trip_id domain through the attendance's context-aware compute.
    attendance_available_trip_ids = fields.Many2many(
        'vehicle.tracking',
        related='attendance_id.available_trip_ids', readonly=True,
    )
    # Same idea for the visit picker.
    attendance_available_visit_ids = fields.Many2many(
        'customer.visit',
        related='attendance_id.available_visit_ids', readonly=True,
    )

    # Boolean shadow of visit_ids for the popup view's `invisible` modifiers
    # (Odoo 19's M2M-truthiness in modifiers can be flaky; computed bool is
    # reliable).
    has_visits = fields.Boolean(
        compute='_compute_has_visits',
    )

    @api.depends('visit_id', 'visit_ids')
    def _compute_has_visits(self):
        for rec in self:
            rec.has_visits = bool(rec.visit_id) or bool(rec.visit_ids)

    # Inline label shown next to the Add Fuel button on the kanban card so
    # the user can confirm how many fuel logs have been added to this
    # trip-line's trip without opening it. Mirrors source_trip_fuel_log_summary
    # on hr.attendance for the primary trip card.
    trip_fuel_log_summary = fields.Char(
        string='Fuel Log Summary',
        compute='_compute_trip_fuel_log_summary',
    )

    @api.depends('trip_id', 'trip_id.fuel_log_ids')
    def _compute_trip_fuel_log_summary(self):
        for rec in self:
            trip = rec.trip_id
            count = len(trip.fuel_log_ids) if trip else 0
            if count == 0:
                rec.trip_fuel_log_summary = ''
            elif count == 1:
                rec.trip_fuel_log_summary = _('1 fuel log added')
            else:
                rec.trip_fuel_log_summary = _('%d fuel logs added') % count

    # Aggregates copied from the trip — used by hr.attendance Trip Totals.
    km_travelled = fields.Integer(
        related='trip_id.km_travelled', readonly=True,
    )
    duration = fields.Float(
        related='trip_id.duration', readonly=True,
    )
    total_fuel_litres = fields.Float(
        related='trip_id.total_fuel_litres', readonly=True,
    )
    total_fuel_amount = fields.Float(
        related='trip_id.total_fuel_amount', readonly=True,
    )

    def _auto_start_trip_and_visit(self):
        """Mirror hr.attendance._auto_start_source_trip for trip lines:
          - if trip is draft and start_km > 0, set start_trip=True + start_time=now
          - if a visit is attached and it's still draft, transition it to in_progress
        Safe to call from create() and write() -- idempotent (skips trips/visits
        that are already past the relevant state)."""
        for rec in self:
            trip = rec.trip_id
            if trip and not trip.start_trip and not trip.trip_cancel and trip.start_km > 0:
                trip.write({
                    'start_trip': True,
                    'start_time': trip.start_time or fields.Datetime.now(),
                })
            visit = rec.visit_id
            if visit and visit.state == 'draft':
                visit.write({'state': 'in_progress'})

    def write(self, vals):
        # Pre-write validation: when the write would change trip_id or
        # start_km, validate BEFORE applying. The resolved trip is either the
        # new one in vals, or each record's current trip_id.
        if 'trip_id' in vals or 'start_km' in vals:
            for rec in self:
                rec_vals = dict(vals)
                if 'trip_id' not in rec_vals and rec.trip_id:
                    rec_vals['trip_id'] = rec.trip_id.id
                self._validate_vals_start_km_or_raise(rec_vals)
        res = super().write(vals)
        if any(k in vals for k in ('trip_id', 'visit_id', 'start_km')):
            try:
                self._auto_start_trip_and_visit()
            except Exception:
                _logger.exception(
                    "[field-attendance] auto-start trip/visit on trip-line write failed"
                )
        return res

    def action_open_trip(self):
        self.ensure_one()
        if not self.trip_id:
            return False
        return {
            'type': 'ir.actions.act_window',
            'name': 'Source Trip',
            'res_model': 'vehicle.tracking',
            'res_id': self.trip_id.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def action_add_trip_fuel(self):
        """Open the vehicle.fuel.log popup pre-linked to this trip-line's
        trip so the user can log a fuel stop without navigating into the
        trip itself. Mirrors hr.attendance.action_add_source_trip_fuel."""
        self.ensure_one()
        trip = self.trip_id
        if not trip:
            raise UserError(_("Pick a Source Trip first."))
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

    def action_open_visit(self):
        """Open the picked customer.visit in a form view — mirrors
        action_open_trip so the user can jump from the trip-line popup
        straight into the visit record."""
        self.ensure_one()
        if not self.visit_id:
            return False
        return {
            'type': 'ir.actions.act_window',
            'name': 'Source Visit',
            'res_model': 'customer.visit',
            'res_id': self.visit_id.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def action_delete_self(self):
        """Remove this trip line from its parent attendance, then navigate
        the user to the parent hr.attendance form. Returning a fresh
        act_window forces Odoo's web client to RELOAD the parent record's
        trip_line_ids list — without this, the client tries to re-fetch
        the just-deleted line and shows a "records with IDs X cannot be
        found" error.
        """
        self.ensure_one()
        attendance = self.attendance_id
        self.unlink()
        if not attendance:
            return {'type': 'ir.actions.act_window_close'}
        return {
            'type': 'ir.actions.act_window',
            'name': 'Field Attendance',
            'res_model': 'hr.attendance',
            'res_id': attendance.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def action_view_visits(self):
        self.ensure_one()
        all_visit_ids = (self.visit_id | self.visit_ids).ids
        return {
            'type': 'ir.actions.act_window',
            'name': 'Visits',
            'res_model': 'customer.visit',
            'view_mode': 'list,form',
            'domain': [('id', 'in', all_visit_ids)],
            'context': {'create': False},
        }

    @api.model_create_multi
    def create(self, vals_list):
        """When the user adds a NEW trip line to an attendance, the
        previous trip (primary or last line) is considered finished:
          - Set its end_trip flag and end_time = now
          - Mark every draft visit on that previous trip as Done

        Mirrors the user's workflow: "if they tap add additional trip
        means after added the previous trip should get the end trip".

        IMPORTANT: pass `bypass_lock=True` in context so the
        vehicle.tracking.write lock check (which otherwise rejects writes
        on already-locked records) doesn't silently no-op the auto-end
        when the trip was already touched.
        """
        # Pre-create validation: block save when start_km is missing/zero on
        # a draft trip. Reads directly from vals (the user's typed value),
        # avoiding any timing issues with related-field writeback / cache.
        for vals in vals_list:
            self._validate_vals_start_km_or_raise(vals)
        records = super().create(vals_list)
        now = fields.Datetime.now()
        for line in records:
            attendance = line.attendance_id
            if not attendance:
                continue
            # Find the trip BEFORE this newly-added one (previous line by
            # sequence; primary trip if this is the first additional line).
            prior_lines = attendance.trip_line_ids.filtered(
                lambda ln: ln.id != line.id
            ).sorted('sequence')
            CustomerVisit = self.env['customer.visit']
            if prior_lines:
                prev_trip = prior_lines[-1].trip_id
                # Union: the line's manually-attached visits (new visit_id +
                # legacy visit_ids) + the trip's auto-derived visit_ids
                # (covers visits the user logged via the customer-visit flow
                # but never explicitly attached).
                prev_line = prior_lines[-1]
                prev_visits = prev_line.visit_id | prev_line.visit_ids | (
                    prev_trip.visit_ids if prev_trip else CustomerVisit
                )
            else:
                prev_trip = attendance.source_trip_id
                prev_visits = attendance.source_visit_ids | (
                    prev_trip.visit_ids if prev_trip else CustomerVisit
                )
            # End the previous trip if it's still open
            if prev_trip and not prev_trip.end_trip and not prev_trip.trip_cancel:
                try:
                    prev_trip.with_context(bypass_lock=True).write({
                        'end_trip': True,
                        'end_time': prev_trip.end_time or now,
                    })
                except Exception:
                    _logger.exception(
                        "[field-attendance] auto-end of previous trip %s failed",
                        prev_trip.ref,
                    )
            # Mark its draft visits as Done
            if prev_visits:
                draft_prev = prev_visits.filtered(lambda v: v.state == 'draft')
                if draft_prev:
                    try:
                        draft_prev.write({'state': 'done'})
                    except Exception:
                        _logger.exception(
                            "[field-attendance] mark visits done on prev trip failed"
                        )
        # For the NEW line being created: if start_km is already set on its
        # trip and a visit is attached, auto-start them (mirror the write hook).
        try:
            records._auto_start_trip_and_visit()
        except Exception:
            _logger.exception(
                "[field-attendance] auto-start trip/visit on trip-line create failed"
            )
        return records
