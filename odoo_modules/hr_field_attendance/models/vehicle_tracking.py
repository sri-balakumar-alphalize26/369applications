# -*- coding: utf-8 -*-
from odoo import api, models


class VehicleTracking(models.Model):
    _inherit = 'vehicle.tracking'

    @api.model
    def name_search(self, name='', domain=None, operator='ilike', limit=100):
        """Hide ended/cancelled trips from any Source Trip dropdown that
        passes `hide_ended_trips=True` in context. Field-level domains
        already exclude them, but this is a belt-and-suspenders defense
        against picker dialogs that ignore domain in some Odoo paths.

        NOTE: Odoo 19's signature is (name, domain, operator, limit) —
        no `args` (renamed to `domain`) and no `order`. Match exactly or
        web_name_search throws TypeError on dropdown open.
        """
        domain = list(domain or [])
        if self.env.context.get('hide_ended_trips'):
            domain = domain + [('trip_status', 'not in', ('ended', 'cancelled'))]
        return super().name_search(
            name=name, domain=domain, operator=operator, limit=limit,
        )

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

    def action_end_trip(self):
        """Override the standard End Trip lifecycle.

        When the popup was opened by `hr.attendance.action_add_additional_trip`
        (context flag `redirect_to_attendance_id` is set), close this trip
        AND immediately return the action that opens the new trip-line
        creation popup. This stitches the two-step UX into one click —
        user enters End KM, taps End Trip, and lands directly on the
        Add Additional Trip form.
        """
        super().action_end_trip()
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
