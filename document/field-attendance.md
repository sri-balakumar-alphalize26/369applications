# Field Attendance — How It Works

A plain-English guide to the Field Attendance feature in the Employee Attendance mobile app.

---

## 1. What is Field Attendance?

Field Attendance is the mode used by employees who do not sit at a desk all day — drivers, delivery staff, sales reps, technicians who travel between customer sites. Instead of a single in/out punch from the office, it lets them:

- **Check in from anywhere** (home, on the road, at a customer site).
- **Record every trip they take** with a vehicle (source, destination, vehicle, driver, KM travelled, GPS).
- **Log every customer visit** at the actual visit location (with GPS, customer, purpose, photos, voice note).
- **Log fuel stops** mid-trip with odometer reading and a receipt photo.
- **Check out at the end of the day** after closing all open trips.

Behind the scenes it produces:
- One `hr.attendance` record per day with a Field source.
- Zero or more `vehicle.tracking` rows (the trip records).
- A chain of `hr.attendance.field.trip.line` rows that link the attendance to its trips and visits.
- Zero or more `customer.visit` rows attached to those trips.
- Zero or more `vehicle.fuel.log` rows attached to those trips.

---

## 2. The daily flow at a glance

A typical field employee's day:

1. Open the app on their phone. Enter their PIN. The app finds them by Badge ID.
2. Tap **Check In** — captures a photo of them and the current GPS as the work-start anchor.
3. *(Optional)* Setup a **Primary Trip (Home → Office)** if they actually drove to the office first.
4. Take one or more **Secondary Trips (Office or Visit → Visit)** during the day, each with a customer visit recorded at the actual visit location.
5. *(Optional)* Take a **Return Trip** at the end of the day — either Via Office or Direct back home.
6. Tap **Check Out** — closes any open trip, captures a check-out photo and GPS, marks the day complete.

The Field Attendance screen tracks the whole sequence so the user, the manager, and the HR system all see exactly what happened, where, and when.

---

## 3. Four kinds of trips you can take

| Trip mode | When you use it | What it captures | What happens on Save |
|---|---|---|---|
| **Primary (Home → Office)** | The employee drove to the office in the morning. | Source = Home/start point, Destination = Office, Vehicle, Driver, Start KM, GPS at start, Purpose. | Trip becomes the day's **Source Trip**. Save calls `setupPrimaryTripOdoo`. |
| **Secondary / Outbound (Home or Office or Visit → Visit)** | Going to a customer site. | Same trip fields + a paired Customer Visit at the destination. | Trip is created. The customer visit is added separately at the visit location (see the two-phase flow below). |
| **Return — Via Office or Direct (Visit → Office, or Visit → Home)** | Leaving the last customer of the day. | Source = last visit, Destination = Office or Home, Vehicle, Driver, Start KM, GPS, plus a Via-Office-vs-Direct selector. | Trip line is added. Save calls `createReturnTripOdoo`. |
| **Office → Home (last trip of the day)** | Driving home from the office. | Source = Office, Destination = Home, Vehicle, Driver, Start KM, GPS. | Trip line added with `isOfficeToHome = true`. Save calls `createReturnTripOdoo` with that flag. |

Only the Secondary / Outbound trip needs a customer visit. The other three are trip-only.

---

## 4. The two-phase secondary trip flow

This is the most important detail of the new Field Attendance design. It exists because the customer visit's GPS must reflect the **actual visit place**, not the office where the trip was filled out.

### Phase 1 — Before driving (at the office or home)

1. Tap **Setup Secondary Trip (Home → Visit)** or **Add Additional Trip** on the Field Attendance screen.
2. The Trip popup opens. Tap **Create New Trip**.
3. The Vehicle Tracking form opens. Fill in: Source, Destination, Vehicle, Driver, Start KM, Purpose of Visit.
4. Tap **Start Trip**. The trip is created on the server with the office's GPS as `start_latitude` / `start_longitude`. The app returns to Field Attendance.
5. The popup re-opens with the new trip already selected, and a yellow reminder banner: *"Save the trip first. Once you reach the visit, tap 'Enter Visits' on the trip card to add it with the correct location."*
6. Tap **Save**. The popup closes. The trip enters **pending** state — a yellow **Pending Trip Card** appears on the Field Attendance screen with:
   - The trip's source, destination, vehicle, driver, start KM on the left.
   - A green **Enter Visits** button on the right.
   - A yellow banner above: *"Once you reach the visit, enter the customer details."*

