# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import UserError
import logging
import json
import base64
import requests

_logger = logging.getLogger(__name__)

# Try importing Google Generative AI
try:
    import google.generativeai as genai
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False
    _logger.warning("google-generativeai not installed. OCR features will not work.")


class VehicleFuelLogAI(models.Model):
    _inherit = 'vehicle.fuel.log'

    # AI Verification Fields
    ai_verified = fields.Boolean(string='AI Verified', default=False, readonly=True)
    ai_status = fields.Selection([
        ('pending', 'Pending'),
        ('ok', 'OK'),
        ('fraud', 'Fraud Detected'),
    ], string='AI Status', default='pending', readonly=True)
    
    ai_issues = fields.Text(string='AI Issues', readonly=True)
    
    # OCR Results
    ocr_amount = fields.Float(string='OCR Amount', readonly=True)
    ocr_litres = fields.Float(string='OCR Litres', readonly=True)
    ocr_raw_response = fields.Text(string='OCR Raw Response', readonly=True)
    
    # Tank Capacity Check
    tank_capacity = fields.Float(string='Tank Capacity', related='vehicle_id.tank_capacity', readonly=True)
    exceeds_tank = fields.Boolean(string='Exceeds Tank', compute='_compute_exceeds_tank', store=True)

    @api.depends('fuel_level', 'vehicle_id.tank_capacity')
    def _compute_exceeds_tank(self):
        for rec in self:
            if rec.vehicle_id and rec.vehicle_id.tank_capacity > 0:
                rec.exceeds_tank = rec.fuel_level > rec.vehicle_id.tank_capacity
            else:
                rec.exceeds_tank = False

    @api.model_create_multi
    def create(self, vals_list):
        """Override create to auto-verify with AI after saving"""
        records = super().create(vals_list)
        
        # Auto-verify each new fuel entry
        for record in records:
            try:
                record._run_ai_verification_and_report()
            except Exception as e:
                _logger.error(f"Auto AI verification failed for fuel log {record.id}: {e}")
        
        return records

    def write(self, vals):
        """Override write to re-verify if amount, fuel_level, or upload_path changes"""
        result = super().write(vals)
        
        # Re-verify if key fields changed
        if any(field in vals for field in ['amount', 'fuel_level', 'upload_path']):
            for record in self:
                try:
                    record._run_ai_verification_and_report()
                except Exception as e:
                    _logger.error(f"Auto AI verification failed for fuel log {record.id}: {e}")
        
        return result

    def _run_ai_verification_and_report(self):
        """Run AI verification and create fraud report if needed"""
        self.ensure_one()
        
        # Run verification
        result = self._run_ai_verification()
        
        # Create fraud report if fraud detected
        if result.get('status') == 'fraud':
            # Check if fraud report already exists
            existing_report = self.env['vehicle.ai.fraud.report'].search([
                ('fuel_log_id', '=', self.id)
            ], limit=1)
            
            if not existing_report:
                self.env['vehicle.ai.fraud.report'].create({
                    'fuel_log_id': self.id,
                    'entered_amount': self.amount,
                    'entered_litres': self.fuel_level,
                    'ocr_amount': self.ocr_amount,
                    'ocr_litres': self.ocr_litres,
                    'tank_capacity': self.vehicle_id.tank_capacity if self.vehicle_id else 0,
                    'exceeds_tank': self.exceeds_tank,
                    'issues': self.ai_issues,
                    'status': 'open',
                })
            else:
                # Update existing report
                existing_report.write({
                    'entered_amount': self.amount,
                    'entered_litres': self.fuel_level,
                    'ocr_amount': self.ocr_amount,
                    'ocr_litres': self.ocr_litres,
                    'issues': self.ai_issues,
                })
        
        return result

    def action_verify_with_ai(self):
        """Manual trigger to verify fuel entry with AI"""
        self.ensure_one()
        result = self._run_ai_verification()
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'AI Verification',
                'message': result.get('message', 'Verification complete'),
                'type': 'success' if result.get('status') == 'ok' else 'warning',
                'sticky': False,
            }
        }

    def _run_ai_verification(self):
        """Run AI verification checks"""
        self.ensure_one()
        issues = []
        
        # Check 1: Fuel exceeds tank capacity
        if self.vehicle_id and self.vehicle_id.tank_capacity > 0:
            if self.fuel_level > self.vehicle_id.tank_capacity:
                issues.append(
                    f"Fuel entered ({self.fuel_level}L) exceeds tank capacity ({self.vehicle_id.tank_capacity}L)"
                )
        
        # Check 2: OCR Receipt Verification
        if self.upload_path:
            ocr_result = self._verify_receipt_ocr()
            if ocr_result.get('success'):
                ocr_amount = ocr_result.get('amount', 0)
                ocr_litres = ocr_result.get('litres', 0)
                
                # Save OCR results
                self.ocr_amount = ocr_amount
                self.ocr_litres = ocr_litres
                self.ocr_raw_response = ocr_result.get('raw_response', '')
                
                # Compare Amount (allow 5% tolerance)
                if ocr_amount > 0:
                    amount_diff = abs(self.amount - ocr_amount)
                    if amount_diff > (self.amount * 0.05):  # More than 5% difference
                        issues.append(
                            f"Amount mismatch: Entered {self.amount} OMR, Receipt shows {ocr_amount} OMR"
                        )
                
                # Compare Litres (allow 5% tolerance)
                if ocr_litres > 0:
                    litres_diff = abs(self.fuel_level - ocr_litres)
                    if litres_diff > (self.fuel_level * 0.05):  # More than 5% difference
                        issues.append(
                            f"Litres mismatch: Entered {self.fuel_level}L, Receipt shows {ocr_litres}L"
                        )
            else:
                # OCR failed but don't mark as fraud
                _logger.warning(f"OCR failed for fuel log {self.id}: {ocr_result.get('error')}")
        
        # Update status
        self.ai_verified = True
        if issues:
            self.ai_status = 'fraud'
            self.ai_issues = '\n'.join(issues)
        else:
            self.ai_status = 'ok'
            self.ai_issues = ''
        
        return {
            'status': 'fraud' if issues else 'ok',
            'issues': issues,
            'message': '\n'.join(issues) if issues else 'All checks passed!'
        }

    def _verify_receipt_ocr(self):
        """Use Gemini Vision to extract amount and litres from receipt"""
        
        # Get API key
        api_key = self.env['ir.config_parameter'].sudo().get_param('vehicle_tracking.gemini_api_key')
        
        if not GENAI_AVAILABLE:
            return {'success': False, 'error': 'google-generativeai not installed'}
        
        if not api_key:
            return {'success': False, 'error': 'Gemini API key not configured'}
        
        if not self.upload_path:
            return {'success': False, 'error': 'No receipt image path'}
        
        try:
            # Fetch image from upload_path
            image_data = self._fetch_image_from_path(self.upload_path)
            if not image_data:
                return {'success': False, 'error': 'Could not fetch image from path'}
            
            # Configure Gemini
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel('gemini-2.0-flash')
            
            # Create image part
            image_part = {
                'mime_type': 'image/jpeg',
                'data': image_data
            }
            
            # OCR Prompt
            prompt = """Analyze this fuel receipt image and extract:
1. Total Amount (in OMR or any currency shown)
2. Fuel Quantity (in Litres)

Return ONLY a JSON object in this exact format, nothing else:
{"amount": 0.00, "litres": 0.00}

If you cannot find a value, use 0.
Do not include any other text, just the JSON."""

            # Call Gemini
            response = model.generate_content([prompt, image_part])
            response_text = response.text.strip()
            
            # Parse JSON response
            # Clean up response (remove markdown if present)
            if response_text.startswith('```'):
                response_text = response_text.split('```')[1]
                if response_text.startswith('json'):
                    response_text = response_text[4:]
                response_text = response_text.strip()
            
            result = json.loads(response_text)
            
            return {
                'success': True,
                'amount': float(result.get('amount', 0)),
                'litres': float(result.get('litres', 0)),
                'raw_response': response.text
            }
            
        except json.JSONDecodeError as e:
            _logger.error(f"OCR JSON parse error: {e}")
            return {'success': False, 'error': f'Could not parse OCR response'}
        except Exception as e:
            _logger.exception("OCR verification failed")
            return {'success': False, 'error': str(e)}

    def _fetch_image_from_path(self, path):
        """Fetch image data from upload path (URL or local path)"""
        try:
            if path.startswith('http://') or path.startswith('https://'):
                # It's a URL - fetch it
                response = requests.get(path, timeout=30)
                if response.status_code == 200:
                    return base64.b64encode(response.content).decode('utf-8')
            else:
                # It's a local path - read file
                with open(path, 'rb') as f:
                    return base64.b64encode(f.read()).decode('utf-8')
        except Exception as e:
            _logger.error(f"Failed to fetch image from {path}: {e}")
        return None


