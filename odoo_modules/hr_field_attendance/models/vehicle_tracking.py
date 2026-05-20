# -*- coding: utf-8 -*-
import logging
from odoo import api, fields, models, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class VehicleTracking(models.Model):
    _inherit = 'vehicle.tracking'

    @api.model
    def name_search(self, name='', domain=None, operator='ilike', limit=100):
        """Restrict any Source Trip dropdown that passes `hide_ended_trips=True`
        in context to **draft** trips only. Once a trip is started (in_progress)
        or finished (ended/cancelled), it should no longer be attachable to a
        new attendance — it's already owned by whoever started it. Field-level
        domains already enforce this, but this override is the belt-and-
        suspenders defense against picker dialogs that ignore domain in some
        Odoo paths.

        NOTE: Odoo 19's signature is (name, domain, operator, limit) —
        no `args` (renamed to `domain`) and no `order`. Match exactly or
        web_name_search throws TypeError on dropdown open.
        """
        domain = list(domain or [])
        if self.env.context.get('hide_ended_trips'):
            domain = domain + [('trip_status', '=', 'draft')]
        return super().name_search(
            name=name, domain=domain, operator=operator, limit=limit,
        )

    @api.depends('ref', 'trip_status')
    def _compute_display_name(self):
        """Show trip status alongside the ref so users picking a trip from
        any Many2one autocomplete see at a glance whether it's Draft / Trip
        Started / Trip Ended / Cancelled. Mobile RPCs read trip.ref directly,
        so they're unaffected by this change."""
        status_labels = dict(self._fields['trip_status'].selection)
        for rec in self:
            ref = rec.ref or ''
            label = status_labels.get(rec.trip_status, '')
            rec.display_name = '%s (%s)' % (ref, label) if label and ref else ref

    def action_open_picker_edit(self):
        """Open this trip in a dialog form view so the user can edit it
        without leaving the Source Trip picker dialog. Triggered by the
        per-row Edit button in `view_vehicle_tracking_picker`.
        """
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Edit Trip — %s' % (self.ref or ''),
            'res_model': 'vehicle.tracking',
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'new',
        }

    def write(self, vals):
        """Force-fix: when a trip has end_km > start_km AND is started but not
        ended, auto-end it on save. This means the regular Save button does
        the right thing in the Close Previous Trip dialog WITHOUT relying on
        context-flag propagation or on end_km being in the just-written vals
        (which Odoo's form auto-save on blur often eats).

        Skipped automatically when:
          - the trip isn't started yet (start_trip=False) -- nothing to end
          - the trip is already ended (end_trip=True) -- already done
          - the trip is cancelled (trip_cancel=True) -- different lifecycle
          - end_km <= start_km -- user hasn't entered a meaningful end odometer

        Semantically: setting end_km > start_km on a started trip means
        "the trip is done". The vehicle.tracking form already makes end_km
        editable only when the trip is started+not-ended+not-cancelled
        (readonly='not start_trip or end_trip or trip_cancel'), so the only
        path to set end_km > 0 IS the explicit closing flow.

        The skip_auto_end_trip context guard prevents the recursive write()
        we do internally from re-triggering this branch.
        """
        res = super().write(vals)
        if self.env.context.get('skip_auto_end_trip'):
            return res
        for rec in self:
            _logger.info(
                "[field-attendance] write() check on trip %s: start_trip=%s, "
                "end_trip=%s, trip_cancel=%s, start_km=%s, end_km=%s",
                rec.ref, rec.start_trip, rec.end_trip, rec.trip_cancel,
                rec.start_km, rec.end_km,
            )
            if (rec.start_trip and not rec.end_trip and not rec.trip_cancel
                    and rec.end_km and rec.start_km is not None
                    and rec.end_km > rec.start_km):
                _logger.info(
                    "[field-attendance] AUTO-ENDING trip %s (end_km=%s > start_km=%s)",
                    rec.ref, rec.end_km, rec.start_km,
                )
                rec.with_context(skip_auto_end_trip=True).write({
                    'end_trip': True,
                    'end_time': rec.end_time or fields.Datetime.now(),
                })
                # Mirror the End Trip button path: mark linked visits done.
                try:
                    rec._mark_linked_visits_done()
                except Exception:
                    _logger.exception(
                        "[field-attendance] _mark_linked_visits_done in write hook failed"
                    )
        return res

    def action_custom_save(self):
        """Field-attendance override of the vehicle.tracking custom Save
        button. When the form was opened via the "Close Previous Trip"
        disclaimer flow (context flag show_end_disclaimer=True), the user
        clicking Save means they want to END the trip with the End KM they
        just typed. We detect that case here, force end_trip=True +
        end_time=now, and chain to the next-trip popup (or checkout)
        depending on which flow opened us.

        For any other case (regular trip editing, etc.) we fall through to
        the parent's behaviour -- which navigates to the vehicle.tracking
        list.
        """
        self.ensure_one()
        in_disclaimer = self.env.context.get('show_end_disclaimer')
        ready_to_end = (
            self.start_trip and not self.end_trip and not self.trip_cancel
            and self.end_km and self.end_km > (self.start_km or 0)
        )
        if in_disclaimer and ready_to_end:
            _logger.info(
                "[field-attendance] action_custom_save: ending trip %s via Save",
                self.ref,
            )
            self.with_context(skip_auto_end_trip=True).write({
                'end_trip': True,
                'end_time': self.end_time or fields.Datetime.now(),
            })
            try:
                self._mark_linked_visits_done()
            except Exception:
                _logger.exception(
                    "[field-attendance] _mark_linked_visits_done in action_custom_save failed"
                )
            # Chain to next action based on which flow opened the dialog.
            attendance_id = self.env.context.get('redirect_to_attendance_id')
            if attendance_id:
                return {
                    'type': 'ir.actions.act_window',
                    'name': _('Add Additional Trip'),
                    'res_model': 'field.attendance.trip.line',
                    'view_mode': 'form',
                    'view_id': self.env.ref(
                        'hr_field_attendance.view_field_attendance_trip_line_form'
                    ).id,
                    'target': 'new',
                    'context': {'default_attendance_id': attendance_id},
                }
            checkout_att_id = self.env.context.get('redirect_to_checkout_attendance_id')
            if checkout_att_id:
                att = self.env['hr.attendance'].browse(checkout_att_id)
                if att.exists() and not att.check_out:
                    att.write({'check_out': fields.Datetime.now()})
                return {
                    'type': 'ir.actions.act_window',
                    'name': _('Field Attendance'),
                    'res_model': 'hr.attendance',
                    'res_id': checkout_att_id,
                    'view_mode': 'form',
                    'target': 'current',
                }
            return {'type': 'ir.actions.act_window_close'}
        # Not in disclaimer flow or not ready -- defer to parent's behaviour.
        return super().action_custom_save()

    def action_save_and_end_trip(self):
        """Custom Save button used by the Close Previous Trip dialog. Odoo
        auto-saves any pending form changes before calling this method (default
        type='object' button behaviour), so by the time we run end_km has been
        persisted. We then explicitly set end_trip=True + end_time=now and
        redirect to the next-trip popup (or to checkout, if that flag is set).

        This is the BULLETPROOF path -- works regardless of whether the
        write() override fires, because it explicitly does end_trip itself.
        """
        self.ensure_one()
        if self.trip_cancel:
            raise UserError(_("Cannot end a cancelled trip."))
        if not self.start_trip:
            raise UserError(_("This trip hasn't been started yet."))
        if not self.end_km or self.end_km <= (self.start_km or 0):
            raise UserError(_(
                "Please enter End KM greater than Start KM (%s) "
                "before ending the trip."
            ) % (self.start_km or 0))
        if not self.end_trip:
            self.with_context(skip_auto_end_trip=True).write({
                'end_trip': True,
                'end_time': self.end_time or fields.Datetime.now(),
            })
            try:
                self._mark_linked_visits_done()
            except Exception:
                _logger.exception(
                    "[field-attendance] mark visits done in custom save failed"
                )
        # Chain to the appropriate next action depending on which flow
        # opened this dialog.
        attendance_id = self.env.context.get('redirect_to_attendance_id')
        if attendance_id:
            return {
                'type': 'ir.actions.act_window',
                'name': _('Add Additional Trip'),
                'res_model': 'field.attendance.trip.line',
                'view_mode': 'form',
                'view_id': self.env.ref(
                    'hr_field_attendance.view_field_attendance_trip_line_form'
                ).id,
                'target': 'new',
                'context': {'default_attendance_id': attendance_id},
            }
        checkout_att_id = self.env.context.get('redirect_to_checkout_attendance_id')
        if checkout_att_id:
            att = self.env['hr.attendance'].browse(checkout_att_id)
            if att.exists() and not att.check_out:
                att.write({'check_out': fields.Datetime.now()})
            return {
                'type': 'ir.actions.act_window',
                'name': _('Field Attendance'),
                'res_model': 'hr.attendance',
                'res_id': checkout_att_id,
                'view_mode': 'form',
                'target': 'current',
            }
        return {'type': 'ir.actions.act_window_close'}

    def _mark_linked_visits_done(self):
        """Transition every customer.visit linked to this trip to 'done'.
        Linked = visits attached via:
          - field.attendance.trip.line.visit_id  (per-trip-line, new)
          - field.attendance.trip.line.visit_ids (legacy M2M)
          - hr.attendance.source_visit_ids       (primary-trip side)
        """
        TripLine = self.env['field.attendance.trip.line'].sudo()
        Attendance = self.env['hr.attendance'].sudo()
        for trip in self:
            lines = TripLine.search([('trip_id', '=', trip.id)])
            line_visits = lines.mapped('visit_id') | lines.mapped('visit_ids')
            primary = Attendance.search([('source_trip_id', '=', trip.id)])
            primary_visits = primary.mapped('source_visit_ids')
            all_visits = line_visits | primary_visits
            to_finish = all_visits.filtered(lambda v: v.state != 'done')
            if to_finish:
                try:
                    to_finish.write({'state': 'done'})
                except Exception:
                    import logging
                    logging.getLogger(__name__).exception(
                        "[field-attendance] mark linked visits done on end_trip failed"
                    )

    def action_end_trip(self):
        """Override the standard End Trip lifecycle.

        Additions on top of the parent:
          - Mark every linked customer.visit as 'done' (Draft / Started -> Done)
          - When the popup was opened by the "Check Out Now" intercept
            (context flag `redirect_to_checkout_attendance_id` is set),
            finalize the attendance's check_out automatically after End
            Trip succeeds.
          - When the popup was opened by `hr.attendance.action_add_additional_trip`
            (context flag `redirect_to_attendance_id` is set), close this trip
            AND immediately return the action that opens the new trip-line
            creation popup. This stitches the two-step UX into one click —
            user enters End KM, taps End Trip, and lands directly on the
            Add Additional Trip form.
        """
        super().action_end_trip()
        self._mark_linked_visits_done()
        # NEW: Check Out Now intercept — finish the checkout after end_trip.
        checkout_att_id = self.env.context.get('redirect_to_checkout_attendance_id')
        if checkout_att_id:
            att = self.env['hr.attendance'].browse(checkout_att_id)
            if att.exists() and not att.check_out:
                att.write({'check_out': fields.Datetime.now()})
            return {
                'type': 'ir.actions.act_window',
                'name': _('Field Attendance'),
                'res_model': 'hr.attendance',
                'res_id': checkout_att_id,
                'view_mode': 'form',
                'target': 'current',
            }
        attendance_id = self.env.context.get('redirect_to_attendance_id')
        if attendance_id:
            return {
                'type': 'ir.actions.act_window',
                'name': 'Add Additional Trip',
                'res_model': 'field.attendance.trip.line',
                'view_mode': 'form',
                'view_id': self.env.ref(
                    'hr_field_attendance.view_field_attendance_trip_line_form'
                ).id,
                'target': 'new',
                'context': {'default_attendance_id': attendance_id},
            }
        return None