### Phase 2 — At the visit location

7. Drive to the customer.
8. Open the app at the customer site. Tap **Enter Visits** on the Pending Trip Card.
9. The Customer Visit form opens. The Purpose of Visit is already pre-filled from the trip. The customer-visit GPS is captured at this moment — the user's actual location.
10. Fill in customer, date/time (defaults to now), remarks, attach photos/voice if needed.
11. Tap **Save**. The visit is created (`customer.visit` row). The Field Attendance section catches the new visit on return and links it to the pending trip by calling `createAdditionalTripOdoo(attendanceId, { tripId, visitId, startKm })`. A trip line is created. The pending marker is cleared.
12. Field Attendance now shows a regular **Secondary Trip Card** with both Trip Details (left) and Visit Details (right). The Pending Card is gone.

### Why two phases?

If both records were saved in one step at the office, the customer visit's lat/lng would be the office's coordinates — useless for "did the employee actually visit the customer?" analysis. Splitting the flow guarantees the visit's GPS = the visit place.

### Block while pending

While a pending secondary trip is waiting for its visit, the app **hides** the following buttons:
- Setup Primary Trip
- Setup / Add Additional Secondary Trip
- Primary Trip (Via Office or Direct)
- Office → Home

…and shows a small hint below: *"Complete the visit for your pending trip before adding another."* This prevents the user from accidentally starting a new trip while leaving a half-finished one behind.

---

## 5. Customer Visits

A customer visit is created in two places:
- **Standalone** from the Visits list (regular Customer Visit feature, unrelated to Field Attendance).
- **From a pending secondary trip** via the Enter Visits button — this is the path that ties the visit to a trip line.

Fields captured:
- **Customer** — picked from the customer list, with proximity check if the customer has a saved location.
- **Visited By** — defaulted to the current user; can be overridden.
- **Date / Time** — defaults to now.
- **Purpose of Visit** — dropdown from the shared `visit.purpose` model (same list shared with Vehicle Tracking).
- **Visit Duration** — optional dropdown.
- **Remarks** — free text.
- **Latitude / Longitude / Location Name** — captured automatically from GPS at the moment the form is filled.
- **Photos** — optional, multiple images.
- **Voice Note** — optional, in-app recording.

When created from a Field Attendance pending trip, the saved `customer.visit.id` is passed back to the Field Attendance screen and `createAdditionalTripOdoo` links it to the trip via a `hr.attendance.field.trip.line` row.

---

## 6. Add Fuel

Each trip card on the Field Attendance screen shows an **Add Fuel** chip while:
- The trip is `in_progress` (started but not yet ended).
- The attendance is not yet checked out.

Tap the chip → the Add Fuel Entry sheet opens directly on top of the Field Attendance screen (no navigation away).

Fields captured:
- **Amount** (in OMR / INR / whatever the company currency is).
- **Fuel Litres**.
- **Current Odometer Reading**.
- **Odometer Image** — photo of the odometer, taken via the in-app camera or chosen from the gallery.
- **Fuel Invoice Image** — photo of the fuel receipt.
- **GPS** — captured automatically.

On Save, a `vehicle.fuel.log` row is created and linked to the trip via `vehicle_tracking_id`. The trip card's footer updates to show the fuel-logs count (e.g. *"2 fuel logs added"*). Tapping either image thumbnail in the form opens a full-screen lightbox so the user can confirm the photo looks right before saving.

Once the attendance is checked out the Add Fuel chip disappears from every trip card — fuel can only be logged while the day is still active.

---

## 7. The yellow info banners

The app uses Bootstrap-warning yellow (`#FFF3CD` background, `#856404` text) for three different reminders:

