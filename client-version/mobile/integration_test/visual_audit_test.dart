import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relay_agent/main.dart' as app;
import 'package:relay_agent/services.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'all mobile screens and record details render on the connected phone',
    (t) async {
      Future<void> wait(Finder finder) async {
        for (var i = 0; i < 150; i++) {
          await t.pump(const Duration(milliseconds: 200));
          if (finder.evaluate().isNotEmpty) return;
        }
        throw TestFailure('Missing $finder');
      }

      Future<void> shot(String name) async {
        await t.pump(const Duration(seconds: 2));
        expect(t.takeException(), isNull);
        await binding.takeScreenshot('visual-$name');
      }

      app.main();
      await wait(find.byType(app.Gate));
      final s = ProviderScope.containerOf(
        t.element(find.byType(app.Gate)),
      ).read(serviceProvider);
      for (var i = 0; i < 150 && !s.ready; i++) {
        await t.pump(const Duration(milliseconds: 200));
      }
      if (s.user != null) await s.logout();
      await wait(find.text('Sign in to Relay'));
      await binding.convertFlutterSurfaceToImage();
      await t.pump();
      await shot('login');
      await t.runAsync(
        () => s.login(
          'agent1@relay.demo',
          const String.fromEnvironment('TEST_PASSWORD'),
        ),
      );
      await wait(find.text('Your day, at a glance'));
      await shot('home');
      await t.drag(find.byType(Scrollable).first, const Offset(0, -650));
      await shot('home-lower');
      for (final tab in ['Tasks', 'Stock', 'Profile']) {
        await t.tap(find.text(tab).last);
        await t.pump(const Duration(seconds: 2));
        await shot(tab.toLowerCase());
      }
      // Review primary and secondary pages through the real router.
      for (final path in [
        '/records',
        '/ekyc',
        '/incentives',
        '/customers',
        '/reports',
        '/support',
        '/tasks',
      ]) {
        app.router.push(path);
        await t.pump(const Duration(seconds: 3));
        await shot(path.substring(1));
        if (path == '/customers' || path == '/incentives') {
          final tile = find.byType(ListTile).first;
          await wait(tile);
          await t.tap(tile);
          await wait(find.byTooltip('Close details'));
          await shot('${path.substring(1)}-details');
          await t.tap(find.byTooltip('Close details'));
          await t.pump(const Duration(milliseconds: 400));
        }
        if (path == '/support') {
          await t.drag(find.byType(Scrollable).first, const Offset(0, -650));
          await shot('support-history');
          if (find.byType(ListTile).evaluate().isNotEmpty) {
            await Scrollable.ensureVisible(
              t.element(find.byType(ListTile).first),
              alignment: .5,
            );
            await t.pumpAndSettle();
            await t.tap(find.byType(ListTile).first);
            await wait(find.byTooltip('Close details'));
            await shot('support-details');
            await t.tap(find.byTooltip('Close details'));
            await t.pump(const Duration(milliseconds: 400));
          }
        }
        app.router.pop();
        await t.pump(const Duration(milliseconds: 500));
      }
      s.timer?.cancel();
    },
  );
}
