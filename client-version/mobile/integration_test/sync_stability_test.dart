import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relay_agent/main.dart' as app;
import 'package:relay_agent/services.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'background synchronization never replaces home or stock with skeletons',
    (t) async {
      Future<void> wait(Finder finder) async {
        for (var i = 0; i < 150; i++) {
          await t.pump(const Duration(milliseconds: 200));
          if (finder.evaluate().isNotEmpty) return;
        }
        throw TestFailure('Missing $finder');
      }

      app.main();
      await wait(find.byType(app.Gate));
      final s = ProviderScope.containerOf(
        t.element(find.byType(app.Gate)),
      ).read(serviceProvider);
      for (var i = 0; i < 150 && !s.ready; i++) {
        await t.pump(const Duration(milliseconds: 200));
      }
      if (s.user == null) {
        await t.runAsync(
          () => s.login(
            'agent1@relay.demo',
            const String.fromEnvironment('TEST_PASSWORD'),
          ),
        );
      }
      await wait(find.text('Your day, at a glance'));
      await binding.convertFlutterSurfaceToImage();
      for (final screen in ['Home', 'Stock']) {
        if (screen == 'Stock') {
          await t.tap(find.text('Stock').last);
          await wait(find.text('My SIM stock'));
        }
        await t.pump(const Duration(milliseconds: 500));
        // Observe real scheduled sync over more than one 20-second interval.
        for (var i = 0; i < 225; i++) {
          await t.pump(const Duration(milliseconds: 200));
          expect(
            find.byType(app.LoadingCards),
            findsNothing,
            reason: 'No skeleton flash on $screen at $i',
          );
          expect(t.takeException(), isNull);
        }
        await binding.takeScreenshot('sync-stable-${screen.toLowerCase()}');
      }
    },
  );
}
