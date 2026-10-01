const knownRoles = {
  'Administrator', 'Operations Manager', 'Compliance Officer', 'Inventory Manager',
  'Field Agent', 'Team Leader', 'Branch Manager', 'Sales Manager',
  'Tele Verification Officer', 'Welcome Call Officer',
};

bool canVisitMobilePage(String path, Map<String, dynamic>? user) {
  if (path == '/') return true;
  if (user == null || !knownRoles.contains(user['role'])) return false;
  final role = user['role'];
  final permissions = (user['permissions'] as List? ?? []).cast<String>();
  if (path == '/notifications') return true;
  if (['Tele Verification Officer', 'Welcome Call Officer'].contains(role)) {
    return path == '/call-work';
  }
  if (role == 'Sales Manager') {
    return ['/sales-management', '/assets', '/reports'].contains(path);
  }
  if (role == 'Compliance Officer' && ['/assets', '/stock', '/incentives', '/support'].contains(path)) return false;
  if (path == '/call-work') return permissions.contains('compliance.write');
  if (['/ekyc', '/screenshot-capture', '/drafts'].contains(path)) {
    return ['Field Agent', 'Administrator', 'Operations Manager'].contains(role) &&
        permissions.contains('ekyc.write');
  }
  if (path == '/transactions' || path.startsWith('/transaction/')) {
    return ['Field Agent', 'Team Leader', 'Branch Manager', 'Administrator',
      'Operations Manager', 'Compliance Officer'].contains(role);
  }
  return ['/sales-management', '/assets', '/stock', '/records', '/incentives',
    '/customers', '/support', '/reports'].contains(path) && permissions.contains('read');
}
