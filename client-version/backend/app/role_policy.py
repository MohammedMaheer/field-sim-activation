"""Maximum grants per supported role; database grants can further restrict access."""

ROLE_PERMISSIONS = {'Field Agent': ['read', 'ekyc.write', 'shift.write', 'inventory.self'],
 'Team Leader': ['read', 'task.write', 'support.write', 'report.read', 'audit.read', 'device.ping'],
 'Branch Manager': ['read',
                    'task.write',
                    'support.write',
                    'report.read',
                    'audit.read',
                    'device.ping'],
 'Operations Manager': ['read',
                        'task.write',
                        'incentive.write',
                        'inventory.write',
                        'support.write',
                        'ekyc.write',
                        'report.read',
                        'audit.read',
                        'device.ping',
                        'compliance.write'],
 'Compliance Officer': ['read', 'report.read', 'audit.read', 'compliance.write'],
 'Inventory Manager': ['read', 'report.read', 'audit.read', 'inventory.write'],
 'Sales Manager': ['read', 'report.read'],
 'Tele Verification Officer': ['call.tele.read', 'call.tele.write'],
 'Welcome Call Officer': ['call.welcome.read', 'call.welcome.write'],
 'Administrator': ['read',
                   'settings.write',
                   'task.write',
                   'incentive.write',
                   'inventory.write',
                   'support.write',
                   'report.read',
                   'audit.read',
                   'device.ping',
                   'compliance.write',
                   'shift.write']}

# Work-location grants are separate from historic customer/sales visibility.
for _role, _grants in ROLE_PERMISSIONS.items():
    _grants.append("location.self")
    if _role in {"Administrator", "Operations Manager", "Sales Manager", "Branch Manager", "Team Leader"}:
        _grants.append("location.read")
    if _role in {"Administrator", "Operations Manager"}:
        _grants.append("location.manage")
