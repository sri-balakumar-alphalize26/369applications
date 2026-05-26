# Office Attendance — How It Works

A plain-English guide to the Office Attendance flow in the Employee Attendance mobile app.

---

## 1. What is Office Attendance?

Office Attendance is the mode used by employees who work from the company premises. Unlike Field Attendance (for drivers and travelling staff), this mode is built around two simple actions: check in at the start of the day and check out at the end. The app verifies the employee is physically at the workplace via GPS, records a selfie photo for the proof-of-presence trail, and timestamps both events in Odoo.

What it produces:
- One `hr.attendance` record per session (morning shift, afternoon shift if split-shift, etc.) with `attendance_source = 'manual'`.
- Check-in and check-out photos stored as `ir.attachment` records linked to the attendance.
- A late-arrival calculation against the configured shift start time, with optional deductions.

---

## 2. The daily flow at a glance

1. Open the app on the phone.
2. Tap **Office Attendance**.
3. Verify identity — fingerprint (preferred) or PIN.
4. Tap **Check In** at the start of the working day.
5. Confirm — camera opens, take a selfie, app verifies GPS.
6. Mid-day continue working from the office.
7. Tap **Check Out** at the end of the day.
8. Camera fires again, GPS captured, session sealed.

The app deliberately makes check-in and check-out the only two buttons on the screen — there's no edit, no manual time entry, no override. The timestamps come from the device clock at the moment the camera captures the photo.

---

## 3. Identity verification

Before any check-in can happen, the app must confirm who the user is. There are two methods:

| Method | When it's used | What happens |
|---|---|---|
| **Fingerprint** | Phone supports biometric auth and the employee has enrolled. | Native biometric prompt → matches against the user's enrolled fingerprint → finds the matching employee record by the user-id linked to this device. |
| **PIN** | Fallback when fingerprint isn't available, or the employee prefers it. | 4-digit PIN field. App calls `verifyEmployeePin(userId, pin)` to find the employee by PIN. |

Both methods return the verified employee record (`id`, `name`, `userId`, `Badge ID`, etc.) which the rest of the flow uses to label the attendance.

After verification:
- The app primes the workplace cache by fetching the geofence centre and radius for offline check-in later.
- The day's existing attendance records (if any) are loaded so the app knows whether the user has already checked in for the current shift.

---

## 4. The check-in flow, step by step

