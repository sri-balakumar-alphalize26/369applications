# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request, Response
import json
import base64
import logging

_logger = logging.getLogger(__name__)

# Try importing Google Generative AI
try:
    import google.generativeai as genai
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False


class VehicleAIController(http.Controller):
    """
    API endpoints for AI Fuel Verification
    Used by mobile app / frontend to verify fuel entries
    """

    @http.route('/api/ai/status', type='http', auth='public', methods=['GET'], csrf=False, cors='*')
    def ai_status(self, **kwargs):
        """Check if AI Agent is configured and ready"""
        api_key = request.env['ir.config_parameter'].sudo().get_param('vehicle_tracking.gemini_api_key')
        
        return Response(
            json.dumps({
                'status': 'ok',
                'ai_available': GENAI_AVAILABLE and bool(api_key),
                'gemini_configured': bool(api_key),
                'library_installed': GENAI_AVAILABLE,
            }),
            content_type='application/json',
            status=200
        )

    @http.route('/api/ai/verify-fuel', type='http', auth='public', methods=['POST'], csrf=False, cors='*')
    def verify_fuel(self, **kwargs):
        """
        Verify fuel entry - Main API endpoint
        
        POST JSON body:
        {
            "vehicle_id": 1,
            "amount": 20.00,
            "fuel_level": 50.0,
            "upload_path": "https://example.com/receipt.jpg"  OR base64 image
        }
        
        OR with base64 image directly:
        {
            "vehicle_id": 1,
            "amount": 20.00,
            "fuel_level": 50.0,
            "receipt_image_base64": "base64_encoded_image..."
        }
        """
        try:
            # Parse request
            data = json.loads(request.httprequest.data.decode('utf-8')) if request.httprequest.data else {}
            
            vehicle_id = data.get('vehicle_id')
            amount = float(data.get('amount', 0))
            fuel_level = float(data.get('fuel_level', 0))
            upload_path = data.get('upload_path')
            receipt_base64 = data.get('receipt_image_base64')
            
            issues = []
            ocr_result = {'amount': 0, 'litres': 0}
            
            # Validate required fields
            if not vehicle_id:
                return Response(
                    json.dumps({'status': 'error', 'message': 'vehicle_id is required'}),
                    content_type='application/json',
                    status=400
                )
            
            # Get vehicle info
            vehicle = request.env['fleet.vehicle'].sudo().browse(int(vehicle_id))
            if not vehicle.exists():
                return Response(
                    json.dumps({'status': 'error', 'message': 'Vehicle not found'}),
                    content_type='application/json',
                    status=404
                )
            
            tank_capacity = vehicle.tank_capacity or 0
            
            # ===================
            # CHECK 1: Tank Capacity
            # ===================
            tank_check = {
                'passed': True,
                'tank_capacity': tank_capacity,
                'fuel_entered': fuel_level,
                'message': ''
            }
            
            if tank_capacity > 0 and fuel_level > tank_capacity:
                tank_check['passed'] = False
                tank_check['message'] = f"Fuel ({fuel_level}L) exceeds tank capacity ({tank_capacity}L)"
                issues.append(tank_check['message'])
            
            # ===================
            # CHECK 2: OCR Receipt
            # ===================
            ocr_check = {
                'performed': False,
                'success': False,
                'amount_match': True,
                'litres_match': True,
                'ocr_amount': 0,
                'ocr_litres': 0,
                'message': ''
            }
            
            # Get image data
            image_data = None
            if receipt_base64:
                image_data = receipt_base64
                ocr_check['performed'] = True
            elif upload_path:
                image_data = self._fetch_image(upload_path)
                ocr_check['performed'] = True
            
            if image_data:
                ocr_result = self._run_ocr(image_data)
                
                if ocr_result.get('success'):
                    ocr_check['success'] = True
                    ocr_check['ocr_amount'] = ocr_result.get('amount', 0)
                    ocr_check['ocr_litres'] = ocr_result.get('litres', 0)
                    
                    # Compare Amount (5% tolerance)
                    if ocr_check['ocr_amount'] > 0 and amount > 0:
                        diff = abs(amount - ocr_check['ocr_amount'])
                        if diff > (amount * 0.05):
                            ocr_check['amount_match'] = False
                            msg = f"Amount mismatch: Entered {amount} OMR, Receipt shows {ocr_check['ocr_amount']} OMR"
                            issues.append(msg)
                    
                    # Compare Litres (5% tolerance)
                    if ocr_check['ocr_litres'] > 0 and fuel_level > 0:
                        diff = abs(fuel_level - ocr_check['ocr_litres'])
                        if diff > (fuel_level * 0.05):
                            ocr_check['litres_match'] = False
                            msg = f"Litres mismatch: Entered {fuel_level}L, Receipt shows {ocr_check['ocr_litres']}L"
                            issues.append(msg)
                else:
                    ocr_check['message'] = ocr_result.get('error', 'OCR failed')
            
            # ===================
            # Final Result
            # ===================
            status = 'fraud' if issues else 'ok'
            
            response_data = {
                'status': status,
                'vehicle': {
                    'id': vehicle.id,
                    'name': vehicle.name,
                    'license_plate': vehicle.license_plate,
                    'tank_capacity': tank_capacity,
                },
                'entered': {
                    'amount': amount,
                    'fuel_level': fuel_level,
                },
                'checks': {
                    'tank_capacity': tank_check,
                    'ocr_receipt': ocr_check,
                },
                'issues': issues,
                'message': 'Fraud detected!' if issues else 'All checks passed',
            }
            
            return Response(
                json.dumps(response_data, default=str),
                content_type='application/json',
                status=200
            )
            
        except Exception as e:
            _logger.exception("Fuel verification failed")
            return Response(
                json.dumps({'status': 'error', 'message': str(e)}),
                content_type='application/json',
                status=500
            )

    @http.route('/api/ai/verify-fuel-log/<int:fuel_log_id>', type='http', auth='public', methods=['POST'], csrf=False, cors='*')
    def verify_existing_fuel_log(self, fuel_log_id, **kwargs):
        """
        Verify an existing fuel log entry by ID
        """
        try:
            fuel_log = request.env['vehicle.fuel.log'].sudo().browse(fuel_log_id)
            
            if not fuel_log.exists():
                return Response(
                    json.dumps({'status': 'error', 'message': 'Fuel log not found'}),
                    content_type='application/json',
                    status=404
                )
            
            # Run verification
            result = fuel_log._run_ai_verification()
            
            response_data = {
                'status': result.get('status'),
                'fuel_log_id': fuel_log_id,
                'fuel_log_ref': fuel_log.name,
                'driver': fuel_log.driver_id.name if fuel_log.driver_id else None,
                'vehicle': fuel_log.vehicle_id.name if fuel_log.vehicle_id else None,
                'entered': {
                    'amount': fuel_log.amount,
                    'fuel_level': fuel_log.fuel_level,
                },
                'ocr_result': {
                    'amount': fuel_log.ocr_amount,
                    'litres': fuel_log.ocr_litres,
                },
                'issues': result.get('issues', []),
                'message': result.get('message'),
            }
            
            return Response(
                json.dumps(response_data, default=str),
                content_type='application/json',
                status=200
            )
            
        except Exception as e:
            _logger.exception("Fuel log verification failed")
            return Response(
                json.dumps({'status': 'error', 'message': str(e)}),
                content_type='application/json',
                status=500
            )

    @http.route('/api/fuel/submit', type='http', auth='public', methods=['POST'], csrf=False, cors='*')
    def submit_fuel_entry(self, **kwargs):
        """
        MAIN API - Submit fuel entry, auto-verify with AI, save to Odoo
        
        POST JSON body:
        {
            "vehicle_tracking_id": 1,      # Required - the trip ID
            "vehicle_id": 1,               # Required
            "driver_id": 1,                # Required
            "amount": 3000.00,             # Required - Amount in OMR
            "fuel_level": 33.0,            # Required - Litres
            "odometer": 50000,             # Optional
            "gps_lat": "23.5880",          # Optional
            "gps_long": "58.3829",         # Optional
            "receipt_image_base64": "..."  # Required for OCR - base64 encoded image
        }
        
        Response:
        {
            "status": "ok" or "fraud",
            "saved": true,
            "fuel_log_id": 123,
            "fuel_log_ref": "FUEL-0001",
            "ai_status": "ok" or "fraud",
            "ocr_result": {"amount": 3000, "litres": 33},
            "issues": [],
            "message": "All checks passed"
        }
        """
        try:
            # Parse request
            data = json.loads(request.httprequest.data.decode('utf-8')) if request.httprequest.data else {}
            
            # Required fields
            vehicle_tracking_id = data.get('vehicle_tracking_id')
            vehicle_id = data.get('vehicle_id')
            driver_id = data.get('driver_id')
            amount = float(data.get('amount', 0))
            fuel_level = float(data.get('fuel_level', 0))
            
            # Optional fields
            odometer = float(data.get('odometer', 0))
            gps_lat = data.get('gps_lat', '')
            gps_long = data.get('gps_long', '')
            upload_path = data.get('upload_path', '')
            receipt_base64 = data.get('receipt_image_base64')
            
            # Validate required fields
            if not vehicle_tracking_id:
                return Response(
                    json.dumps({'status': 'error', 'message': 'vehicle_tracking_id is required'}),
                    content_type='application/json',
                    status=400
                )
            if not vehicle_id:
                return Response(
                    json.dumps({'status': 'error', 'message': 'vehicle_id is required'}),
                    content_type='application/json',
                    status=400
                )
            if not driver_id:
                return Response(
                    json.dumps({'status': 'error', 'message': 'driver_id is required'}),
                    content_type='application/json',
                    status=400
                )
            
            # Get vehicle info
            vehicle = request.env['fleet.vehicle'].sudo().browse(int(vehicle_id))
            if not vehicle.exists():
                return Response(
                    json.dumps({'status': 'error', 'message': 'Vehicle not found'}),
                    content_type='application/json',
                    status=404
                )
            
            tank_capacity = vehicle.tank_capacity or 0
            
            # ===========================
            # STEP 1: AI VERIFICATION
            # ===========================
            issues = []
            ocr_amount = 0
            ocr_litres = 0
            
            # CHECK 1: Tank Capacity
            if tank_capacity > 0 and fuel_level > tank_capacity:
                issues.append(f"Fuel ({fuel_level}L) exceeds tank capacity ({tank_capacity}L)")
            
            # CHECK 2: OCR Receipt
            image_data = receipt_base64
            if not image_data and upload_path:
                image_data = self._fetch_image(upload_path)
            
            if image_data:
                ocr_result = self._run_ocr(image_data)
                
                if ocr_result.get('success'):
                    ocr_amount = ocr_result.get('amount', 0)
                    ocr_litres = ocr_result.get('litres', 0)
                    
                    # Compare Amount (5% tolerance)
                    if ocr_amount > 0 and amount > 0:
                        diff = abs(amount - ocr_amount)
                        if diff > (amount * 0.05):
                            issues.append(f"Amount mismatch: Entered {amount} OMR, Receipt shows {ocr_amount} OMR")
                    
                    # Compare Litres (5% tolerance)
                    if ocr_litres > 0 and fuel_level > 0:
                        diff = abs(fuel_level - ocr_litres)
                        if diff > (fuel_level * 0.05):
                            issues.append(f"Litres mismatch: Entered {fuel_level}L, Receipt shows {ocr_litres}L")
            
            # Determine AI status
            ai_status = 'fraud' if issues else 'ok'
            
            # ===========================
            # STEP 2: SAVE TO ODOO
            # ===========================
            fuel_log = request.env['vehicle.fuel.log'].sudo().create({
                'vehicle_tracking_id': int(vehicle_tracking_id),
                'vehicle_id': int(vehicle_id),
                'driver_id': int(driver_id),
                'amount': amount,
                'fuel_level': fuel_level,
                'odometer': odometer,
                'gps_lat': gps_lat,
                'gps_long': gps_long,
                'upload_path': upload_path,
                # AI fields
                'ai_verified': True,
                'ai_status': ai_status,
                'ai_issues': '\n'.join(issues) if issues else '',
                'ocr_amount': ocr_amount,
                'ocr_litres': ocr_litres,
            })
            
            # ===========================
            # STEP 3: CREATE FRAUD REPORT (if fraud)
            # ===========================
            if ai_status == 'fraud':
                request.env['vehicle.ai.fraud.report'].sudo().create({
                    'fuel_log_id': fuel_log.id,
                    'entered_amount': amount,
                    'entered_litres': fuel_level,
                    'ocr_amount': ocr_amount,
                    'ocr_litres': ocr_litres,
                    'tank_capacity': tank_capacity,
                    'exceeds_tank': fuel_level > tank_capacity if tank_capacity > 0 else False,
                    'issues': '\n'.join(issues),
                    'status': 'open',
                })
            
            # ===========================
            # STEP 4: RETURN RESPONSE
            # ===========================
            response_data = {
                'status': ai_status,
                'saved': True,
                'fuel_log_id': fuel_log.id,
                'fuel_log_ref': fuel_log.name,
                'vehicle': {
                    'id': vehicle.id,
                    'name': vehicle.name,
                    'tank_capacity': tank_capacity,
                },
                'entered': {
                    'amount': amount,
                    'fuel_level': fuel_level,
                },
                'ocr_result': {
                    'amount': ocr_amount,
                    'litres': ocr_litres,
                },
                'issues': issues,
                'message': 'Fraud detected!' if issues else 'All checks passed - Entry saved',
            }
            
            return Response(
                json.dumps(response_data, default=str),
                content_type='application/json',
                status=200
            )
            
        except Exception as e:
            _logger.exception("Fuel submission failed")
            return Response(
                json.dumps({'status': 'error', 'message': str(e)}),
                content_type='application/json',
                status=500
            )

    @http.route('/api/ai/fraud-reports', type='http', auth='public', methods=['GET'], csrf=False, cors='*')
    def get_fraud_reports(self, status='open', limit=50, **kwargs):
        """Get list of fraud reports"""
        try:
            domain = []
            if status and status != 'all':
                domain.append(('status', '=', status))
            
            reports = request.env['vehicle.ai.fraud.report'].sudo().search(
                domain, limit=int(limit), order='create_date desc'
            )
            
            result = []
            for r in reports:
                result.append({
                    'id': r.id,
                    'ref': r.name,
                    'driver': r.driver_id.name if r.driver_id else None,
                    'vehicle': r.vehicle_id.name if r.vehicle_id else None,
                    'entered_amount': r.entered_amount,
                    'entered_litres': r.entered_litres,
                    'ocr_amount': r.ocr_amount,
                    'ocr_litres': r.ocr_litres,
                    'issues': r.issues,
                    'status': r.status,
                    'create_date': r.create_date.isoformat() if r.create_date else None,
                })
            
            return Response(
                json.dumps({'status': 'ok', 'count': len(result), 'reports': result}),
                content_type='application/json',
                status=200
            )
            
        except Exception as e:
            return Response(
                json.dumps({'status': 'error', 'message': str(e)}),
                content_type='application/json',
                status=500
            )

    @http.route('/api/vehicles', type='http', auth='public', methods=['GET'], csrf=False, cors='*')
    def get_vehicles(self, **kwargs):
        """Get list of vehicles with tank capacity - for frontend dropdown"""
        try:
            vehicles = request.env['fleet.vehicle'].sudo().search([])
            
            result = []
            for v in vehicles:
                result.append({
                    'id': v.id,
                    'name': v.name,
                    'license_plate': v.license_plate,
                    'tank_capacity': v.tank_capacity or 0,
                })
            
            return Response(
                json.dumps({'status': 'ok', 'vehicles': result}),
                content_type='application/json',
                status=200
            )
            
        except Exception as e:
            return Response(
                json.dumps({'status': 'error', 'message': str(e)}),
                content_type='application/json',
                status=500
            )

    @http.route('/api/drivers', type='http', auth='public', methods=['GET'], csrf=False, cors='*')
    def get_drivers(self, **kwargs):
        """Get list of drivers (partners) - for frontend dropdown"""
        try:
            # Get partners that are not companies (individuals)
            drivers = request.env['res.partner'].sudo().search([('is_company', '=', False)])
            
            result = []
            for d in drivers:
                result.append({
                    'id': d.id,
                    'name': d.name,
                })
            
            return Response(
                json.dumps({'status': 'ok', 'drivers': result}),
                content_type='application/json',
                status=200
            )
            
        except Exception as e:
            return Response(
                json.dumps({'status': 'error', 'message': str(e)}),
                content_type='application/json',
                status=500
            )

    @http.route('/api/trips', type='http', auth='public', methods=['GET'], csrf=False, cors='*')
    def get_trips(self, **kwargs):
        """Get list of vehicle tracking trips - for frontend dropdown"""
        try:
            trips = request.env['vehicle.tracking'].sudo().search([], order='create_date desc', limit=50)
            
            result = []
            for t in trips:
                result.append({
                    'id': t.id,
                    'name': t.name,
                    'vehicle': t.vehicle_id.name if t.vehicle_id else '',
                    'driver': t.driver_id.name if t.driver_id else '',
                    'state': t.state,
                })
            
            return Response(
                json.dumps({'status': 'ok', 'trips': result}),
                content_type='application/json',
                status=200
            )
            
        except Exception as e:
            return Response(
                json.dumps({'status': 'error', 'message': str(e)}),
                content_type='application/json',
                status=500
            )

    def _fetch_image(self, path):
        """Fetch image and return base64"""
        try:
            import requests as req
            if path.startswith('http://') or path.startswith('https://'):
                response = req.get(path, timeout=30)
                if response.status_code == 200:
                    return base64.b64encode(response.content).decode('utf-8')
            else:
                with open(path, 'rb') as f:
                    return base64.b64encode(f.read()).decode('utf-8')
        except Exception as e:
            _logger.error(f"Failed to fetch image: {e}")
        return None

    def _run_ocr(self, image_base64):
        """Run OCR on image using Gemini"""
        api_key = request.env['ir.config_parameter'].sudo().get_param('vehicle_tracking.gemini_api_key')
        
        if not GENAI_AVAILABLE:
            return {'success': False, 'error': 'Gemini library not installed'}
        
        if not api_key:
            return {'success': False, 'error': 'Gemini API key not configured'}
        
        try:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel('gemini-2.0-flash')
            
            image_part = {
                'mime_type': 'image/jpeg',
                'data': image_base64
            }
            
            prompt = """Analyze this fuel receipt image and extract:
1. Total Amount (in OMR or any currency shown)
2. Fuel Quantity (in Litres)

Return ONLY a JSON object in this exact format, nothing else:
{"amount": 0.00, "litres": 0.00}

If you cannot find a value, use 0.
Do not include any other text, just the JSON."""

            response = model.generate_content([prompt, image_part])
            response_text = response.text.strip()
            
            # Clean markdown if present
            if '```' in response_text:
                response_text = response_text.split('```')[1]
                if response_text.startswith('json'):
                    response_text = response_text[4:]
                response_text = response_text.strip()
            
            result = json.loads(response_text)
            
            return {
                'success': True,
                'amount': float(result.get('amount', 0)),
                'litres': float(result.get('litres', 0)),
            }
            
        except Exception as e:
            _logger.exception("OCR failed")
            return {'success': False, 'error': str(e)}
