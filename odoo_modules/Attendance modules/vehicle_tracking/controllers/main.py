from odoo import http
from odoo.http import request, Response
import json
from datetime import datetime

class VehicleTrackingController(http.Controller):
    @http.route('/vehicle_tracking', auth='public')
    def index(self, **kw):
        return "Vehicle Tracking Module Active"

    @http.route('/monthly/fuel-report', type='http', auth='public', methods=['GET'], csrf=False, cors='*')
    def monthly_fuel_report(self, start=None, end=None, **kwargs):
        """
        Monthly Fuel Report API - Formatted Output
        Usage: /monthly/fuel-report?start=2025-01-01&end=2025-01-31
        """
        try:
            # Build domain filter
            domain = []
            if start:
                domain.append(('date', '>=', start))
            if end:
                domain.append(('date', '<=', end))

            # Fetch vehicle tracking records
            tracking_records = request.env['vehicle.tracking'].sudo().search(domain)

            # Group by vehicle
            vehicle_data = {}
            for rec in tracking_records:
                vehicle_id = rec.vehicle_id.id if rec.vehicle_id else 0
                vehicle_name = rec.vehicle_id.name if rec.vehicle_id else 'Unknown'
                number_plate = rec.vehicle_id.license_plate if rec.vehicle_id else ''
                
                # Get tank_capacity from Fleet Vehicle directly
                tank_capacity = rec.vehicle_id.tank_capacity if rec.vehicle_id else 0

                if vehicle_id not in vehicle_data:
                    vehicle_data[vehicle_id] = {
                        'vehicle_name': vehicle_name,
                        'number_plate': number_plate,
                        'tank_capacity': tank_capacity,
                        'total_km': 0,
                        'total_fueled': 0,
                        'warnings': 0,
                        'mismatches': 0
                    }

                # Add trip data
                km_travelled = rec.km_travelled or 0
                trip_fueled = sum(rec.fuel_log_ids.mapped('fuel_level')) or 0

                vehicle_data[vehicle_id]['total_km'] += km_travelled
                vehicle_data[vehicle_id]['total_fueled'] += trip_fueled

            # Build formatted message
            message = f"📊 Fuel Summary — {start} to {end}\n"
            
            for vehicle_id, v in vehicle_data.items():
                # Calculate mileage: Total KM / (Tank Capacity - Total Fueled)
                fuel_used = v['tank_capacity'] - v['total_fueled']
                mileage = round(v['total_km'] / fuel_used, 2) if fuel_used > 0 else 0
                
                message += f"\n🚗 {v['vehicle_name']}/{v['number_plate']}\n"
                message += f"• KM: {v['total_km']}\n"
                message += f"• Liters: {v['total_fueled']}\n"
                message += f"• Mileage: {mileage} KM/L\n"
                message += f"• Warnings: {v['warnings']}\n"
                message += f"• Mismatches: {v['mismatches']}\n"

            response_data = {
                'status': 'success',
                'message': message
            }

            return Response(
                json.dumps(response_data, default=str),
                content_type='application/json',
                status=200
            )

        except Exception as e:
            return Response(
                json.dumps({'status': 'error', 'message': str(e)}),
                content_type='application/json',
                status=500
            )

    @http.route('/fuel/summary', type='http', auth='public', methods=['GET'], csrf=False, cors='*')
    def fuel_summary(self, start=None, end=None, **kwargs):
        """
        Fuel Summary API - Overall Aggregated stats
        Usage: /fuel/summary?start=2025-01-01&end=2025-01-31
        """
        try:
            domain = []
            if start:
                domain.append(('date', '>=', start))
            if end:
                domain.append(('date', '<=', end))

            tracking_records = request.env['vehicle.tracking'].sudo().search(domain)

            total_km = sum(tracking_records.mapped('km_travelled'))
            total_fuel = 0
            total_amount = 0

            for rec in tracking_records:
                total_fuel += sum(rec.fuel_log_ids.mapped('fuel_level'))
                total_amount += sum(rec.fuel_log_ids.mapped('amount'))

            avg_mileage = round(total_km / total_fuel, 2) if total_fuel > 0 else 0

            response_data = {
                'status': 'success',
                'period': {'start': start, 'end': end},
                'summary': {
                    'total_trips': len(tracking_records),
                    'total_km': total_km,
                    'total_fuel_litres': round(total_fuel, 2),
                    'total_fuel_cost': round(total_amount, 3),
                    'average_mileage_kmpl': avg_mileage,
                }
            }

            return Response(
                json.dumps(response_data, default=str),
                content_type='application/json',
                status=200
            )

        except Exception as e:
            return Response(
                json.dumps({'status': 'error', 'message': str(e)}),
                content_type='application/json',
                status=500
            )