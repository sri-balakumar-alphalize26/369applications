# -*- coding: utf-8 -*-
"""Vehicle Tracking — Generate Report wizard.

One TransientModel hosts the filter form and the result tables for all
four report types (Fuel Entries, Trip Comparison, Per-Driver Summary,
Per-Vehicle Summary). The view shows only the line_ids slot matching the
chosen report_type, so the user picks → Generate → sees the right rows
without changing screens. Mirrors the pattern in gross_profit_report.
"""
import io
import base64
from collections import defaultdict
from datetime import date, datetime, timedelta

from odoo import models, fields, api, _
from odoo.exceptions import UserError, ValidationError

try:
    import xlsxwriter
except ImportError:
    xlsxwriter = None


REPORT_TYPES = [
    ('fuel_entries', 'Fuel Entries'),
    ('trip_comparison', 'Trip Comparison'),
    ('driver_summary', 'Per-Driver Summary'),
    ('vehicle_summary', 'Per-Vehicle Summary'),
]

PERIOD_OPTIONS = [
    ('today', 'Today'),
    ('yesterday', 'Yesterday'),
    ('this_week', 'This Week'),
    ('last_week', 'Last Week'),
    ('this_month', 'This Month'),
    ('last_month', 'Last Month'),
    ('this_quarter', 'This Quarter'),
    ('this_year', 'This Year'),
    ('custom', 'Custom Range'),
]


