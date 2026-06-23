{
    'name': 'Employee Device Management',
    'version': '19.0.1.0.0',
    'category': 'Human Resources/Attendance',
    'summary': 'Register and manage employee devices for attendance verification',
    'description': """
        Employee Device Management
        ===========================
        Adds a Devices tab on the employee form to register mobile devices.
        Each device stores: Device ID, Device Name, Device Type, Active status, Last Used.
        Used by the mobile attendance app to verify that check-in/check-out
        is done from an authorized device only.
    """,
    'author': 'Amal',
    'depends': ['hr', 'hr_attendance'],
    'data': [
        'security/ir.model.access.csv',
        'views/employee_device_views.xml',
    ],
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}
