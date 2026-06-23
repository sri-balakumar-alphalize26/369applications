from odoo import models, fields, api, exceptions
import logging

_logger = logging.getLogger(__name__)


class LateWaiverRequest(models.Model):
    _name = 'hr.late.waiver.request'
    _description = 'Late Waiver Request'
    _order = 'create_date desc'
    _rec_name = 'display_name'

    # --- Core Fields ---
    employee_id = fields.Many2one(
        'hr.employee',
        string='Employee',
        required=True,
        readonly=True,
        states={'draft': [('readonly', False)]},
    )
    attendance_id = fields.Many2one(
        'hr.attendance',
        string='Late Attendance Record',
        required=True,
        readonly=True,
        states={'draft': [('readonly', False)]},
        domain="[('employee_id', '=', employee_id), ('is_late', '=', True), "
               "('late_sequence', '>', 0)]",
        help='Select the late attendance record to request waiver for.',
    )
    late_date = fields.Date(
        string='Late Date',
        related='attendance_id.date',
        store=True,
        readonly=True,
    )
    late_minutes = fields.Integer(
        string='Late Minutes',
        related='attendance_id.late_minutes',
        readonly=True,
    )
    late_minutes_display = fields.Char(
        string='Late Time',
        related='attendance_id.late_minutes_display',
        readonly=True,
    )
    original_deduction = fields.Float(
        string='Deduction Amount',
        compute='_compute_original_deduction',
        readonly=True,
    )
    original_late_reason = fields.Text(
        string='Late Reason (Employee)',
        related='attendance_id.late_reason',
        readonly=True,
        help='The reason the employee entered when they checked in late.',
    )
    check_in_time = fields.Char(
        string='Check In (Office Time)',
        compute='_compute_office_times',
    )
    check_out_time = fields.Char(
        string='Check Out (Office Time)',
        compute='_compute_office_times',
    )
    reason = fields.Text(
        string='Reason for Waiver',
        required=True,
        readonly=True,
        states={'draft': [('readonly', False)]},
        help='Explain why the late deduction should be waived '
             '(e.g., office errand, client visit, etc.)',
    )

    # --- State Machine ---
    state = fields.Selection([
        ('draft', 'Draft'),
        ('pending', 'Pending Approval'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ], string='Status', default='draft', required=True, tracking=True)

    # --- Approval Fields ---
    approved_by = fields.Many2one(
        'res.users',
        string='Approved/Rejected By',
        readonly=True,
    )
    approval_date = fields.Datetime(
        string='Approval Date',
        readonly=True,
    )
    rejection_reason = fields.Text(
        string='Rejection Reason',
        readonly=True,
    )

    # --- Display ---
    display_name = fields.Char(
        compute='_compute_display_name',
        store=True,
    )

    # --- Computed Fields ---

    @api.depends('employee_id', 'late_date')
    def _compute_display_name(self):
        for rec in self:
            emp_name = rec.employee_id.name or 'New'
            date_str = str(rec.late_date) if rec.late_date else ''
            rec.display_name = f"Waiver - {emp_name} - {date_str}"

    @api.depends('attendance_id', 'attendance_id.deduction_amount')
    def _compute_original_deduction(self):
        """Show the actual deduction currently applied to the attendance —
        respects grace (late_sequence vs grace_late_times) and waiver state.
        Previously this recomputed slab/hourly from late_minutes alone, which
        showed a non-zero amount even for records inside the grace window
        (where the real deduction is 0). Now it just mirrors
        hr.attendance.deduction_amount, the single source of truth."""
        for rec in self:
            if rec.attendance_id and rec.attendance_id.is_late:
                rec.original_deduction = rec.attendance_id.deduction_amount
            else:
                rec.original_deduction = 0.0

    @api.depends('attendance_id', 'attendance_id.check_in', 'attendance_id.check_out')
    def _compute_office_times(self):
        """Check-in/out shown in the office timezone (config → employee tz → UTC),
        so the time reads the same for everyone regardless of the viewer."""
        import pytz
        Config = self.env['hr.attendance.late.config']
        for rec in self:
            rec.check_in_time = ''
            rec.check_out_time = ''
            att = rec.attendance_id
            if not att:
                continue
            tz_name = 'UTC'
            if att.employee_id:
                cfg = Config.get_config_for_employee(att.employee_id.id)
                tz_name = cfg.get('timezone') or att.employee_id.tz or 'UTC'
            tz = pytz.timezone(tz_name)
            if att.check_in:
                rec.check_in_time = pytz.utc.localize(att.check_in).astimezone(tz).strftime('%I:%M %p')
            if att.check_out:
                rec.check_out_time = pytz.utc.localize(att.check_out).astimezone(tz).strftime('%I:%M %p')

    # --- Constraints ---

    @api.constrains('employee_id', 'attendance_id')
    def _check_attendance_belongs_to_employee(self):
        for rec in self:
            if rec.attendance_id and rec.attendance_id.employee_id != rec.employee_id:
                raise exceptions.ValidationError(
                    'The selected attendance record does not belong to this employee.'
                )

    @api.constrains('attendance_id', 'state')
    def _check_duplicate_waiver(self):
        for rec in self:
            if rec.state in ('rejected',):
                continue
            existing = self.search([
                ('attendance_id', '=', rec.attendance_id.id),
                ('state', 'not in', ('rejected',)),
                ('id', '!=', rec.id),
            ], limit=1)
            if existing:
                raise exceptions.ValidationError(
                    f'A waiver request already exists for this attendance record. '
                    f'Existing: {existing.display_name} ({existing.state})'
                )

    # --- Action Methods ---

    def action_submit(self):
        """draft -> pending"""
        for rec in self:
            if rec.state != 'draft':
                raise exceptions.UserError('Only draft requests can be submitted.')
            rec.state = 'pending'
        _logger.info('[Waiver] Request submitted: %s', self.mapped('display_name'))

    def action_approve(self):
        """pending -> approved. Sets is_waived=True on the attendance record."""
        for rec in self:
            if rec.state != 'pending':
                raise exceptions.UserError('Only pending requests can be approved.')
            rec.write({
                'state': 'approved',
                'approved_by': self.env.user.id,
                'approval_date': fields.Datetime.now(),
                'rejection_reason': False,
            })
            # Set waiver flag on attendance record
            rec.attendance_id.write({
                'is_waived': True,
                'waiver_reason': rec.reason,
            })
        _logger.info('[Waiver] Request approved: %s by %s',
                     self.mapped('display_name'), self.env.user.name)

    def action_reject(self):
        """pending -> rejected"""
        for rec in self:
            if rec.state != 'pending':
                raise exceptions.UserError('Only pending requests can be rejected.')
            rec.write({
                'state': 'rejected',
                'approved_by': self.env.user.id,
                'approval_date': fields.Datetime.now(),
            })
            # Ensure waiver is removed if previously set
            rec.attendance_id.write({
                'is_waived': False,
                'waiver_reason': False,
            })
        _logger.info('[Waiver] Request rejected: %s by %s',
                     self.mapped('display_name'), self.env.user.name)

    def action_reset_to_draft(self):
        """rejected -> draft"""
        for rec in self:
            if rec.state != 'rejected':
                raise exceptions.UserError('Only rejected requests can be reset.')
            rec.write({
                'state': 'draft',
                'approved_by': False,
                'approval_date': False,
                'rejection_reason': False,
            })
