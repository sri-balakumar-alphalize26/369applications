from odoo import models, fields, api, _
from odoo.exceptions import ValidationError, UserError
from odoo.tools import format_duration
from datetime import timedelta
import logging
import pytz
from .time_utils import minutes_to_hm

_logger = logging.getLogger(__name__)


class HrAttendance(models.Model):
    _inherit = 'hr.attendance'

    # --- Late tracking fields ---
    is_first_checkin_of_day = fields.Boolean(
        string='First Check-in of Day',
        compute='_compute_is_first_checkin_of_day',
        store=True,
    )
    is_second_checkin_of_day = fields.Boolean(
        string='Second Check-in of Day',
        compute='_compute_is_first_checkin_of_day',
        store=True,
        help='True for the first check-in of session 2 in a split shift.',
    )
    checkin_session = fields.Selection([
        ('1', 'Session 1'),
        ('2', 'Session 2'),
    ], string='Session', compute='_compute_is_first_checkin_of_day', store=True)

    is_late = fields.Boolean(
        string='Is Late',
        compute='_compute_late_info',
        store=True,
    )
    late_minutes = fields.Integer(
        string='Late (Minutes)',
        compute='_compute_late_info',
        store=True,
    )
    late_minutes_display = fields.Char(
        string='Late Time',
        compute='_compute_late_minutes_display',
        store=True,
    )
    expected_start_time = fields.Float(
        string='Expected Start Time',
        compute='_compute_late_info',
        store=True,
    )
    is_half_day = fields.Boolean(
        string='Half Day',
        compute='_compute_late_info',
        store=True,
    )
    late_reason = fields.Text(
        string='Late Reason',
    )
    is_waived = fields.Boolean(
        string='Waiver Approved',
        default=False,
    )
    waiver_reason = fields.Text(
        string='Waiver Reason',
        readonly=True,
    )
    late_sequence = fields.Integer(
        string='Late # in Month',
        compute='_compute_late_sequence',
        store=True,
        group_operator='max',
        help='Sequential count of late TIMES in the month (not days).',
    )
    deduction_amount = fields.Float(
        string='Deduction Amount',
        compute='_compute_deduction_amount',
        store=True,
    )
    daily_total_hours = fields.Float(
        string='Daily Total Hours',
        compute='_compute_daily_total_hours',
    )
    check_in_office_time = fields.Char(
        string='Check In (Office Time)',
        compute='_compute_office_time',
        help='Check-in shown in the office timezone (Office Hours config), so it '
             'reads the same for everyone regardless of the viewer\'s timezone.',
    )
    check_out_office_time = fields.Char(
        string='Check Out (Office Time)',
        compute='_compute_office_time',
        help='Check-out shown in the office timezone (Office Hours config).',
    )

    # --- Computed fields ---

    @api.depends('late_minutes')
    def _compute_late_minutes_display(self):
        for rec in self:
            rec.late_minutes_display = minutes_to_hm(rec.late_minutes)

    @api.depends('employee_id', 'check_in', 'check_out')
    def _compute_display_name(self):
        """Show the attendance name (used in m2o dropdowns, breadcrumbs, etc.) in
        the OFFICE timezone (config → employee tz → UTC) instead of the viewer's
        browser timezone, so check-in/out read as office time everywhere."""
        Config = self.env['hr.attendance.late.config']
        for att in self:
            if not att.check_in:
                att.display_name = _("New")
                continue
            tz_name = 'UTC'
            if att.employee_id:
                cfg = Config.get_config_for_employee(att.employee_id.id)
                tz_name = cfg.get('timezone') or att.employee_id.tz or 'UTC'
            tz = pytz.timezone(tz_name)
            ci = pytz.utc.localize(att.check_in).astimezone(tz).strftime('%I:%M %p')
            if not att.check_out:
                att.display_name = _("From %s", ci)
            else:
                co = pytz.utc.localize(att.check_out).astimezone(tz).strftime('%I:%M %p')
                att.display_name = "%s (%s-%s)" % (format_duration(att.worked_hours), ci, co)

    @api.depends('check_in', 'check_out', 'employee_id')
    def _compute_office_time(self):
        Config = self.env['hr.attendance.late.config']
        for rec in self:
            tz_name = 'UTC'
            if rec.employee_id:
                config_data = Config.get_config_for_employee(rec.employee_id.id)
                tz_name = config_data.get('timezone') or rec.employee_id.tz or 'UTC'
            tz = pytz.timezone(tz_name)

            def _fmt(dt):
                if not dt:
                    return ''
                local = pytz.utc.localize(dt).astimezone(tz)
                return local.strftime('%d %b %Y, %I:%M %p')

            rec.check_in_office_time = _fmt(rec.check_in)
            rec.check_out_office_time = _fmt(rec.check_out)

    # --- Self-healing recompute on create / write ---
    #
    # Stored compute fields can lag when a sibling record's `is_late` is
    # updated by `_compute_late_info` but the in-memory cache hasn't been
    # flushed to the DB before `_compute_late_sequence` runs its search.
    # That race manifests as `late_sequence = 0` for all late records, which
    # historically caused `_compute_deduction_amount` to bail out and leave
    # the deduction stuck at 0. Force a flush + re-run of sequence and
    # deduction here so HR doesn't have to click the Recompute button after
    # every save.

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        try:
            # Run the FULL late-tracking compute chain after create so a brand
            # new attendance gets is_first_checkin_of_day / is_second_checkin_of_day
            # / is_late / late_minutes / late_sequence / deduction_amount all
            # populated immediately. Flush between each step so downstream
            # searches see committed values from the previous step.
            recs.flush_recordset()
            recs._compute_is_first_checkin_of_day()
            recs.flush_recordset()
            recs._compute_late_info()
            recs.flush_recordset()
            recs._compute_late_minutes_display()
            recs._compute_late_sequence()
            recs.flush_recordset()
            recs._compute_deduction_amount()
            recs.flush_recordset()
        except (ValidationError, UserError):
            # Validation popups (e.g. "enter the late reason", no-reentry) must
            # bubble up to the user and roll back the save, not be swallowed.
            raise
        except Exception:
            _logger.exception("[late-deduction] post-create recompute failed")
        return recs

    def write(self, vals):
        res = super().write(vals)
        if any(k in vals for k in ('check_in', 'check_out', 'employee_id', 'is_waived')):
            try:
                self.flush_recordset()
                self._compute_is_first_checkin_of_day()
                self.flush_recordset()
                self._compute_late_info()
                self.flush_recordset()
                self._compute_late_minutes_display()
                self._compute_late_sequence()
                self.flush_recordset()
                self._compute_deduction_amount()
                self.flush_recordset()
            except (ValidationError, UserError):
                raise
            except Exception:
                _logger.exception("[late-deduction] post-write recompute failed")
        return res

    @api.depends('check_in', 'employee_id')
    def _compute_is_first_checkin_of_day(self):
        """Decide the session by CLOCK TIME first, then derive whether this
        is the first check-in of that session from earlier check-ins of the
        same employee on the same day.

        This fixes the bug where a user who skips Session 1 entirely (e.g.
        arrives at 4 PM with Session 1 = 10–13 and Session 2 = 15–19) was
        being labelled as the "first check-in of Session 1" and reported as
        6 hours late, instead of being labelled as Session 2 and reported
        as 1 hour late from 3 PM.
        """
        Config = self.env['hr.attendance.late.config']
        for rec in self:
            rec.is_first_checkin_of_day = False
            rec.is_second_checkin_of_day = False
            rec.checkin_session = False

            if not rec.check_in or not rec.employee_id:
                continue

            config_data = Config.get_config_for_employee(rec.employee_id.id)
            # Office Timezone (config) wins, then the employee's own tz, then UTC —
            # so office hours are read in the office's locale (e.g. Oman) regardless
            # of where the server runs or whether the employee has a tz set.
            tz = pytz.timezone(config_data.get('timezone') or rec.employee_id.tz or 'UTC')
            local_dt = pytz.utc.localize(rec.check_in).astimezone(tz)
            day_start = local_dt.replace(hour=0, minute=0, second=0, microsecond=0)
            utc_start = day_start.astimezone(pytz.utc).replace(tzinfo=None)

            shift_type = config_data.get('shift_type', 'single')
            session2_start = config_data.get('office_start_hour_2', 14.0)
            local_hour = local_dt.hour + local_dt.minute / 60.0

            # 1) Classify session purely by clock time. Anything at or after
            #    the Session-2 start hour is treated as Session 2 (split
            #    shift only). This is the key fix — Session 2 is no longer
            #    gated on the existence of an earlier Session-1 check-in.
            is_session_2 = (shift_type == 'split' and local_hour >= session2_start)
            rec.checkin_session = '2' if is_session_2 else '1'

            # 2) Find earlier check-ins on the same day for the same
            #    employee within the SAME session. That determines whether
            #    THIS is the first check-in of its session.
            earlier = self.search([
                ('employee_id', '=', rec.employee_id.id),
                ('check_in', '>=', utc_start),
                ('check_in', '<', rec.check_in),
                ('id', '!=', rec.id),
            ], order='check_in asc')

            has_earlier_in_same_session = False
            for e in earlier:
                e_local = pytz.utc.localize(e.check_in).astimezone(tz)
                e_hour = e_local.hour + e_local.minute / 60.0
                e_is_session_2 = (shift_type == 'split' and e_hour >= session2_start)
                if e_is_session_2 == is_session_2:
                    has_earlier_in_same_session = True
                    break

            if not has_earlier_in_same_session:
                if is_session_2:
                    rec.is_second_checkin_of_day = True
                else:
                    rec.is_first_checkin_of_day = True

    @api.depends('check_in', 'employee_id', 'is_first_checkin_of_day', 'is_second_checkin_of_day', 'checkin_session')
    def _compute_late_info(self):
        Config = self.env['hr.attendance.late.config']
        for rec in self:
            rec.is_late = False
            rec.late_minutes = 0
            rec.expected_start_time = 0.0
            rec.is_half_day = False

            if not rec.check_in or not rec.employee_id:
                continue

            config_data = Config.get_config_for_employee(rec.employee_id.id)
            threshold = config_data.get('late_threshold_minutes', 15)

            tz = pytz.timezone(config_data.get('timezone') or rec.employee_id.tz or 'UTC')
            local_dt = pytz.utc.localize(rec.check_in).astimezone(tz)
            check_date = local_dt.date()

            # Pick the session start time purely from `checkin_session`. This
            # makes late detection symmetric across Session 1 and Session 2 —
            # any record in Session 2 is timed against `office_start_hour_2`,
            # any record in Session 1 against `office_start_hour`. Earlier we
            # gated this on `is_second_checkin_of_day`, but that flag stays
            # False if the same employee already has a Session 2 sibling
            # earlier today (or if the compute lagged), so genuine late
            # check-ins were silently un-flagged. The first-of-session gating
            # now happens only in `_compute_late_sequence` (which is what
            # actually controls deduction counting).
            if rec.checkin_session == '2':
                office_start = config_data.get('office_start_hour_2', 14.0)
            else:
                office_start = config_data.get('office_start_hour', 8.0)

            # Check half-day Friday (only applies to session 1 or single shift)
            is_half_day_fri = Config.is_half_day_friday(check_date, rec.employee_id.id)
            rec.is_half_day = is_half_day_fri

            if is_half_day_fri and rec.checkin_session == '1':
                office_start = config_data.get('half_day_start_hour', 17.0)

            rec.expected_start_time = office_start

            office_hour = int(office_start)
            office_minute = int((office_start - office_hour) * 60)
            office_start_dt = local_dt.replace(
                hour=office_hour, minute=office_minute, second=0, microsecond=0
            )

            allowed_dt = office_start_dt + timedelta(minutes=threshold)

            if local_dt > allowed_dt:
                diff = local_dt - office_start_dt
                rec.late_minutes = int(diff.total_seconds() / 60)
                rec.is_late = True

    @api.depends('is_late', 'late_minutes', 'employee_id', 'date', 'check_in', 'checkin_session')
    def _compute_late_sequence(self):
        """Count late TIMES per SESSION in the month for this employee.

        Session 1 and Session 2 maintain INDEPENDENT sequences — each with
        its own grace count. So the first late Session 2 check-in of the
        month is sequence #1 (grace) regardless of how many Session 1 late
        check-ins came before it. The first late Session 1 check-in is also
        sequence #1.

        Only the FIRST late check-in of each (date, session) bucket counts —
        subsequent same-session check-ins on the same day are duplicates and
        get sequence = 0 (no deduction).

        This intentionally bypasses the stored
        `is_first_checkin_of_day` / `is_second_checkin_of_day` flags because
        they can lag or get stuck depending on create order; bucketing
        on the fly here is always self-consistent.
        """
        for rec in self:
            rec.late_sequence = 0
            if not rec.is_late or not rec.date:
                continue

            session = rec.checkin_session or '1'
            month_start = rec.date.replace(day=1)
            late_records = self.search([
                ('employee_id', '=', rec.employee_id.id),
                ('is_late', '=', True),
                ('date', '>=', month_start),
                ('date', '<=', rec.date),
                ('checkin_session', '=', session),
            ], order='check_in asc')

            # Keep only the earliest record per date within this session.
            seen_dates = set()
            firsts = []
            for att in late_records:
                if att.date in seen_dates:
                    continue
                seen_dates.add(att.date)
                firsts.append(att)

            seq = 0
            for att in firsts:
                seq += 1
                if att.id == rec.id:
                    rec.late_sequence = seq
                    break

    @api.depends('is_late', 'late_minutes', 'late_sequence', 'employee_id', 'is_waived')
    def _compute_deduction_amount(self):
        Slab = self.env['hr.late.deduction.slab']
        Config = self.env['hr.attendance.late.config']
        for rec in self:
            rec.deduction_amount = 0.0
            if not rec.is_late:
                _logger.info(
                    "[late-deduction] rec=%s skip — is_late=False",
                    rec.id,
                )
                continue

            if rec.is_waived:
                _logger.info("[late-deduction] rec=%s skip — waived", rec.id)
                continue

            config_data = Config.get_config_for_employee(rec.employee_id.id)
            grace_times = config_data.get('grace_late_times',
                                          config_data.get('grace_late_days', 5))

            # `_compute_late_sequence` assigns a positive sequence ONLY to the
            # first late check-in of each (date, session) bucket per employee
            # per month. Sequence == 0 means this is a duplicate same-session
            # check-in or sequence couldn't be computed — either way, no
            # deduction.
            if rec.late_sequence == 0:
                _logger.info(
                    "[late-deduction] rec=%s skip — sequence=0 (duplicate or unavailable)",
                    rec.id,
                )
                continue

            if rec.late_sequence <= grace_times:
                _logger.info(
                    "[late-deduction] rec=%s skip — within grace (seq=%s grace=%s)",
                    rec.id, rec.late_sequence, grace_times,
                )
                continue

            deduction_mode = config_data.get('deduction_mode', 'fixed')
            company_id = rec.employee_id.company_id.id
            slab_amount = Slab.get_deduction_for_minutes(rec.late_minutes, company_id=company_id)

            amount = 0.0
            if deduction_mode == 'hourly':
                # Hourly wage-based deduction
                config_id = config_data.get('id')
                if config_id:
                    config_rec = Config.browse(config_id)
                    amount = config_rec.get_hourly_deduction(
                        rec.employee_id.id, rec.late_minutes, late_date=rec.date
                    ) or 0.0
                _logger.info(
                    "[late-deduction] rec=%s hourly emp=%s late_min=%s -> %s",
                    rec.id, rec.employee_id.id, rec.late_minutes, amount,
                )
                # Fallback: hourly returned 0 (no wage / no working_days /
                # daily_work_hours == 0). Use fixed slab so HR still gets a
                # deduction value instead of a silent 0.
                if amount <= 0 and slab_amount > 0:
                    _logger.warning(
                        "[late-deduction] rec=%s hourly=0, falling back to slab=%s",
                        rec.id, slab_amount,
                    )
                    amount = slab_amount
            else:
                # Fixed slab-based deduction
                amount = slab_amount
                _logger.info(
                    "[late-deduction] rec=%s slab late_min=%s -> %s",
                    rec.id, rec.late_minutes, amount,
                )

            rec.deduction_amount = amount

    @api.depends('employee_id', 'date')
    def _compute_daily_total_hours(self):
        for rec in self:
            if not rec.employee_id or not rec.date:
                rec.daily_total_hours = 0.0
                continue

            day_records = self.search([
                ('employee_id', '=', rec.employee_id.id),
                ('date', '=', rec.date),
                ('check_out', '!=', False),
            ])
            total = sum(
                (r.check_out - r.check_in).total_seconds() / 3600.0
                for r in day_records
                if r.check_in and r.check_out
            )
            rec.daily_total_hours = round(total, 2)

    # --- Constraints ---

    # Trigger on check_in / late_reason / is_waived but NOT on is_late: is_late
    # is a stored compute that depends on check_in, so it only ever flips to
    # True when check_in is (re)written — already a trigger here. Leaving is_late
    # out keeps a plain `-u` upgrade recompute (which may re-evaluate is_late on
    # historical reason-less rows) from aborting on this constraint.
    @api.constrains('late_reason', 'is_waived', 'check_in')
    def _check_late_reason_required(self):
        """Backend-only: a late check-in cannot be saved without a Late Reason.

        Bypassed (context flag) for the non-interactive entry points that
        cannot collect a reason at save time and instead enforce it through
        their own post-check-in popup: the mobile RPC creates
        (`skip_late_reason_required`), the standard kiosk/self check-in widget
        (see the `hr.employee._attendance_action_change` override in
        hr_employee.py), and data imports (`import_file`). A waived record
        (`is_waived`) is exempt — the waiver replaces the reason.

        This deliberately re-introduces the previously-removed
        `_check_late_reason_required` constraint, but scoped to the interactive
        Odoo backend (form Save button + inline list edits) so it no longer
        breaks the mobile "create first, then prompt" flow.
        """
        if self.env.context.get('skip_late_reason_required') or self.env.context.get('import_file'):
            return
        for rec in self:
            if not rec.check_in:
                continue
            if rec.is_late and not rec.is_waived and not (rec.late_reason and rec.late_reason.strip()):
                raise ValidationError(_(
                    "This is a late check-in. Please enter the Late Reason before saving."
                ))

    # --- Single-session-per-day enforcement ---

    @api.constrains('check_in', 'employee_id', 'checkin_session')
    def _check_no_reentry_same_session(self):
        """Block creating/editing a new check-in if the employee has already
        checked OUT of the same session on the same day. Once a session is
        closed for the day, it stays closed.

        Catches all entry points: backend manual create, Kiosk Mode, mobile
        app RPC, imports — anything that goes through the ORM.
        """
        for rec in self:
            if not rec.check_in or not rec.employee_id or not rec.checkin_session:
                continue
            # Skip records that already have check_out — the constraint is
            # meant to block a NEW (open) check-in into a session already
            # closed today, NOT to retroactively reject historical closed
            # records during module upgrade / data migration recomputes.
            if rec.check_out:
                continue

            config_data = self.env['hr.attendance.late.config'].get_config_for_employee(rec.employee_id.id)
            tz = pytz.timezone(config_data.get('timezone') or rec.employee_id.tz or 'UTC')
            local_dt = pytz.utc.localize(rec.check_in).astimezone(tz)
            day_start = local_dt.replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(days=1)
            utc_start = day_start.astimezone(pytz.utc).replace(tzinfo=None)
            utc_end = day_end.astimezone(pytz.utc).replace(tzinfo=None)

            existing_closed = self.search([
                ('employee_id', '=', rec.employee_id.id),
                ('check_in', '>=', utc_start),
                ('check_in', '<', utc_end),
                ('checkin_session', '=', rec.checkin_session),
                ('check_out', '!=', False),
                ('id', '!=', rec.id),
            ], limit=1)

            if existing_closed:
                raise ValidationError(_(
                    "You have already checked out of Session %s today.\n\n"
                    "Once you check out of a session, you cannot check in "
                    "again to the same session on the same day. You can "
                    "still check in to the other session, or wait until "
                    "tomorrow."
                ) % rec.checkin_session)

    @api.onchange('check_out')
    def _onchange_check_out_warn(self):
        """Show a warning popup the moment the user fills `check_out` on
        the form, so they know this closes the session for the day.

        This is a single-OK heads-up — the hard rule is enforced by the
        `_check_no_reentry_same_session` constraint above, which fires on
        any future re-check-in attempt regardless of UI surface.
        """
        if not self.check_out:
            return
        session_label = '2' if self.checkin_session == '2' else '1'
        return {
            'warning': {
                'title': _('Confirm Check Out'),
                'message': _(
                    "You are about to check out of Session %s.\n\n"
                    "Once checked out, you CANNOT check in again to "
                    "Session %s today. To re-enter, you would need to "
                    "wait until tomorrow."
                ) % (session_label, session_label),
            }
        }

    # --- Wizard launchers ---

    def action_open_checkout_confirm_wizard(self):
        """Open the check-out confirmation wizard with Cancel + Sure-Check-Out
        buttons. Provides the Cancel/Confirm UX that `@api.onchange` cannot
        (onchange.warning is single-button only)."""
        self.ensure_one()
        return {
            'name': _('Confirm Check Out'),
            'type': 'ir.actions.act_window',
            'res_model': 'hr.attendance.checkout.confirm.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_attendance_id': self.id,
            },
        }

    def action_open_late_reason_wizard(self):
        """Open the late-reason wizard popup pre-filled with this attendance.
        Mirrors the mobile app's late-reason modal — the user types the reason
        in the wizard and clicks Save, which writes back to `late_reason` on
        this record (same field the mobile submitLateReason endpoint writes).
        """
        self.ensure_one()
        return {
            'name': _('Enter Late Reason'),
            'type': 'ir.actions.act_window',
            'res_model': 'hr.attendance.late.reason.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_attendance_id': self.id,
            },
        }

    # --- API methods ---

    @api.model
    def preview_late_info(self, employee_id, check_in):
        """No-save PREVIEW of the late metrics for a hypothetical check-in.

        `late_sequence` (Late # in month) and `deduction_amount` are STORED
        computed fields whose values depend on a DB count of the employee's
        other late records — so they only get real values after the record is
        saved (in the post-create recompute). On a brand-new, unsaved record
        they are still 0, which made the backend "Enter Late Reason" popup show
        "Late # in month: 0 / Deduction: 0.00".

        This method recomputes those numbers on an in-memory `new()` record
        (no write to the database) so the popup can show the correct values
        BEFORE the user saves. `check_in` is the UTC datetime string sent by
        the web client (serializeDateTime). Returns {} when not applicable.
        """
        if not employee_id or not check_in:
            return {}
        employee = self.env['hr.employee'].browse(employee_id)
        if not employee.exists():
            return {}

        check_in_dt = fields.Datetime.to_datetime(check_in)
        rec = self.new({'employee_id': employee_id, 'check_in': check_in_dt})
        rec._compute_is_first_checkin_of_day()
        rec._compute_late_info()
        rec._compute_late_minutes_display()

        info = {
            'is_late': bool(rec.is_late),
            'late_minutes': int(rec.late_minutes or 0),
            'late_minutes_display': rec.late_minutes_display or '',
            'expected_start_time': float(rec.expected_start_time or 0.0),
            'checkin_session': rec.checkin_session or '1',
            'late_sequence': 0,
            'deduction_amount': 0.0,
        }
        if not rec.is_late:
            return info

        # Preview the month sequence the same way _compute_late_sequence does:
        # count the FIRST late check-in of each (date, session) bucket this
        # month up to this date. A hypothetical new check-in becomes the next
        # number — unless a late check-in already exists for this date+session,
        # in which case it is a same-day duplicate and earns 0 (no deduction).
        session = rec.checkin_session or '1'
        rec_date = rec.date or check_in_dt.date()
        month_start = rec_date.replace(day=1)
        late_records = self.search([
            ('employee_id', '=', employee_id),
            ('is_late', '=', True),
            ('date', '>=', month_start),
            ('date', '<=', rec_date),
            ('checkin_session', '=', session),
        ], order='check_in asc')

        seen_dates = []
        for att in late_records:
            if att.date not in seen_dates:
                seen_dates.append(att.date)

        seq = 0 if rec_date in seen_dates else len(seen_dates) + 1
        rec.late_sequence = seq
        rec._compute_deduction_amount()

        info['late_sequence'] = seq
        info['deduction_amount'] = float(rec.deduction_amount or 0.0)
        return info

    @api.model
    def get_late_attendance_report(self, employee_id=None, department_id=None,
                                   date_from=None, date_to=None):
        domain = [('is_late', '=', True), ('late_sequence', '>', 0)]
        if employee_id:
            domain.append(('employee_id', '=', employee_id))
        if department_id:
            domain.append(('department_id', '=', department_id))
        if date_from:
            domain.append(('date', '>=', date_from))
        if date_to:
            domain.append(('date', '<=', date_to))

        records = self.search(domain, order='date desc')
        return [{
            'id': r.id,
            'employee_id': r.employee_id.id,
            'employee_name': r.employee_id.name,
            'department': r.employee_id.department_id.name or '',
            'attendance_date': str(r.date),
            'check_in': str(r.check_in),
            'expected_start_time': r.expected_start_time,
            'late_minutes': r.late_minutes,
            'late_minutes_display': r.late_minutes_display,
            'is_half_day': r.is_half_day,
            'checkin_session': r.checkin_session,
            'late_reason': r.late_reason or '',
            'late_sequence': r.late_sequence,
            'deduction_amount': r.deduction_amount,
            'is_waived': r.is_waived,
            'waiver_reason': r.waiver_reason or '',
            'daily_total_hours': r.daily_total_hours,
        } for r in records]
