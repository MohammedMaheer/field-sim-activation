import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/role_access.dart';

void main() {
  test('administrators retain review visibility but cannot capture sales', () {
    final user = {
      'role': 'Administrator',
      'permissions': ['read', 'ekyc.write', 'compliance.write'],
    };
    for (final path in ['/ekyc', '/screenshot-capture', '/drafts']) {
      expect(canVisitMobilePage(path, user), isFalse, reason: path);
    }
    for (final path in [
      '/transactions',
      '/transaction/example',
      '/sales-management',
      '/reports',
      '/notifications',
    ]) {
      expect(canVisitMobilePage(path, user), isTrue, reason: path);
    }
  });
  test('compliance mobile routes match its web workspace', () {
    final user = {
      'role': 'Compliance Officer',
      'permissions': ['read', 'compliance.write'],
    };
    for (final path in ['/stock', '/assets', '/support', '/incentives']) {
      expect(canVisitMobilePage(path, user), isFalse);
    }
    for (final path in [
      '/notifications',
      '/transaction/123',
      '/sales-management',
      '/call-work',
    ]) {
      expect(canVisitMobilePage(path, user), isTrue);
    }
  });
  test('direct navigation denies signed-out and unknown roles', () {
    expect(canVisitMobilePage('/transactions', null), isFalse);
    expect(
      canVisitMobilePage('/notifications', {
        'role': 'Unknown',
        'permissions': ['read'],
      }),
      isFalse,
    );
  });
  test(
    'notification inbox requires an effective read grant, not a role or write grant',
    () {
      for (final role in [
        'Tele Verification Officer',
        'Welcome Call Officer',
        'Field Agent',
        'Administrator',
      ]) {
        expect(
          canVisitMobilePage('/notifications', {
            'role': role,
            'permissions': ['call.tele.write', 'call.welcome.write'],
          }),
          isFalse,
          reason: role,
        );
        expect(
          canVisitMobilePage('/call-work', {
            'role': role,
            'permissions': ['call.tele.write', 'call.welcome.write'],
          }),
          isFalse,
          reason: '$role cannot read calling queues using only a write grant',
        );
        for (final permission in [
          'read',
          'call.tele.read',
          'call.welcome.read',
        ]) {
          expect(
            canVisitMobilePage('/notifications', {
              'role': role,
              'permissions': [permission],
            }),
            isTrue,
            reason: '$role $permission',
          );
        }
      }
    },
  );
  test('leaders can read confirmations but cannot open capture or drafts', () {
    final user = {
      'role': 'Team Leader',
      'permissions': ['read', 'ekyc.write'],
    };
    expect(canVisitMobilePage('/transaction/123', user), isTrue);
    for (final path in [
      '/ekyc',
      '/screenshot-capture',
      '/drafts',
      '/call-work',
    ]) {
      expect(canVisitMobilePage(path, user), isFalse, reason: path);
    }
  });
  test(
    'call officers cannot navigate to general customer or transaction screens',
    () {
      for (final role in [
        'Tele Verification Officer',
        'Welcome Call Officer',
      ]) {
        final user = {
          'role': role,
          'permissions': [
            role == 'Tele Verification Officer'
                ? 'call.tele.read'
                : 'call.welcome.read',
          ],
        };
        expect(canVisitMobilePage('/call-work', user), isTrue);
        expect(canVisitMobilePage('/notifications', user), isTrue);
        for (final path in [
          '/customers',
          '/stock',
          '/sales-management',
          '/transaction/123',
        ]) {
          expect(
            canVisitMobilePage(path, user),
            isFalse,
            reason: '$role $path',
          );
        }
      }
    },
  );
  test(
    'capture needs both the role and permission; inventory has no evidence access',
    () {
      expect(
        canVisitMobilePage('/ekyc', {
          'role': 'Field Agent',
          'permissions': ['read', 'ekyc.write'],
        }),
        isTrue,
      );
      expect(
        canVisitMobilePage('/ekyc', {
          'role': 'Field Agent',
          'permissions': ['read'],
        }),
        isFalse,
      );
      expect(
        canVisitMobilePage('/transaction/123', {
          'role': 'Inventory Manager',
          'permissions': ['read'],
        }),
        isFalse,
      );
    },
  );
}
