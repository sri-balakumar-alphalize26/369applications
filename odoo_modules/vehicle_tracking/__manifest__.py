{
    'name': 'Vehicle Tracking',
    'version': '19.0.2.4.0',
    'summary': 'Track vehicle movement, trips, driver logs with AI Fraud Detection',
    'description': """
Odoo 19 Vehicle Tracking Module with AI Fraud Detection
--------------------------------------------------------
Manage vehicle trip details, driver, KM readings, invoices, and durations.

New in v1.1 - AI Fraud Detection:
- Fuel exceeds tank capacity check
- OCR Receipt verification (Amount & Litres)
- Google Gemini AI integration
- REST API for mobile app integration
    """,
    'author': 'Danat Oman',
    'company': 'DANAT OMAN',
    'category': 'Fleet',
    'depends': ['base', 'hr', 'fleet', 'vehicle_location', 'customer_visit'],
    'data': [
        'security/security.xml',
        'security/ir.model.access.csv',
        'data/vehicle_tracking_sequence.xml',
        'data/vehicle_ai_sequence.xml',
        'data/vehicle_ai_config.xml',
        'data/vehicle_purpose_data.xml',
        # Views must be declared before actions reference them.
        # The Reports actions in vehicle_tracking_actions.xml ref view
        # IDs defined in vehicle_fuel_log_view.xml, so that file moves
        # ABOVE the actions file. Same order rule for tracking_view.
        'views/vehicle_tracking_view.xml',
        'views/vehicle_fuel_log_view.xml',
        'views/vehicle_tracking_actions.xml',
        'views/vehicle_tracking_menus.xml',
        'views/vehicle_purpose_view.xml',
        'views/fleet_vehicle_inherit_view.xml',
        'views/fleet_vehicle_menu.xml',
        'views/vehicle_location_menu.xml',
        'views/vehicle_ai_views.xml',
    ],
    
    'application': True,
    'installable': True,
}
