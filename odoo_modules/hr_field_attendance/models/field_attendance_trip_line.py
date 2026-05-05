# -*- coding: utf-8 -*-
import logging
from odoo import api, fields, models

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

    @api.depends(
        'trip_id', 'trip_id.start_latitude', 'trip_id.start_longitude',
        'visit_ids', 'visit_ids.latitude', 'visit_ids.longitude',
    )
    def _compute_gps_from_trip_or_visit(self):
        for rec in self:
            lat = rec.trip_id.start_latitude or ''
            lng = rec.trip_id.start_longitude or ''
            if not lat and not lng and rec.visit_ids:
                first = rec.visit_ids.sorted('date_time')[:1]
                if first:
                    if first.latitude:
                        lat = '%.7f' % float(first.latitude)
                    if first.longitude:
                        lng = '%.7f' % float(first.longitude)
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
    # Editable per-line visit selection. Defaults from the trip's auto-derived
    # visits via the onchange below, but the user can prune or extend the list
    # in the popup form. Independent storage so per-attendance edits don't
    # leak back into the underlying trip.
    visit_ids = fields.Many2many(
        'customer.visit',
        'field_attendance_trip_line_visit_rel',
        'line_id', 'visit_id',
        string='Visits',
    )

    # NOTE: visit_ids is intentionally NOT auto-populated when trip_id is
    # picked. Per user requirement, the visit list inside the trip-line
    # popup stays empty until the user manually adds rows via "Add a line".
    # Picking a trip only sets the trip — it does not pre-fill visits.

    # Lock flag: when the underlying trip has been ended, this trip line
    # is treated as readonly on the field-attendance form (no edits allowed).
    trip_ended = fields.Boolean(
        related='trip_id.end_trip', readonly=True,
    )

    # Boolean shadow of visit_ids for the popup view's `invisible` modifiers
    # (Odoo 19's M2M-truthiness in modifiers can be flaky; computed bool is
    # reliable).
    has_visits = fields.Boolean(
        compute='_compute_has_visits',
    )

    @api.depends('visit_ids')
    def _compute_has_visits(self):
        for rec in self:
            rec.has_visits = bool(rec.visit_ids)

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
        return {
            'type': 'ir.actions.act_window',
            'name': 'Visits',
            'res_model': 'customer.visit',
            'view_mode': 'list,form',
            'domain': [('id', 'in', self.visit_ids.ids)],
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
            if prior_lines:
                prev_trip = prior_lines[-1].trip_id
                prev_visits = prior_lines[-1].visit_ids
            else:
                prev_trip = attendance.source_trip_id
                prev_visits = attendance.source_visit_ids
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
        return records
