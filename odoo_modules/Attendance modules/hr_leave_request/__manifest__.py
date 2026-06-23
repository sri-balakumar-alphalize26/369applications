{
    "name": "HR Leave Request",
    "version": "19.0.1.1.0",
    "author": "369ai",
    "category": "Human Resources",
    "summary": "Leave Request with Manager Approval + Paid/Unpaid Config",
    "description": """
        HR Leave Request Module
        =======================
        - Employee raises leave request with from date, to date (optional), reason
        - Manager approval workflow
        - Leave types: Sick Leave, Casual Leave, Annual Leave, etc.
        - Configurable paid leave days per year (by type)
        - Unpaid leave deduction configuration
        - Carry forward option
        - Leave balance tracking per employee
        - REST API for mobile app integration
        - Integrated with Attendance module
    """,
    "depends": ["base", "web", "hr", "hr_attendance", "hr_attendance_late"],
    "data": [
        "security/leave_groups.xml",
        "security/ir.model.access.csv",
        "security/leave_security_rules.xml",
        "views/leave_config_views.xml",
        "views/leave_request_views.xml",
        "views/menu.xml",
    ],
    "installable": True,
    "application": False,
    "auto_install": False,
    "license": "LGPL-3",
}
