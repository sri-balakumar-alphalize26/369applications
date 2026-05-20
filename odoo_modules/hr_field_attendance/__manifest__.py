{
    'name': 'HR Field Attendance',
    'version': '19.0.1.14.11',
    'category': 'Human Resources/Attendance',
    'summary': 'Field-based attendance from vehicle trips and customer visits.',
    'description': """
        HR Field Attendance
        ===================
        Splits field-attendance functionality out of `hr_attendance_late` into
        its own module. Adds:
        - `attendance_source = field` flag on hr.attendance
        - Source Trip + Source Visits (M2O / M2M to vehicle.tracking + customer.visit)
        - GPS lat/lng captured from the first visit
        - Visited Stops auto-derived display
        - Multi-trip support via `field.attendance.trip.line` (One2many)
        - Trip Totals row (KM travelled, duration, fuel litres, fuel amount)
        - "Edit Primary Trip" / "Add Additional Trips" popups
        - Mobile-app RPCs `get_today_field_attendance` / `create_field_attendance`
        - Dedicated Field Attendance menu, list view and search filters
        Late-tracking continues to live in `hr_attendance_late`.
    """,
    'author': '369ai',
    'depends': [
        'hr_attendance',
        'hr',
        'hr_attendance_late',
        'vehicle_tracking',
        'customer_visit',
    ],
    'data': [
        'security/ir.model.access.csv',
        'views/hr_attendance_views.xml',
    ],
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}
