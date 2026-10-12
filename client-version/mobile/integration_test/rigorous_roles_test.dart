import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relay_agent/main.dart' as app;
import 'package:relay_agent/services.dart';
import 'package:relay_agent/role_access.dart';

// This read-only harness targets the isolated QA clone. The expected URL is
// mandatory so a test build cannot silently use the default deployment.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'physical all-role routes, details and restricted controls',
    (tester) async {
      const expectedApi = String.fromEnvironment('TEST_API_URL');
      expect(
        expectedApi,
        isNotEmpty,
        reason: 'Set TEST_API_URL for the QA clone',
      );
      expect(apiUrl, expectedApi);
      expect(Uri.parse(expectedApi).host, anyOf('127.0.0.1', 'localhost'));
      const password = String.fromEnvironment('TEST_PASSWORD');
      expect(password, isNotEmpty);

      Future<void> wait(Finder finder) async {
        for (var i = 0; i < 200; i++) {
          await tester.pump(const Duration(milliseconds: 200));
          expect(
            tester.takeException(),
            isNull,
            reason: '$finder while loading',
          );
          if (finder.evaluate().isNotEmpty) return;
        }
        throw TestFailure('Missing $finder');
      }

      Future<void> shot(String name) async {
        for (var i = 0; i < 15; i++) {
          await tester.pump(const Duration(milliseconds: 200));
          expect(tester.takeException(), isNull, reason: name);
        }
        for (final notice in [
          'Could not load calls. Try again.',
          'Could not load assets. Try again.',
          'Could not load notifications. Retry',
          'Cannot reach the backend. Your saved screenshot remains on this device.',
          'Your session has expired. Please sign in again.',
        ]) {
          expect(find.text(notice), findsNothing, reason: name);
        }
        await binding.takeScreenshot('audit77-$name');
      }

      app.main();
      await wait(find.byType(app.Gate));
      final service = ProviderScope.containerOf(
        tester.element(find.byType(app.Gate)),
      ).read(serviceProvider);
      for (var i = 0; i < 200 && !service.ready; i++) {
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(service.ready, isTrue);
      if (service.user != null) await tester.runAsync(service.logout);
      await binding.convertFlutterSurfaceToImage();

      final catalog = await tester.runAsync(() async {
        final api = Dio(BaseOptions(baseUrl: expectedApi));
        try {
          return ((await api.get('/auth/mobile-demo/accounts')).data as List)
              .map((row) => Json.from(row))
              .toList();
        } finally {
          api.close();
        }
      });
      final accounts = <String, String>{};
      for (final role in knownRoles) {
        final matches = catalog!.where((account) => account['role'] == role);
        if (matches.isNotEmpty) accounts[role] = matches.first['email'];
      }
      const branchAccount = String.fromEnvironment(
        'TEST_BRANCH_ACCOUNT',
        defaultValue: 'cluster@relay.demo',
      );
      if (branchAccount.isNotEmpty) accounts['Branch Manager'] = branchAccount;
      if (catalog!.any((row) => row['email'] == 'agent1@relay.demo')) {
        accounts['Field Agent'] = 'agent1@relay.demo';
      }
      if (catalog.any((row) => row['email'] == 'leader@relay.demo')) {
        accounts['Team Leader'] = 'leader@relay.demo';
      }
      expect(
        accounts.keys.toSet(),
        knownRoles,
        reason: 'Every current role needs a QA account',
      );

      const pages = {
        '/sales-management': 'Sales management',
        '/transactions': 'Transactions',
        '/notifications': 'Notifications',
        '/call-work': 'Call work queue',
        '/stock': 'Inventory',
        '/customers': 'Customers',
        '/reports': 'Reports',
        '/incentives': 'My incentives',
        '/assets': 'Assets & supplies',
        '/support': 'Support',
        '/records': 'Historical activations',
        '/drafts': 'Drafts',
        '/screenshot-capture': 'New transaction',
      };
      const requestedRoles = String.fromEnvironment('TEST_ROLES');
      final selectedRoles = requestedRoles.isEmpty
          ? knownRoles
          : requestedRoles.split(',').toSet();
      expect(selectedRoles.every(knownRoles.contains), isTrue);
      for (final role in knownRoles.where(selectedRoles.contains)) {
        final name = role.toLowerCase().replaceAll(' ', '-');
        debugPrint('AUDIT77_ROLE_START: $role');
        app.router.go('/');
        await wait(find.text('Sign in to Qanawat'));
        await tester.runAsync(() => service.login(accounts[role]!, password));
        expect(service.user?['role'], role);
        service.timer?.cancel();
        final homeTitle = switch (role) {
          'Field Agent' => 'Your day, at a glance',
          'Team Leader' => 'Branch updates',
          'Inventory Manager' => 'Inventory',
          'Tele Verification Officer' ||
          'Welcome Call Officer' => 'Call work queue',
          _ => 'Sales management',
        };
        await wait(find.text(homeTitle));
        await shot('$name-home');
        if (role == 'Administrator' || role == 'Team Leader') {
          expect(find.text('Start transaction'), findsNothing);
          expect(
            canVisitMobilePage('/screenshot-capture', service.user),
            isFalse,
          );
          expect(canVisitMobilePage('/drafts', service.user), isFalse);
        }
        for (final page in pages.entries) {
          if (!canVisitMobilePage(page.key, service.user)) continue;
          debugPrint('AUDIT77_PAGE: $role ${page.key}');
          app.router.push(page.key);
          await wait(find.text(page.value));
          await shot('$name-${page.key.substring(1)}');
          if (page.key == '/sales-management') {
            for (final tab in ['Feedback', 'Targets']) {
              await tester.tap(find.text(tab));
              await shot('$name-sales-${tab.toLowerCase()}');
            }
            final canSet =
                [
                  'Administrator',
                  'Operations Manager',
                  'Team Leader',
                ].contains(role) &&
                (service.user?['permissions'] as List).contains('task.write');
            expect(
              find.text('Set target'),
              canSet ? findsOneWidget : findsNothing,
            );
          }
          if (page.key == '/incentives' &&
              [
                'Administrator',
                'Operations Manager',
                'Sales Manager',
                'Team Leader',
                'Field Agent',
              ].contains(role)) {
            for (final tab in ['Rate tables', 'History']) {
              await tester.tap(find.text(tab));
              await shot(
                '$name-incentives-${tab.toLowerCase().replaceAll(' ', '-')}',
              );
            }
          }
          if (page.key == '/call-work' &&
              find.text('Record call').evaluate().isNotEmpty) {
            await tester.tap(find.text('Record call').first);
            await wait(find.text('Save outcome'));
            await shot('$name-call-outcome');
            await tester.tap(find.text('Cancel').last);
          }
          if (page.key == '/customers' &&
              find.byType(ListTile).evaluate().isNotEmpty) {
            await tester.tap(find.byType(ListTile).first);
            await shot('$name-customer-details');
            await tester.scrollUntilVisible(
              find.widgetWithText(TextButton, 'Close'),
              220,
              scrollable: find.byType(Scrollable).last,
              maxScrolls: 60,
            );
            await shot('$name-customer-history');
            await tester.tap(find.widgetWithText(TextButton, 'Close'));
          }
          if ([
                '/stock',
                '/support',
                '/assets',
                '/notifications',
              ].contains(page.key) &&
              find.byType(Scrollable).evaluate().isNotEmpty) {
            await tester.drag(
              find.byType(Scrollable).first,
              const Offset(0, -550),
            );
            await shot('$name-${page.key.substring(1)}-lower');
          }
          app.router.pop();
          await tester.pump(const Duration(milliseconds: 400));
        }
        if (!canVisitMobilePage('/screenshot-capture', service.user)) {
          app.router.go('/screenshot-capture');
          await wait(find.text(homeTitle));
          expect(app.router.routeInformationProvider.value.uri.path, '/');
          expect(find.text('Scan details'), findsNothing);
        }
        await tester.runAsync(service.logout);
        app.router.go('/');
        await wait(find.text('Sign in to Qanawat'));
        debugPrint('AUDIT77_ROLE_COMPLETE: $role');
      }
      service.timer?.cancel();
    },
    timeout: const Timeout(Duration(minutes: 20)),
  );
}