| Where | When it shows | What it says |
|---|---|---|
| Inside the Trip popup (secondary mode) | After a trip is selected, before a visit is added | *"Save the trip first. Once you reach the visit, tap 'Enter Visits' on the trip card to add it with the correct location."* |
| On the Field Attendance Pending Trip Card | While the secondary trip is pending its visit | *"Once you reach the visit, enter the customer details."* |
| In the Primary Trip section | When the user has secondary trip lines but never set up a primary | *"The employee directly went Home to Visit, so no primary trip (Home to Office) required."* |

All three are non-interactive — they're guidance, not actions.

---

## 8. End-of-day check-out

1. The user taps **Check Out** on the User Attendance screen.
2. The app fetches the live Field Attendance state from the server (single source of truth for trip lines).
3. **If a pending secondary trip exists** (started, no visit yet) → the **Close Previous Trip popup** opens with that trip's ref and start KM. The user enters End KM and taps **Save & Checkout**. The trip is closed server-side via `endVehicleTripFromAttendanceOdoo`, the pending marker in local storage is cleared.
4. **Else if a regular open trip exists** (trip line with no end_km) → same Close Previous Trip popup opens for that trip.
5. **Else** → check-out proceeds directly to the photo-capture step.
6. After the End KM is entered (in either of the above cases), the app continues with:
   - Bulk-marking every linked customer visit as Done.
   - Taking a check-out photo via the camera.
   - Calling `checkOutFieldAttendanceOdoo` which sets `hr.attendance.is_checked_out = True` and records check-out GPS.
7. The Field Attendance section refreshes. With `isCheckedOut = true`:
   - The grey "checked out, read-only" banner replaces the workflow banner.
   - Every "next trip" button hides (Setup Primary, Setup Secondary, Add Additional, Via Office or Direct, Office → Home).
   - Trip cards remain visible but are read-only — no Add Fuel chip, no edit pencils.

The day is now sealed.

---

## 9. Edge cases

- **App force-killed mid-flow.** The pending secondary trip marker is stored in `AsyncStorage` (key `@fa:pendingSecondaryTrip`). On next app launch the Field Attendance section reads the marker, validates it against the current attendance id, and re-renders the Pending Trip Card. The user can pick up exactly where they left off.

- **Switching attendance day.** The pending marker is scoped by `attendanceId`. If a marker from yesterday's attendance is found on today's attendance, the section clears it automatically — no stale "your trip is pending" warnings from previous days.

- **Offline mode.** Trip and visit creation can happen offline; the offline queue (separate subsystem under `src/utils/offlineQueue.js`) replays the calls when connectivity returns. The Field Attendance UI shows offline indicators where appropriate; this document doesn't go deep into the queue's mechanics.

- **Stale GPS.** The phone's GPS fix may be a few minutes old when a form opens. If the discrepancy between the cached fix and a fresh fetch is large, the Vehicle Tracking form's Verify Source button surfaces a yellow warning. The customer visit form similarly tries to refresh GPS in the background — if you tap Save before the refresh completes, the visit may save with a slightly older fix. For accuracy-critical visits, wait a few seconds for the form to show "Live GPS".

- **No primary trip.** If the user skips the Home → Office leg and goes straight to Setup Secondary Trip, the Primary Trip section shows the yellow info banner instead of the misleading "No primary trip set up yet" grey card. The Setup Primary Trip button is also hidden after that point.

- **Re-opening a finalised trip line.** Trip cards are read-only after check-out. Before check-out, the edit pencil on a draft trip in the picker re-opens the Vehicle Tracking form in edit mode — useful for fixing typos before saving.

---

## 10. Where the data lives (UI → Odoo model)

| What you see in the app | Where it lives on the server |
|---|---|
| Field attendance day record (header banner, check-in/out times, late info) | `hr.attendance` with the FA addon's extra fields (`is_checked_out`, `attendance_source = 'field'`, etc.) |
| Trip records (every trip the user starts) | `vehicle.tracking` |
| Trip lines (the chain linking attendance ↔ trip ↔ visit) | `hr.attendance.field.trip.line` (model name in the field-attendance Odoo addon) |
| Customer visits | `customer.visit` |
| Visit purposes dropdown (used in both Vehicle Tracking and Customer Visit) | `visit.purpose` — **single shared model**. The older `vehicle.purpose` model still exists for backward compatibility but is no longer wired to any menu or form. |
| Fuel logs | `vehicle.fuel.log` |
| Source / Destination locations | `vehicle.location` (with optional lat/lng for proximity checks) |
| Vehicles | `fleet.vehicle` (with extra fields for plate, tank capacity, etc.) |
| Drivers | `res.partner` (filtered by driver tag/role) |
| Trip-line + visit relations | `trip_line.visit_ids` (Many2many or Many2one depending on addon version) |

