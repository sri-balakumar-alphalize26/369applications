from odoo import http
from odoo.http import request
import json
import logging

_logger = logging.getLogger(__name__)


class LeaveAPI(http.Controller):

    @http.route('/leave/request/create', type='json', auth='user', csrf=False)
    def create_leave_request(self, **kwargs):
        """Employee submits a new leave request."""
        try:
            params = request.jsonrequest.get('params', kwargs)
            user_id = params.get('user_id') or request.env.user.id
            leave_type = params.get('leave_type', 'casual')
            from_date = params.get('from_date')
            to_date = params.get('to_date') or False
            reason = params.get('reason', '')

            if not from_date:
                return {'status': False, 'message': 'From date is required'}
            if not reason:
                return {'status': False, 'message': 'Reason is required'}

            leave = request.env['hr.leave.request'].sudo().create({
                'employee_user_id': user_id,
                'leave_type': leave_type,
                'from_date': from_date,
                'to_date': to_date,
                'reason': reason,
            })

            # Auto-submit for approval
            leave.action_submit()

            return {
                'status': True,
                'message': 'Leave request submitted successfully',
                'data': {
                    'id': leave.id,
                    'state': leave.state,
                }
            }
        except Exception as e:
            _logger.error('[Leave API] Create error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/my_requests', type='json', auth='user', csrf=False)
    def get_my_requests(self, **kwargs):
        """Get employee's own leave requests."""
        try:
            params = request.jsonrequest.get('params', kwargs)
            user_id = params.get('user_id') or request.env.user.id
            state_filter = params.get('state_filter')

            data = request.env['hr.leave.request'].sudo().get_my_leave_requests(
                user_id=user_id, state_filter=state_filter
            )
            return {'status': True, 'data': data}
        except Exception as e:
            _logger.error('[Leave API] My requests error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/pending', type='json', auth='user', csrf=False)
    def get_pending_requests(self, **kwargs):
        """Manager gets all pending requests for approval."""
        try:
            data = request.env['hr.leave.request'].sudo().get_pending_requests_for_approval()
            return {'status': True, 'data': data}
        except Exception as e:
            _logger.error('[Leave API] Pending requests error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/approve', type='json', auth='user', csrf=False)
    def approve_request(self, **kwargs):
        """Manager approves a leave request."""
        try:
            params = request.jsonrequest.get('params', kwargs)
            request_id = params.get('request_id')

            if not request_id:
                return {'status': False, 'message': 'Request ID is required'}

            leave = request.env['hr.leave.request'].sudo().browse(request_id)
            if not leave.exists():
                return {'status': False, 'message': 'Request not found'}

            leave.action_approve()
            return {'status': True, 'message': 'Leave request approved'}
        except Exception as e:
            _logger.error('[Leave API] Approve error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/reject', type='json', auth='user', csrf=False)
    def reject_request(self, **kwargs):
        """Manager rejects a leave request."""
        try:
            params = request.jsonrequest.get('params', kwargs)
            request_id = params.get('request_id')
            rejection_reason = params.get('rejection_reason', '')

            if not request_id:
                return {'status': False, 'message': 'Request ID is required'}

            leave = request.env['hr.leave.request'].sudo().browse(request_id)
            if not leave.exists():
                return {'status': False, 'message': 'Request not found'}

            leave.action_reject()
            if rejection_reason:
                leave.write({'rejection_reason': rejection_reason})

            return {'status': True, 'message': 'Leave request rejected'}
        except Exception as e:
            _logger.error('[Leave API] Reject error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/cancel', type='json', auth='user', csrf=False)
    def cancel_request(self, **kwargs):
        """Employee cancels a leave request."""
        try:
            params = request.jsonrequest.get('params', kwargs)
            request_id = params.get('request_id')

            if not request_id:
                return {'status': False, 'message': 'Request ID is required'}

            leave = request.env['hr.leave.request'].sudo().browse(request_id)
            if not leave.exists():
                return {'status': False, 'message': 'Request not found'}

            leave.action_cancel()
            return {'status': True, 'message': 'Leave request cancelled'}
        except Exception as e:
            _logger.error('[Leave API] Cancel error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/report', type='json', auth='user', csrf=False)
    def get_leave_report(self, **kwargs):
        """Get leave report with filters."""
        try:
            params = request.jsonrequest.get('params', kwargs)
            data = request.env['hr.leave.request'].sudo().get_leave_report(
                employee_id=params.get('employee_id'),
                department_id=params.get('department_id'),
                date_from=params.get('date_from'),
                date_to=params.get('date_to'),
                state_filter=params.get('state_filter'),
            )
            return {'status': True, 'data': data}
        except Exception as e:
            _logger.error('[Leave API] Report error: %s', str(e))
            return {'status': False, 'message': str(e)}
