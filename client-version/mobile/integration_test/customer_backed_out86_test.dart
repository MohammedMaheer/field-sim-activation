import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relay_agent/main.dart' as app;
import 'package:relay_agent/services.dart';

// This test writes one synthetic no-sale outcome in the disposable QA backend.
// A loopback API_URL and matching TEST_API_URL are mandatory; never use the
// public deployment. The normal APK must be restored after the test build.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'physical customer backed out closes draft and preserves no-sale outcome',
    (tester) async {
      const expectedApi = String.fromEnvironment('TEST_API_URL');
      const password = String.fromEnvironment('TEST_PASSWORD');
      expect(
        expectedApi,
        isNotEmpty,
        reason: 'Set TEST_API_URL for the isolated QA backend.',
      );
      expect(apiUrl, expectedApi);
      expect(Uri.parse(expectedApi).host, anyOf('127.0.0.1', 'localhost'));
      expect(
        password,
        isNotEmpty,
        reason: 'Set the isolated QA TEST_PASSWORD.',
      );

      Future<void> wait(Finder finder) async {
        for (var attempt = 0; attempt < 200; attempt++) {
          await tester.pump(const Duration(milliseconds: 200));
          expect(
            tester.takeException(),
            isNull,
            reason: '$finder while loading',
          );
          if (finder.evaluate().isNotEmpty) {
            await tester.pump(const Duration(milliseconds: 400));
            return;
          }
        }
        throw TestFailure('Missing $finder');
      }

      Future<void> reveal(Finder finder) async {
        if (finder.evaluate().isNotEmpty) {
          await tester.ensureVisible(finder);
        } else {
          await tester.scrollUntilVisible(
            finder,
            250,
            scrollable: find.byType(Scrollable).first,
            maxScrolls: 35,
          );
        }
        await tester.pump(const Duration(milliseconds: 300));
      }

      Future<void> shot(String name) async {
        await tester.pump(const Duration(milliseconds: 400));
        expect(tester.takeException(), isNull, reason: name);
        // The host runner captures the real display with adb. This works even
        // when the optional integration-test screenshot plugin is unavailable.
        debugPrint('CUSTOMER_BACKED_OUT86_SCREENSHOT_REQUEST: $name');
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 3)),
        );
      }

      app.main();
      await wait(find.byType(app.Gate));
      final service = ProviderScope.containerOf(
        tester.element(find.byType(app.Gate)),
      ).read(serviceProvider);
      for (var attempt = 0; attempt < 200 && !service.ready; attempt++) {
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(service.ready, isTrue);
      if (service.user != null) await tester.runAsync(service.logout);
      app.router.go('/');
      await wait(find.text('Sign in to Qanawat'));

      await tester.enterText(
        find.widgetWithText(TextField, 'Work email'),
        'agent1@relay.demo',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Password'),
        password,
      );
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tap(find.text('Sign in to Qanawat'));
      await wait(find.text('Your day, at a glance'));
      expect(service.user?['role'], 'Field Agent');
      expect(service.user?['agent_id'], isNotNull);
      service.timer?.cancel();

      final customerName =
          'QA86 Phone customer ${DateTime.now().microsecondsSinceEpoch}';
      final note = '$customerName: customer needs more time.';
      Set<String> capturesBefore = {}, salesBefore = {};
      await tester.runAsync(() async {
        capturesBefore = ((await service.dio.get('/kyc-captures')).data as List)
            .map((row) => row['id'].toString())
            .toSet();
        salesBefore =
            ((await service.dio.get('/sales-management/sales')).data as List)
                .map((row) => row['id'].toString())
                .toSet();
      });

      try {
        await reveal(find.text('Start transaction'));
        await tester.tap(find.text('Start transaction'));
        await wait(find.text('New transaction'));
        final name = find.widgetWithText(TextFormField, 'Full name');
        await reveal(name);
        expect(tester.widget<TextFormField>(name).initialValue, isEmpty);
        await tester.enterText(name, customerName);
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pump(const Duration(milliseconds: 400));
        await tester.tap(find.byTooltip('Transaction options'));
        await wait(find.text('Customer backed out'));
        await tester.tap(find.text('Customer backed out'));
        await wait(find.text('Customer backed out?'));
        await shot('confirmation');
        await tester.enterText(
          find.widgetWithText(TextField, 'Note · optional'),
          note,
        );
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pump(const Duration(milliseconds: 400));
        await reveal(find.text('Record customer backed out'));
        await tester.tap(find.text('Record customer backed out'));
        await wait(find.text('Sales management'));
        expect(
          app.router.routeInformationProvider.value.uri.queryParameters['tab'],
          'feedback',
        );
        await wait(find.text(customerName));
        expect(find.text(note), findsOneWidget);
        await shot('saved-feedback');

        await tester.runAsync(() async {
          final feedback =
              ((await service.dio.get('/sales-management/feedback')).data
                      as List)
                  .where((row) => row['customer_name'] == customerName)
                  .toList();
          expect(feedback, hasLength(1));
          expect(feedback.single['agent_id'], service.user!['agent_id']);
          expect(feedback.single['rejection_reason'], 'Customer backed out');
          expect(feedback.single['feedback'], note);
          expect(feedback.single['product_suggested'], 'Not recorded');
          final capturesAfter =
              ((await service.dio.get('/kyc-captures')).data as List)
                  .map((row) => row['id'].toString())
                  .toSet();
          final salesAfter =
              ((await service.dio.get('/sales-management/sales')).data as List)
                  .map((row) => row['id'].toString())
                  .toSet();
          expect(capturesAfter, capturesBefore);
          expect(salesAfter, salesBefore);
          expect(
            await service.store.get('intake-${service.user!['id']}'),
            isNull,
          );
          expect(
            await service.store.get('kyc-draft-${service.user!['id']}'),
            isNull,
          );
        });

        app.router.go('/');
        await wait(find.text('Your day, at a glance'));
        await reveal(find.text('Start transaction'));
        await tester.tap(find.text('Start transaction'));
        await wait(find.text('New transaction'));
        await reveal(name);
        expect(tester.widget<TextFormField>(name).initialValue, isEmpty);
        expect(find.text(customerName), findsNothing);
        await shot('fresh-transaction');
        app.router.go('/');
        await wait(find.text('Your day, at a glance'));
      } finally {
        await tester.runAsync(service.logout);
        service.timer?.cancel();
        app.router.go('/');
        await wait(find.text('Sign in to Qanawat'));
      }
      expect(service.user, isNull);
      debugPrint('CUSTOMER_BACKED_OUT86_PHYSICAL_COMPLETE');
    },
    timeout: const Timeout(Duration(minutes: 6)),
  );
}