---

## 11. Buttons and gates — quick cheat sheet

| Button | Visible when |
|---|---|
| **Check In** | Attendance not yet checked in for today. |
| **Setup Primary Trip (Home → Office)** | No source trip yet, no trip lines yet, not checked out, no pending secondary. |
| **Setup Secondary Trip (Home → Visit)** | No trip lines yet, not checked out, no pending secondary. (Label changes to *"Secondary Trip"* once a primary is set.) |
| **Add Additional Trip** | Trip lines exist, the day allows a return (`show_primary_return_button`), not checked out, no pending secondary. |
| **Primary Trip (Via Office or Direct)** | Same conditions as Add Additional Trip — secondary trips done, return-leg eligibility. |
| **Office to Home** | Return trip already done (`has_return_trip_lines`), not checked out, no pending secondary. |
| **Pending Trip Card with Enter Visits** | A `pendingSecondaryTrip` marker exists in local storage matching the current attendance. |
| **Add Fuel** (on a trip card) | Trip is `in_progress`, attendance not checked out, card is not in read-only mode. |
| **Check Out** | Anytime after check-in, while still on the same attendance day. |
| **Read-only banner** | `attendance.is_checked_out = True`. |

---

## 12. A worked example

It's 8:50 AM. Driver Sri opens the app.

1. PIN `123` → Found by Badge: **Sri**, employee #3.
2. Tap **Check In** → camera flash → photo + GPS captured → attendance #81 created.
3. Sri drove to the office from home; he taps **Setup Primary Trip (Home → Office)**. Popup → Create New Trip → fills source = Home, destination = Office, vehicle = his motorbike, start KM = 56. Tap Start Trip. Returns. Popup re-opens with the trip selected. He taps Save. The trip becomes the day's Source Trip.
4. At 10:24 AM Sri leaves the office for a customer site. He taps **Setup Secondary Trip**. In Vehicle Tracking he fills source = Office, destination = Chinnakada, purpose = Pickup, start KM = 57. Tap Start Trip. Returns. Popup re-opens with the new trip selected and the yellow banner. He taps Save. The Pending Trip Card appears: VT-0074, Office → Chinnakada, Bajaj/Pulsar 150, Driver1, Start KM 57.
5. Sri drives. At 11:10 AM he arrives at Chinnakada.
6. He taps **Enter Visits** on the Pending Card. Customer Visit form opens with Purpose = Pickup already filled. GPS shows his current location at Chinnakada. He picks customer "Gulf Computer", adds remarks "Delivered 3 units", saves. Visit CV/2026/00027 is created. Field Attendance section auto-attaches: trip line 35 links VT-0074 + CV/2026/00027. The Pending Card disappears; a Secondary Trip Card with both trip and visit details now sits in its place.
7. 12:30 PM — Sri stops for fuel. He taps **Add Fuel** on the Secondary Trip Card. Enters amount 250, litres 5, odometer 78, takes a photo of the odometer and of the receipt. Saves. The card footer now reads *"1 fuel log added"*.
8. 5:45 PM — Sri is done. He taps **Check Out**. The Close Previous Trip popup appears for VT-0074 with Start KM 57 pre-filled. He enters End KM 145, taps Save & Checkout. The trip closes, visits are bulk-marked Done, camera fires for the check-out photo, attendance #81 is sealed with `is_checked_out = True`.
9. The Field Attendance section refreshes. The grey read-only banner appears. Every "next trip" button is gone. The Secondary Trip Card is still there, in read-only form, with the trip and visit data preserved for the manager and the HR system to review.

That's the full Field Attendance cycle.