1. User taps **Check In**.
2. Confirmation alert: *"Are you sure you want to check in at HH:MM?"* — defends against accidental taps.
3. User taps **Yes** → the camera opens for the check-in selfie.
4. User captures the photo.
5. The app verifies GPS:
   - **If user is in field-visit mode** (a special variant where they're checking in from a customer site instead of the office): GPS is captured but the workplace geofence is **skipped**. The visit's customer is recorded for the proof trail.
   - **Otherwise (normal office mode):** GPS is verified against the workplace geofence. If the user is too far away, a blocking alert appears with the exact distance and accuracy, suggesting they move outdoors for a better lock. Check-in does NOT proceed.
6. If verification passes, the attendance is created in Odoo via the relevant API. The check-in photo is uploaded and attached.
7. Late arrival is computed locally using `computeLocalLateInfo()` against the cached shift config (start hour, threshold minutes, grace periods, deduction slabs).
8. Toast message confirms success.

If the user is offline, the call goes into the **offline queue** (see section 9). The check-in still happens locally with all the data captured, and is replayed against Odoo the moment the device reconnects.

---

## 5. The check-out flow, step by step

1. User taps **Check Out**.
2. Confirmation alert: *"Are you sure you want to check out at HH:MM?"*.
3. User taps **Yes** → camera opens for the check-out selfie.
4. User captures the photo.
5. GPS is captured again (no geofence block on check-out — once you've checked in you can check out from anywhere; some companies allow check-out from a customer site).
6. The Odoo attendance record is updated with `check_out`, the check-out photo is uploaded.
7. The screen refreshes; the user sees the closed session in their history.

If a late-arrival deduction applies, the displayed summary reflects it. If the user has filed a Waiver Request for the late-arrival, the deduction is held pending approval (see the Waiver Request guide).

---

## 6. Workplace geofence verification

The check-in geofence guard is the single most important safety net for Office Attendance — it stops users from clocking in remotely.

The flow:
1. Fetch the workplace location for the verified employee's `user_id` (`hr.employee.user_id → res.users.workplace_id` or a similar relation in the addon).
2. Read the workplace's `latitude`, `longitude`, and `radius_meters` (threshold).
3. Capture the device's current GPS via expo-location's `getCurrentPositionAsync` with Balanced accuracy.
4. Compute the haversine distance between current GPS and the workplace centre.
5. Compare against the radius threshold:
   - **Within threshold** → proceed.
   - **Outside threshold** → blocking alert with `distance`, `accuracy`, `threshold`, and a hint to move outdoors briefly for a better GPS lock.

The alert message includes both the *raw* distance (the literal haversine result) and the *effective* distance (after accounting for GPS accuracy ±N metres), so the user can see whether the rejection is real or just a poor satellite lock.

If the device GPS is denied or unavailable entirely, check-in is blocked with a clear error rather than silently succeeding with no coordinates.

---

## 7. Split-shift behaviour

Many companies in this app's deployment have **single-shift** schedules (one continuous day), but split-shift is supported via the late-config:

- `shift_type`: `'single'` or `'split'`.
- `office_start_hour` / `office_end_hour`: first shift bounds.
- `office_start_hour_2` / `office_end_hour_2`: second shift bounds (only for split).

When split-shift is configured, the same employee can produce **two `hr.attendance` records on the same date** — one for each shift, each with its own check-in/check-out. The app guards against re-check-in within the same session via `_check_no_reentry_same_session` on the server and a local replica of the same logic for offline mode.

The session is determined by checking the current time against the configured shift bounds:
- If `now` ≥ `office_start_hour_2`, you're in session 2.
- Else, you're in session 1.

---

## 8. Late arrival and deductions

Late-arrival logic runs both server-side (in the Odoo HR addon) and client-side (in `computeLocalLateInfo()` for offline support).

Key concepts:
- **Late threshold** — minutes past `office_start_hour` before "late" status applies. Configurable.
- **Grace late times** — how many "free" late arrivals per month before deductions kick in.
- **Grace late days** — how many days late before deductions kick in (per quarter, etc., depending on policy).
- **Deduction mode**:
  - `'fixed'` — a flat amount per late arrival.
  - `'slab'` — tiered: 1–15 min late = X, 16–30 min = Y, 31+ = Z. Slabs are fetched once and cached locally.
- **Half-day Friday** — optional rule where check-in after a certain hour on Fridays auto-marks the day as half-day with a 50% deduction.

The cached late-config is fetched on app open and refreshed when the user enters Waiver mode. Slabs are cached in AsyncStorage so offline check-ins can still compute the correct deduction estimate to show in the confirmation summary.

---

## 9. Offline support

The Office Attendance flow is designed to work without network connectivity:

1. **Verification** uses the cached employee record (refreshed on every successful online session).
2. **Workplace geofence** uses the cached workplace location (`getCachedWorkplaceLocation`) so the geofence check happens locally.
3. **Late computation** uses cached late-config + slabs, mirroring the server logic.
4. **Check-in/out RPCs** that fail (no network) are pushed onto the offline queue with their full payload (employee id, timestamp, photo base64, GPS, etc.).
5. **OfflineSyncService** monitors connectivity and replays queued operations in order when the device reconnects.
6. **Local guard against double check-in** — when offline, the app re-checks both the queue AND the cached online records before allowing a same-session re-check-in, replicating the server's `_check_no_reentry_same_session` constraint.

The user never has to know whether they're online — the experience is identical.

---

## 10. Today's attendance summary

After verification, the screen shows today's status:

- **Check in HH:MM** — when the session started.
- **Check out HH:MM** — when it ended, or `—` if still open.
- **Late by X minutes** — if applicable, plus a small chip showing the deduction amount.
- **How to fill your Field Attendance for today** — only appears if the user is in Field mode (links to that flow).

Pull-to-refresh re-fetches today's records from Odoo.

---

## 11. Edge cases

- **Forgot to check out yesterday** — server auto-closes orphan sessions at midnight in some deployments; otherwise the manager can fix it via the Odoo back-office. The app shows the un-closed session in History with a warning.
- **Wrong workplace assigned** — admin issue. The employee's `user_id → workplace_id` link in Odoo determines which geofence applies.
- **GPS spoofing** — beyond the app's control; Android's developer options and mock-location settings can fool the geofence. Some deployments add server-side checks (IP address, mac address) to catch this.
- **App force-killed between camera and Odoo write** — the photo is captured to disk first, then uploaded; if the write fails partway, the queue picks it up on next connection.
- **Multiple devices** — an employee's record stores a `user_id`, and verification matches against that user. Switching devices works as long as the new device is registered with the same login.

---

## 12. Where the data lives (UI → Odoo)

| What you see in the app | Where it lives on the server |
|---|---|
| Attendance record (check-in/out times, source, late info) | `hr.attendance` with `attendance_source = 'manual'` |
| Check-in / check-out photo | `ir.attachment` linked to the attendance |
| Workplace geofence centre + radius | `workplace.location` (custom model with lat/lng + radius_meters) |
| Employee + PIN + Badge ID | `hr.employee` with custom fields for badge + PIN |
| User account (login) | `res.users` |
| Late-arrival config | `hr.attendance.late.config` (custom model with shift hours, thresholds, deduction mode) |
| Late deduction slabs | `hr.attendance.late.slab` (custom model with min/max minutes + amount) |

---

## 13. Buttons and gates — quick cheat sheet

| Button | Visible when |
|---|---|
| **Fingerprint Verify** | Phone supports biometric auth AND user hasn't yet verified. |
| **PIN field + Verify** | Anytime the user hasn't yet verified. |
| **Check In** | Verified, no open attendance for the current session, online or offline (offline goes to queue). |
| **Check Out** | Verified, current session has a check-in without a check-out. |
| **Today's History row** | One row per closed attendance session today; tap to see detail. |
| **Late Waiver Request** card (on the mode picker) | Anytime; opens the Waiver Request flow. |
| **Leave Request** card (on the mode picker) | Anytime; opens the Leave Request flow. |

---

## 14. A worked example

8:50 AM. Anita opens the app, taps **Office Attendance**, places her thumb on the fingerprint reader. The app finds her record: Anita, employee #14. The screen now shows the workplace name (HQ — Bangalore) and an empty *"Not checked in yet"* state.

She taps **Check In**. Alert: *"Are you sure you want to check in at 08:50?"* She taps Yes. Camera opens, she takes a selfie, taps the shutter. The app verifies GPS — she's 18 m from the workplace centre, well within the 50 m radius. Attendance #234 created with `check_in = 2026-05-26 08:50:00`, photo uploaded as `ir.attachment` id 902.

The home screen now shows: *"Check in 08:50 · Late by 5 min · Deduction ₹350"*.

She works the day. At 6:15 PM she taps **Check Out**. Alert: *"Are you sure you want to check out at 18:15?"* Yes. Camera, selfie, GPS captured. The attendance is closed with `check_out = 2026-05-26 18:15:00`. Total worked: 9 hours 25 minutes. The check-out photo is attached as `ir.attachment` id 903.

If Anita wants to challenge the ₹350 deduction (she had a legitimate reason for being late — train delay), she taps **Late Waiver Request** from the mode picker, picks today's attendance from the dropdown, types her reason, and submits. The waiver waits for her manager's approval; in the meantime the deduction is held.

That's the full Office Attendance cycle.
