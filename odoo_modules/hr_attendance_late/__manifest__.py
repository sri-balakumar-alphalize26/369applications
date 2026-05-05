{
    'name': 'Attendance Late Tracking & Deductions',
    'version': '19.0.4.0.0',
    'category': 'Human Resources/Attendance',
    'summary': 'Track late arrivals, grace periods, half-day Fridays, holidays, waivers, and salary deductions',
    'description': """
        Attendance Late Tracking & Deductions
        ======================================
        - Configurable office start time (company-wide or per-department)
        - Late detection with configurable threshold (default 15 min)
        - Grace period: N free late days per month before deductions apply
        - Slab-based salary deduction configuration
        - Late reason tracking
        - Time display in H:MM format (hours:minutes)
        - Configurable working days (Mon-Sun)
        - Public holiday management
        - Half-day Friday configuration (alternate Fridays)
        - Dynamic reports with grouping/filtering
        - Multiple check-ins per day with daily total hours
    """,
    'author': '369ai',
    'depends': ['hr_attendance', 'hr'],
    'data': [
        'security/ir.model.access.csv',
        'data/late_config_data.xml',
        'wizard/late_reason_wizard_views.xml',
        'wizard/checkout_confirm_wizard_views.xml',
        'views/late_deduction_slab_views.xml',
        'views/hr_attendance_views.xml',
        'views/late_config_views.xml',
        'views/public_holiday_views.xml',
        'views/late_waiver_views.xml',
        'views/late_summary_views.xml',
        'views/menu.xml',
        'reports/late_attendance_report.xml',
    ],
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}
