# -*- coding: utf-8 -*-
"""Cross-module extension of customer.visit that references vehicle.tracking.

Lives here (not in customer_visit) because customer_visit does NOT depend on
vehicle_tracking — adding the dependency there would be circular since
vehicle_tracking already depends on customer_visit.

hr_field_attendance depends on both modules, so this is the safe place to
bridge them.
"""
from odoo import api, fields, models


class CustomerVisit(models.Model):
    _inherit = 'customer.visit'

    # Non-stored, used by the visit picker list view (view_customer_visit_picker
    # in hr_attendance_views.xml) to show which trip this visit belongs to.
    # Inferred by matching the visit's employee (via its driver partner mapping)
    # to a vehicle.tracking row on the same date — visits don't store a trip
    # reference directly.
    source_trip_id = fields.Many2one(
        'vehicle.tracking', string='Source Trip',
        compute='_compute_source_trip_id', store=False,
    )

    @api.depends('employee_id', 'date_time')
    def _compute_source_trip_id(self):
        Tracking = self.env['vehicle.tracking'].sudo()
        for rec in self:
            if not rec.employee_id or not rec.date_time:
                rec.source_trip_id = False
                continue
            emp = rec.employee_id
            partner_ids = []
            if emp.work_contact_id:
                partner_ids.append(emp.work_contact_id.id)
            if emp.user_id and emp.user_id.partner_id:
                partner_ids.append(emp.user_id.partner_id.id)
            if not partner_ids:
                rec.source_trip_id = False
                continue
            trip = Tracking.search([
                ('driver_id', 'in', partner_ids),
                ('date', '=', rec.date_time.date()),
            ], limit=1)
            rec.source_trip_id = trip.id if trip else False