class VehicleAIFraudReport(models.Model):
    _name = 'vehicle.ai.fraud.report'
    _description = 'AI Fraud Detection Report'
    _order = 'create_date desc'

    name = fields.Char(string='Reference', readonly=True, default='New')
    fuel_log_id = fields.Many2one('vehicle.fuel.log', string='Fuel Entry', required=True, ondelete='cascade')
    
    # Related fields for easy viewing
    driver_id = fields.Many2one(related='fuel_log_id.driver_id', string='Driver', store=True)
    vehicle_id = fields.Many2one(related='fuel_log_id.vehicle_id', string='Vehicle', store=True)
    
    # What was entered
    entered_amount = fields.Float(string='Entered Amount (OMR)')
    entered_litres = fields.Float(string='Entered Litres')
    
    # What OCR found
    ocr_amount = fields.Float(string='Receipt Amount (OMR)')
    ocr_litres = fields.Float(string='Receipt Litres')
    
    # Tank check
    tank_capacity = fields.Float(string='Tank Capacity')
    exceeds_tank = fields.Boolean(string='Exceeds Tank')
    
    # Issues
    issues = fields.Text(string='Issues Detected')
    
    # Status
    status = fields.Selection([
        ('open', 'Open'),
        ('investigating', 'Investigating'),
        ('confirmed_fraud', 'Confirmed Fraud'),
        ('false_alarm', 'False Alarm'),
        ('resolved', 'Resolved'),
    ], string='Status', default='open')
    
    notes = fields.Text(string='Investigation Notes')
    
    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('vehicle.ai.fraud.report') or 'New'
        return super().create(vals_list)
