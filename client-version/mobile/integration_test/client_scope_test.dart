import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relay_agent/main.dart' as app;
import 'package:relay_agent/services.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  Future<void> wait(WidgetTester t, Finder f) async {
    for (var i = 0; i < 150; i++) {
      await t.pump(const Duration(milliseconds: 200));
      if (f.evaluate().isNotEmpty) return;
    }
    throw TestFailure('Missing $f');
  }

  Future<void> tap(WidgetTester t, String text) async {
    await wait(t, find.text(text));
    final f = find.text(text).last;
    await t.ensureVisible(f);
    await wait(t, f.hitTestable());
    await t.tap(f);
    await t.pump(const Duration(milliseconds: 400));
  }

  testWidgets(
    'client edition: scoped records, eKYC, stock and sync without sales flows',
    (t) async {
      app.main();
      await wait(t, find.byType(app.Gate));
      final service = ProviderScope.containerOf(
        t.element(find.byType(app.Gate)),
      ).read(serviceProvider);
      for (var i = 0; i < 150 && !service.ready; i++) {
        await t.pump(const Duration(milliseconds: 200));
      }
      if (service.user != null) await service.logout();
      await wait(t, find.text('Sign in to Relay'));
      await t.enterText(find.byType(TextField).first, 'agent1@relay.demo');
      await t.enterText(
        find.byType(TextField).at(1),
        const String.fromEnvironment('TEST_PASSWORD'),
      );
      await tap(t, 'Sign in to Relay');
      await wait(t, find.text('Your day, at a glance'));
      expect(find.text('New activation'), findsNothing);
      expect(find.text('Activate'), findsNothing);
      await binding.convertFlutterSurfaceToImage();
      await t.pump();
      await binding.takeScreenshot('client-home');
      await tap(t, 'Records');
      await wait(t, find.text('Activation records'));
      await tap(t, 'Stock');
      await wait(t, find.text('My SIM stock'));
      expect(find.text('Scan SIM barcode'), findsNothing);
      await binding.takeScreenshot('client-stock');
      await tap(t, 'eKYC');
      await wait(t, find.text('Run demo verification'));
      await t.enterText(find.byType(TextField).first, 'Client Phone Demo');
      await tap(t, 'Run demo verification');
      await wait(t, find.text('VERIFIED'));
      await binding.takeScreenshot('client-ekyc');
      FocusManager.instance.primaryFocus?.unfocus();
      await t.pump();
      await t.scrollUntilVisible(
        find.text('Back to home'),
        350,
        scrollable: find
            .descendant(
              of: find.byType(ListView).last,
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tap(t, 'Back to home');
      await tap(t, 'Profile');
      await wait(t, find.text('My workspace'));
      await service.sync();
      expect(service.syncError, isNull);
      service.timer?.cancel();
      final records = await service.list('activations');
      expect(records, isNotEmpty);
      final agents = await service.list('agents');
      expect(agents.length, 1);
      final original = service.dio.options.baseUrl;
      await service.list('inventory');
      service.dio.options.baseUrl = 'http://127.0.0.1:1/api';
      expect(await service.list('inventory'), isNotEmpty);
      expect(service.online, isFalse);
      service.online = true;
      await service.sync();
      expect(service.online, isFalse);
      expect(service.syncError, isNotNull);
      service.dio.options.baseUrl = original;
      await service.sync();
      expect(service.online, isTrue);
      expect(service.syncError, isNull);
      service.dio.options.baseUrl = 'http://127.0.0.1:1/api';
      service.online = true;
      await service.logout();
      expect(service.user, isNull);
      expect(await service.store.secure.read(key: 'relay_refresh'), isNull);
      service.dio.options.baseUrl = original;
      await wait(t, find.text('Sign in to Relay'));
    },
  );
}
