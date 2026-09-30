import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relay_agent/main.dart' as app;
import 'package:relay_agent/services.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('physical agent, leader and dedicated call-role screens', (tester) async {
    Future<void> wait(Finder finder) async {
      for (var i = 0; i < 200; i++) {
        await tester.pump(const Duration(milliseconds: 200));
        if (finder.evaluate().isNotEmpty) return;
      }
      throw TestFailure('Missing $finder');
    }
    Future<void> shot(String name) async {
      await tester.pump(const Duration(seconds: 2));
      expect(tester.takeException(), isNull);
      await binding.takeScreenshot('rigorous-$name');
    }

    expect(apiUrl, 'http://127.0.0.1:8312/api');
    app.main();
    await wait(find.byType(app.Gate));
    final service = ProviderScope.containerOf(tester.element(find.byType(app.Gate))).read(serviceProvider);
    for (var i = 0; i < 200 && !service.ready; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    if (service.user != null) await tester.runAsync(service.logout);
    await binding.convertFlutterSurfaceToImage();
    for (final account in ['agent1', 'leader', 'tele', 'welcome']) {
      app.router.go('/');
      await wait(find.text('Sign in to Relay'));
      await tester.runAsync(() => service.login('$account@relay.demo', const String.fromEnvironment('TEST_PASSWORD')));
      if (account == 'tele' || account == 'welcome') {
        await wait(find.text('Call work queue'));
        await wait(find.byTooltip('Refresh'));
        await shot('$account-queue');
        if (find.text('Record call').evaluate().isNotEmpty) {
          await tester.tap(find.text('Record call').first);
          await wait(find.text('Save outcome'));
          await shot('$account-outcome');
          await tester.tap(find.text('Cancel').last);
        }
      } else {
        await wait(find.text(account == 'leader' ? 'Branch updates' : 'Your day, at a glance'));
        await shot('$account-home');
        for (final path in ['/records', '/stock', '/sales-management', '/assets', '/transactions', '/drafts', '/support', '/reports']) {
          app.router.push(path);
          await tester.pump(const Duration(seconds: 3));
          await shot('$account-${path.substring(1)}');
          app.router.pop();
          await tester.pump(const Duration(milliseconds: 300));
        }
        if (account == 'agent1') {
          app.router.push('/screenshot-capture');
          await wait(find.text('Scan details'));
          await shot('native-customer-capture');
          app.router.pop();
        }
      }
      await tester.runAsync(service.logout);
      app.router.go('/');
      await tester.pump(const Duration(milliseconds: 500));
    }
    service.timer?.cancel();
  });
}