class VehicleReportWizard(models.TransientModel):
    _name = 'vehicle.report.wizard'
    _description = 'Vehicle Tracking — Generate Report Wizard'

    # ---- Filter phase ----------------------------------------------------
    report_type = fields.Selection(
        REPORT_TYPES, string='Report Type',
        default='fuel_entries', required=True,
    )
    period = fields.Selection(
        PERIOD_OPTIONS, string='Period',
        default='this_month', required=True,
    )
    date_from = fields.Date(string='Date From', required=True, default=fields.Date.today)
    date_to = fields.Date(string='Date To', required=True, default=fields.Date.today)
    company_id = fields.Many2one(
        'res.company', string='Company', required=True,
        default=lambda self: self.env.company,
    )
    vehicle_ids = fields.Many2many('fleet.vehicle', string='Vehicles')
    driver_ids = fields.Many2many('res.partner', string='Drivers')

    # ---- Result phase ----------------------------------------------------
    generated_at = fields.Datetime(string='Generated At', readonly=True)
    fuel_line_ids = fields.One2many(
        'vehicle.report.wizard.line.fuel', 'wizard_id', string='Fuel Lines',
    )
    trip_line_ids = fields.One2many(
        'vehicle.report.wizard.line.trip', 'wizard_id', string='Trip Lines',
    )
    driver_line_ids = fields.One2many(
        'vehicle.report.wizard.line.driver', 'wizard_id', string='Driver Lines',
    )
    vehicle_line_ids = fields.One2many(
        'vehicle.report.wizard.line.vehicle', 'wizard_id', string='Vehicle Lines',
    )

    # Summary chips (shown above the result table). Each report fills only
    # the chips it has data for; the view hides the rest via `invisible`.
    total_trips = fields.Integer(string='Total Trips', readonly=True)
    total_km = fields.Float(string='Total KM', readonly=True)
    total_litres = fields.Float(string='Total Litres', readonly=True)
    total_amount = fields.Float(string='Total Fuel Amount', readonly=True)

    # ---- Period -> (date_from, date_to) helper ---------------------------
    # Single source of truth used by default_get, onchange, AND
    # action_generate_report. Always clamps the upper bound to today so
    # presets like "This Month" / "This Year" don't surface future dates
    # the wizard couldn't possibly have data for.
    @staticmethod
    def _dates_for_period(period):
        today = date.today()
        df, dt = None, None
        if period == 'today':
            df, dt = today, today
        elif period == 'yesterday':
            y = today - timedelta(days=1)
            df, dt = y, y
        elif period == 'this_week':
            start = today - timedelta(days=today.weekday())
            df, dt = start, start + timedelta(days=6)
        elif period == 'last_week':
            start = today - timedelta(days=today.weekday() + 7)
            df, dt = start, start + timedelta(days=6)
        elif period == 'this_month':
            df = today.replace(day=1)
            if today.month == 12:
                next_first = today.replace(year=today.year + 1, month=1, day=1)
            else:
                next_first = today.replace(month=today.month + 1, day=1)
            dt = next_first - timedelta(days=1)
        elif period == 'last_month':
            first_this = today.replace(day=1)
            last_prev = first_this - timedelta(days=1)
            df, dt = last_prev.replace(day=1), last_prev
        elif period == 'this_quarter':
            q_month = ((today.month - 1) // 3) * 3 + 1
            df = today.replace(month=q_month, day=1)
            end_month = q_month + 2
            if end_month == 12:
                next_first = today.replace(year=today.year + 1, month=1, day=1)
            else:
                next_first = today.replace(month=end_month + 1, day=1)
            dt = next_first - timedelta(days=1)
        elif period == 'this_year':
            df, dt = today.replace(month=1, day=1), today.replace(month=12, day=31)
        # 'custom' (or anything unrecognised) — leave as None so caller
        # keeps existing values.

        # Clamp dt to today: presets that span future days (rest of this
        # week, this month, this quarter, this year) shouldn't surface
        # future dates the wizard couldn't possibly have data for.
        if dt and dt > today:
            dt = today
        if df and df > today:
            df = today
        return df, dt

    # ---- Defaults override -----------------------------------------------
    # Without this override, default date_from/date_to stay at `today`
    # regardless of the default period — _onchange_period only fires when
    # the user *changes* period, not on initial load.
    @api.model
    def default_get(self, fields_list):
        vals = super().default_get(fields_list)
        period = vals.get('period') or 'this_month'
        df, dt = self._dates_for_period(period)
        if df is not None and 'date_from' in fields_list:
            vals['date_from'] = df
        if dt is not None and 'date_to' in fields_list:
            vals['date_to'] = dt
        return vals

    # ---- Period preset -> date_from/date_to -----------------------------
    @api.onchange('period')
    def _onchange_period(self):
        df, dt = self._dates_for_period(self.period)
        if df is not None:
            self.date_from = df
        if dt is not None:
            self.date_to = dt
        # 'custom' returns (None, None) — leave existing dates alone so
        # the user can edit them.

    # ---- Clamp manually-entered future dates to today -------------------
    @api.onchange('date_from')
    def _onchange_date_from(self):
        today = date.today()
        if self.date_from and self.date_from > today:
            self.date_from = today
            return {
                'warning': {
                    'title': _('Future date not allowed'),
                    'message': _('Date From has been reset to today.'),
                },
            }

    @api.onchange('date_to')
    def _onchange_date_to(self):
        today = date.today()
        if self.date_to and self.date_to > today:
            self.date_to = today
            return {
                'warning': {
                    'title': _('Future date not allowed'),
                    'message': _('Date To has been reset to today.'),
                },
            }

    @api.constrains('date_from', 'date_to')
    def _check_no_future_dates(self):
        today = date.today()
        for wiz in self:
            if wiz.date_from and wiz.date_from > today:
                raise ValidationError(_('Date From cannot be in the future.'))
            if wiz.date_to and wiz.date_to > today:
                raise ValidationError(_('Date To cannot be in the future.'))

    # ---- Domain helpers --------------------------------------------------
    def _trip_domain(self):
        domain = [
            ('date', '>=', self.date_from),
            ('date', '<=', self.date_to),
            ('company_id', '=', self.company_id.id),
        ]
        if self.vehicle_ids:
            domain.append(('vehicle_id', 'in', self.vehicle_ids.ids))
        if self.driver_ids:
            domain.append(('driver_id', 'in', self.driver_ids.ids))
        return domain

    def _fuel_domain(self):
        # vehicle.fuel.log uses create_date for time-filtering (no `date` field).
        # Convert the wizard's date range to datetimes that bracket whole days.
        dt_from = datetime.combine(self.date_from, datetime.min.time())
        dt_to = datetime.combine(self.date_to, datetime.max.time())
        domain = [
            ('create_date', '>=', dt_from),
            ('create_date', '<=', dt_to),
        ]
        if self.vehicle_ids:
            domain.append(('vehicle_id', 'in', self.vehicle_ids.ids))
        if self.driver_ids:
            domain.append(('driver_id', 'in', self.driver_ids.ids))
        return domain

    # ---- Generate / Refresh ---------------------------------------------
    def action_generate_report(self):
        self.ensure_one()
        # Recompute date range on the server. The date fields are readonly
        # in the view when period != 'custom', and readonly fields aren't
        # always persisted through the onchange → save round-trip. Trusting
        # `period` (which IS persisted) instead of the submitted dates means
        # the wizard always reports on the right range. Use write() so the
        # change commits before the act_window re-reads the record.
        if self.period and self.period != 'custom':
            df, dt = self._dates_for_period(self.period)
            if df is not None and dt is not None:
                self.write({'date_from': df, 'date_to': dt})
        if self.date_from > self.date_to:
            raise UserError(_('Date From cannot be after Date To.'))

        # Clear any previous result rows so Refresh works cleanly.
        self.fuel_line_ids.unlink()
        self.trip_line_ids.unlink()
        self.driver_line_ids.unlink()
        self.vehicle_line_ids.unlink()
        self.write({
            'total_trips': 0,
            'total_km': 0.0,
            'total_litres': 0.0,
            'total_amount': 0.0,
        })

        if self.report_type == 'fuel_entries':
            self._build_fuel_entries()
        elif self.report_type == 'trip_comparison':
            self._build_trip_comparison()
        elif self.report_type == 'driver_summary':
            self._build_driver_summary()
        elif self.report_type == 'vehicle_summary':
            self._build_vehicle_summary()

        self.write({'generated_at': fields.Datetime.now()})

        # Reopen with explicit `name` so the dialog title shows the report
        # name instead of falling back to "Odoo". Also pin view_id so any
        # default merging doesn't pick a different form view.
        report_label = dict(REPORT_TYPES).get(self.report_type, '')
        period_label = dict(PERIOD_OPTIONS).get(self.period, '')
        return {
            'type': 'ir.actions.act_window',
            'name': '%s — %s' % (report_label, period_label),
            'res_model': self._name,
            'res_id': self.id,
            'view_id': self.env.ref('vehicle_tracking.view_vehicle_report_wizard_form').id,
            'view_mode': 'form',
            'target': 'new',
            'context': self.env.context,
        }

    def action_refresh(self):
        return self.action_generate_report()

    # ---- Builders --------------------------------------------------------
    def _build_fuel_entries(self):
        logs = self.env['vehicle.fuel.log'].search(self._fuel_domain(), order='create_date desc')
        self.env['vehicle.report.wizard.line.fuel'].create([{
            'wizard_id': self.id,
            'ref': log.name or '',
            'vehicle_id': log.vehicle_id.id or False,
            'driver_id': log.driver_id.id or False,
            'amount': log.amount or 0.0,
            'litres': log.fuel_level or 0.0,
            'odometer': log.odometer or 0.0,
            'date': log.create_date,
        } for log in logs])
        self.total_amount = sum(logs.mapped('amount'))
        self.total_litres = sum(logs.mapped('fuel_level'))

    def _build_trip_comparison(self):
        # Match the existing Trip Comparison report: only completed trips.
        domain = self._trip_domain() + [('end_trip', '=', True)]
        trips = self.env['vehicle.tracking'].search(domain, order='date desc, id desc')
        self.env['vehicle.report.wizard.line.trip'].create([{
            'wizard_id': self.id,
            'ref': trip.ref or '',
            'date': trip.date,
            'vehicle_id': trip.vehicle_id.id or False,
            'driver_id': trip.driver_id.id or False,
            'source': trip.source_id.display_name or '',
            'destination': trip.destination_id.display_name or '',
            'est_km': trip.estimated_km or 0.0,
            'actual_km': trip.km_travelled or 0.0,
            'km_var': trip.km_variance or 0.0,
            'est_hrs': trip.estimated_time or 0.0,
            'actual_hrs': trip.duration or 0.0,
            'time_var': trip.time_variance or 0.0,
        } for trip in trips])
        self.total_trips = len(trips)
        self.total_km = sum(trips.mapped('km_travelled'))

    def _build_driver_summary(self):
        # Aggregate trips + fuel per driver, then merge into one row per driver.
        trips = self.env['vehicle.tracking'].search(self._trip_domain() + [('end_trip', '=', True)])
        fuel_logs = self.env['vehicle.fuel.log'].search(self._fuel_domain())

        per_driver = defaultdict(lambda: {
            'trip_count': 0, 'total_km': 0.0,
            'total_fuel_litres': 0.0, 'total_fuel_amount': 0.0,
            'km_var_sum': 0.0, 'est_km_sum': 0.0,
            'time_var_sum': 0.0, 'est_hrs_sum': 0.0,
        })
        for t in trips:
            d = per_driver[t.driver_id.id or 0]
            d['trip_count'] += 1
            d['total_km'] += t.km_travelled or 0.0
            d['km_var_sum'] += t.km_variance or 0.0
            d['est_km_sum'] += t.estimated_km or 0.0
            d['time_var_sum'] += t.time_variance or 0.0
            d['est_hrs_sum'] += t.estimated_time or 0.0
        for f in fuel_logs:
            d = per_driver[f.driver_id.id or 0]
            d['total_fuel_litres'] += f.fuel_level or 0.0
            d['total_fuel_amount'] += f.amount or 0.0

        rows = []
        for driver_id, agg in per_driver.items():
            litres = agg['total_fuel_litres']
            est_km = agg['est_km_sum']
            est_hrs = agg['est_hrs_sum']
            rows.append({
                'wizard_id': self.id,
                'driver_id': driver_id or False,
                'trip_count': agg['trip_count'],
                'total_km': agg['total_km'],
                'total_fuel_litres': litres,
                'total_fuel_amount': agg['total_fuel_amount'],
                'avg_km_per_litre': (agg['total_km'] / litres) if litres else 0.0,
                'km_variance_pct': (agg['km_var_sum'] / est_km * 100) if est_km else 0.0,
                'time_variance_pct': (agg['time_var_sum'] / est_hrs * 100) if est_hrs else 0.0,
            })
        self.env['vehicle.report.wizard.line.driver'].create(rows)
        self.total_trips = sum(r['trip_count'] for r in rows)
        self.total_km = sum(r['total_km'] for r in rows)
        self.total_litres = sum(r['total_fuel_litres'] for r in rows)
        self.total_amount = sum(r['total_fuel_amount'] for r in rows)

    def _build_vehicle_summary(self):
        trips = self.env['vehicle.tracking'].search(self._trip_domain() + [('end_trip', '=', True)])
        fuel_logs = self.env['vehicle.fuel.log'].search(self._fuel_domain())
        period_days = (self.date_to - self.date_from).days + 1

        per_vehicle = defaultdict(lambda: {
            'trip_count': 0, 'total_km': 0.0,
            'total_fuel_litres': 0.0, 'total_fuel_amount': 0.0,
            'km_var_sum': 0.0, 'est_km_sum': 0.0,
            'trip_dates': set(),
        })
        for t in trips:
            v = per_vehicle[t.vehicle_id.id or 0]
            v['trip_count'] += 1
            v['total_km'] += t.km_travelled or 0.0
            v['km_var_sum'] += t.km_variance or 0.0
            v['est_km_sum'] += t.estimated_km or 0.0
            if t.date:
                v['trip_dates'].add(t.date)
        for f in fuel_logs:
            v = per_vehicle[f.vehicle_id.id or 0]
            v['total_fuel_litres'] += f.fuel_level or 0.0
            v['total_fuel_amount'] += f.amount or 0.0

        rows = []
        for vehicle_id, agg in per_vehicle.items():
            litres = agg['total_fuel_litres']
            est_km = agg['est_km_sum']
            active_days = len(agg['trip_dates'])
            rows.append({
                'wizard_id': self.id,
                'vehicle_id': vehicle_id or False,
                'trip_count': agg['trip_count'],
                'total_km': agg['total_km'],
                'total_fuel_litres': litres,
                'total_fuel_amount': agg['total_fuel_amount'],
                'avg_km_per_litre': (agg['total_km'] / litres) if litres else 0.0,
                'idle_days': max(0, period_days - active_days),
                'km_variance_pct': (agg['km_var_sum'] / est_km * 100) if est_km else 0.0,
            })
        self.env['vehicle.report.wizard.line.vehicle'].create(rows)
        self.total_trips = sum(r['trip_count'] for r in rows)
        self.total_km = sum(r['total_km'] for r in rows)
        self.total_litres = sum(r['total_fuel_litres'] for r in rows)
        self.total_amount = sum(r['total_fuel_amount'] for r in rows)

    # ---- PDF -------------------------------------------------------------
    def action_print_pdf(self):
        self.ensure_one()
        if not self.generated_at:
            self.action_generate_report()
        action_ref = {
            'fuel_entries': 'vehicle_tracking.action_report_wizard_fuel_entries',
            'trip_comparison': 'vehicle_tracking.action_report_wizard_trip_comparison',
            'driver_summary': 'vehicle_tracking.action_report_wizard_driver_summary',
            'vehicle_summary': 'vehicle_tracking.action_report_wizard_vehicle_summary',
        }[self.report_type]
        return self.env.ref(action_ref).report_action(self)

    # ---- Excel -----------------------------------------------------------
    def action_export_excel(self):
        self.ensure_one()
        if not xlsxwriter:
            raise UserError(_('xlsxwriter library is required for Excel export. Install it with: pip install xlsxwriter'))
        if not self.generated_at:
            self.action_generate_report()

        output = io.BytesIO()
        workbook = xlsxwriter.Workbook(output, {'in_memory': True})

        title_fmt = workbook.add_format({
            'bold': True, 'font_size': 16, 'align': 'center',
            'font_color': '#1a237e', 'bottom': 2,
        })
        subtitle_fmt = workbook.add_format({'align': 'center', 'italic': True})
        header_fmt = workbook.add_format({
            'bold': True, 'font_size': 11, 'align': 'center',
            'bg_color': '#1a237e', 'font_color': '#ffffff', 'border': 1,
        })
        cell_fmt = workbook.add_format({'font_size': 10, 'border': 1})
        num_fmt = workbook.add_format({'font_size': 10, 'border': 1, 'num_format': '#,##0.00'})
        total_fmt = workbook.add_format({
            'bold': True, 'font_size': 11, 'border': 2,
            'bg_color': '#e8eaf6', 'font_color': '#1a237e',
        })
        total_num = workbook.add_format({
            'bold': True, 'font_size': 11, 'border': 2,
            'bg_color': '#e8eaf6', 'font_color': '#1a237e', 'num_format': '#,##0.00',
        })

        type_label = dict(REPORT_TYPES).get(self.report_type, '')
        period_label = dict(PERIOD_OPTIONS).get(self.period, '')
        sheet_name = (type_label or 'Report')[:31]
        sheet = workbook.add_worksheet(sheet_name)

        # Title + subtitle
        sheet.merge_range(0, 0, 0, 7, '%s — Vehicle Tracking' % type_label, title_fmt)
        sheet.merge_range(1, 0, 1, 7,
            'Period: %s (%s to %s) | Company: %s' % (
                period_label,
                self.date_from.strftime('%d/%m/%Y'),
                self.date_to.strftime('%d/%m/%Y'),
                self.company_id.name or '',
            ),
            subtitle_fmt,
        )

        # Column setup + rows per report type
        if self.report_type == 'fuel_entries':
            headers = ['Ref', 'Vehicle', 'Driver', 'Amount', 'Litres', 'Odometer', 'Date']
            sheet.set_column(0, 0, 14)
            sheet.set_column(1, 2, 22)
            sheet.set_column(3, 5, 14)
            sheet.set_column(6, 6, 18)
            for c, h in enumerate(headers):
                sheet.write(3, c, h, header_fmt)
            row = 4
            for line in self.fuel_line_ids:
                sheet.write(row, 0, line.ref or '', cell_fmt)
                sheet.write(row, 1, line.vehicle_id.display_name or '', cell_fmt)
                sheet.write(row, 2, line.driver_id.display_name or '', cell_fmt)
                sheet.write(row, 3, line.amount, num_fmt)
                sheet.write(row, 4, line.litres, num_fmt)
                sheet.write(row, 5, line.odometer, num_fmt)
                sheet.write(row, 6, line.date.strftime('%Y-%m-%d %H:%M') if line.date else '', cell_fmt)
                row += 1
            sheet.write(row, 2, 'Totals:', total_fmt)
            sheet.write(row, 3, self.total_amount, total_num)
            sheet.write(row, 4, self.total_litres, total_num)

        elif self.report_type == 'trip_comparison':
            headers = ['Ref', 'Date', 'Vehicle', 'Driver', 'Source', 'Destination',
                       'Est KM', 'Actual KM', 'KM Var', 'Est Hrs', 'Actual Hrs', 'Time Var']
            sheet.set_column(0, 0, 12)
            sheet.set_column(1, 1, 12)
            sheet.set_column(2, 5, 22)
            sheet.set_column(6, 11, 12)
            for c, h in enumerate(headers):
                sheet.write(3, c, h, header_fmt)
            row = 4
            for line in self.trip_line_ids:
                sheet.write(row, 0, line.ref or '', cell_fmt)
                sheet.write(row, 1, line.date.strftime('%Y-%m-%d') if line.date else '', cell_fmt)
                sheet.write(row, 2, line.vehicle_id.display_name or '', cell_fmt)
                sheet.write(row, 3, line.driver_id.display_name or '', cell_fmt)
                sheet.write(row, 4, line.source or '', cell_fmt)
                sheet.write(row, 5, line.destination or '', cell_fmt)
                sheet.write(row, 6, line.est_km, num_fmt)
                sheet.write(row, 7, line.actual_km, num_fmt)
                sheet.write(row, 8, line.km_var, num_fmt)
                sheet.write(row, 9, line.est_hrs, num_fmt)
                sheet.write(row, 10, line.actual_hrs, num_fmt)
                sheet.write(row, 11, line.time_var, num_fmt)
                row += 1
            sheet.write(row, 5, 'Totals:', total_fmt)
            sheet.write(row, 6, sum(self.trip_line_ids.mapped('est_km')), total_num)
            sheet.write(row, 7, sum(self.trip_line_ids.mapped('actual_km')), total_num)
            sheet.write(row, 8, sum(self.trip_line_ids.mapped('km_var')), total_num)
            sheet.write(row, 9, sum(self.trip_line_ids.mapped('est_hrs')), total_num)
            sheet.write(row, 10, sum(self.trip_line_ids.mapped('actual_hrs')), total_num)
            sheet.write(row, 11, sum(self.trip_line_ids.mapped('time_var')), total_num)

        elif self.report_type == 'driver_summary':
            headers = ['Driver', 'Trips', 'Total KM', 'Litres', 'Fuel Amount',
                       'Avg KM/L', 'KM Var %', 'Time Var %']
            sheet.set_column(0, 0, 24)
            sheet.set_column(1, 7, 14)
            for c, h in enumerate(headers):
                sheet.write(3, c, h, header_fmt)
            row = 4
            for line in self.driver_line_ids:
                sheet.write(row, 0, line.driver_id.display_name or 'No Driver', cell_fmt)
                sheet.write(row, 1, line.trip_count, cell_fmt)
                sheet.write(row, 2, line.total_km, num_fmt)
                sheet.write(row, 3, line.total_fuel_litres, num_fmt)
                sheet.write(row, 4, line.total_fuel_amount, num_fmt)
                sheet.write(row, 5, line.avg_km_per_litre, num_fmt)
                sheet.write(row, 6, line.km_variance_pct, num_fmt)
                sheet.write(row, 7, line.time_variance_pct, num_fmt)
                row += 1
            sheet.write(row, 0, 'Totals:', total_fmt)
            sheet.write(row, 1, self.total_trips, total_fmt)
            sheet.write(row, 2, self.total_km, total_num)
            sheet.write(row, 3, self.total_litres, total_num)
            sheet.write(row, 4, self.total_amount, total_num)

        elif self.report_type == 'vehicle_summary':
            headers = ['Vehicle', 'Trips', 'Total KM', 'Litres', 'Fuel Amount',
                       'Avg KM/L', 'Idle Days', 'KM Var %']
            sheet.set_column(0, 0, 24)
            sheet.set_column(1, 7, 14)
            for c, h in enumerate(headers):
                sheet.write(3, c, h, header_fmt)
            row = 4
            for line in self.vehicle_line_ids:
                sheet.write(row, 0, line.vehicle_id.display_name or 'No Vehicle', cell_fmt)
                sheet.write(row, 1, line.trip_count, cell_fmt)
                sheet.write(row, 2, line.total_km, num_fmt)
                sheet.write(row, 3, line.total_fuel_litres, num_fmt)
                sheet.write(row, 4, line.total_fuel_amount, num_fmt)
                sheet.write(row, 5, line.avg_km_per_litre, num_fmt)
                sheet.write(row, 6, line.idle_days, cell_fmt)
                sheet.write(row, 7, line.km_variance_pct, num_fmt)
                row += 1
            sheet.write(row, 0, 'Totals:', total_fmt)
            sheet.write(row, 1, self.total_trips, total_fmt)
            sheet.write(row, 2, self.total_km, total_num)
            sheet.write(row, 3, self.total_litres, total_num)
            sheet.write(row, 4, self.total_amount, total_num)

        sheet.freeze_panes(4, 0)
        workbook.close()
        output.seek(0)

        filename = 'Vehicle_%s_%s_%s.xlsx' % (
            self.report_type, self.date_from, self.date_to,
        )
        attachment = self.env['ir.attachment'].create({
            'name': filename,
            'type': 'binary',
            'datas': base64.b64encode(output.read()),
            'mimetype': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        return {
            'type': 'ir.actions.act_url',
            'url': '/web/content/%s?download=true' % attachment.id,
            'target': 'self',
        }


# =====================================================================
# Result-row TransientModels — one per report-type.
# Columns match the corresponding QWeb template + Excel sheet.
# =====================================================================


class VehicleReportLineFuel(models.TransientModel):
    _name = 'vehicle.report.wizard.line.fuel'
    _description = 'Fuel Entries Report Line'
    _order = 'date desc'

    wizard_id = fields.Many2one('vehicle.report.wizard', ondelete='cascade')
    ref = fields.Char(string='Ref')
    vehicle_id = fields.Many2one('fleet.vehicle', string='Vehicle')
    driver_id = fields.Many2one('res.partner', string='Driver')
    amount = fields.Float(string='Amount')
    litres = fields.Float(string='Fuel (L)')
    odometer = fields.Float(string='Odometer')
    date = fields.Datetime(string='Date')


class VehicleReportLineTrip(models.TransientModel):
    _name = 'vehicle.report.wizard.line.trip'
    _description = 'Trip Comparison Report Line'
    _order = 'date desc, id desc'

    wizard_id = fields.Many2one('vehicle.report.wizard', ondelete='cascade')
    ref = fields.Char(string='Ref')
    date = fields.Date(string='Date')
    vehicle_id = fields.Many2one('fleet.vehicle', string='Vehicle')
    driver_id = fields.Many2one('res.partner', string='Driver')
    source = fields.Char(string='Source')
    destination = fields.Char(string='Destination')
    est_km = fields.Float(string='Est KM')
    actual_km = fields.Float(string='Actual KM')
    km_var = fields.Float(string='KM Var')
    est_hrs = fields.Float(string='Est Hrs')
    actual_hrs = fields.Float(string='Actual Hrs')
    time_var = fields.Float(string='Time Var')


class VehicleReportLineDriver(models.TransientModel):
    _name = 'vehicle.report.wizard.line.driver'
    _description = 'Per-Driver Summary Report Line'
    _order = 'total_km desc'

    wizard_id = fields.Many2one('vehicle.report.wizard', ondelete='cascade')
    driver_id = fields.Many2one('res.partner', string='Driver')
    trip_count = fields.Integer(string='Trips')
    total_km = fields.Float(string='Total KM')
    total_fuel_litres = fields.Float(string='Litres')
    total_fuel_amount = fields.Float(string='Fuel Amount')
    avg_km_per_litre = fields.Float(string='Avg KM/L')
    km_variance_pct = fields.Float(string='KM Var %')
    time_variance_pct = fields.Float(string='Time Var %')


class VehicleReportLineVehicle(models.TransientModel):
    _name = 'vehicle.report.wizard.line.vehicle'
    _description = 'Per-Vehicle Summary Report Line'
    _order = 'total_km desc'

    wizard_id = fields.Many2one('vehicle.report.wizard', ondelete='cascade')
    vehicle_id = fields.Many2one('fleet.vehicle', string='Vehicle')
    trip_count = fields.Integer(string='Trips')
    total_km = fields.Float(string='Total KM')
    total_fuel_litres = fields.Float(string='Litres')
    total_fuel_amount = fields.Float(string='Fuel Amount')
    avg_km_per_litre = fields.Float(string='Avg KM/L')
    idle_days = fields.Integer(string='Idle Days')
    km_variance_pct = fields.Float(string='KM Var %')
