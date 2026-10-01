import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/role_access.dart';

void main() {
  test('direct navigation denies signed-out and unknown roles', () {
    expect(canVisitMobilePage('/transactions', null), isFalse);
    expect(canVisitMobilePage('/notifications', {'role': 'Unknown', 'permissions': ['read']}), isFalse);
  });
  test('leaders can read confirmations but cannot open capture or drafts', () {
    final user = {'role': 'Team Leader', 'permissions': ['read', 'ekyc.write']};
    expect(canVisitMobilePage('/transaction/123', user), isTrue);
    for (final path in ['/ekyc', '/screenshot-capture', '/drafts', '/call-work']) {
      expect(canVisitMobilePage(path, user), isFalse, reason: path);
    }
  });
  test('call officers cannot navigate to general customer or transaction screens', () {
    for (final role in ['Tele Verification Officer', 'Welcome Call Officer']) {
      final user = {'role': role, 'permissions': ['call.tele.read']};
      expect(canVisitMobilePage('/call-work', user), isTrue);
      expect(canVisitMobilePage('/notifications', user), isTrue);
      for (final path in ['/customers', '/stock', '/sales-management', '/transaction/123']) {
        expect(canVisitMobilePage(path, user), isFalse, reason: '$role $path');
      }
    }
  });
  test('capture needs both the role and permission; inventory has no evidence access', () {
    expect(canVisitMobilePage('/ekyc', {'role': 'Field Agent', 'permissions': ['read', 'ekyc.write']}), isTrue);
    expect(canVisitMobilePage('/ekyc', {'role': 'Field Agent', 'permissions': ['read']}), isFalse);
    expect(canVisitMobilePage('/transaction/123', {'role': 'Inventory Manager', 'permissions': ['read']}), isFalse);
  });
}
