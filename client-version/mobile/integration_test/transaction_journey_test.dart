import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relay_agent/main.dart' as app;
import 'package:relay_agent/services.dart';
import 'package:relay_agent/transaction_journey.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('phone: ID and passport journeys, recovery and scoped stock', (
    t,
  ) async {
    Future<void> wait(Finder f) async {
      for (var i = 0; i < 300; i++) {
        await t.pump(const Duration(milliseconds: 250));
        if (f.evaluate().isNotEmpty) return;
      }
      throw TestFailure('Missing $f');
    }

    Future<void> reveal(Finder f) async {
      if (f.evaluate().isNotEmpty) {
        await t.ensureVisible(f.last);
      } else {
        await t.scrollUntilVisible(
          f,
          350,
          scrollable: find.byType(Scrollable).first,
          maxScrolls: 60,
        );
      }
      await t.pump(const Duration(milliseconds: 350));
    }

    Future<void> tap(String text) async {
      final f = find.text(text);
      await reveal(f);
      await t.tap(f.last);
      await t.pump(const Duration(milliseconds: 500));
    }

    Future<void> idle() async {
      for (var i = 0; i < 300; i++) {
        await t.pump(const Duration(milliseconds: 250));
        if (find.byType(LinearProgressIndicator).evaluate().isEmpty) return;
      }
      throw TestFailure('Operation did not finish');
    }

    Future<void> shot(String name) async {
      await t.pump(const Duration(milliseconds: 500));
      expect(t.takeException(), isNull);
      await binding.takeScreenshot('journey-$name');
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
    await s.login(
      'agent1@relay.demo',
      const String.fromEnvironment('TEST_PASSWORD'),
    );
    await wait(find.text('Your day, at a glance'));
    await binding.convertFlutterSurfaceToImage();
    await t.pump();
    final key = 'transaction-journey-${s.user!['id']}';
    for (final kind in ['National ID', 'Passport']) {
      await s.store.remove(key);
      app.router.push('/ekyc');
      await wait(find.text('Verify the customer'));
      await idle();
      await tap(kind);
      await tap('Use synthetic sample');
      await idle();
      await reveal(find.text('Full legal name'));
      expect(
        t.widget<TextField>(find.byType(TextField).first).controller!.text,
        'Jordan Demo',
      );
      await shot('$kind-ocr');
      await tap('Save reviewed details');
      await idle();
      await tap('Open demo selfie check');
      await t.tap(find.text('Test failed check'));
      await idle();
      await reveal(find.text('Continue to SIM & plan'));
      expect(
        t
            .widget<FilledButton>(
              find.ancestor(
                of: find.text('Continue to SIM & plan'),
                matching: find.byType(FilledButton),
              ),
            )
            .onPressed,
        isNull,
      );
      await tap('Open demo selfie check');
      await t.tap(find.text('Run passing demo check'));
      await idle();
      await reveal(find.text('Continue to SIM & plan'));
      await shot('$kind-identity-passed');
      await tap('Continue to SIM & plan');
      await wait(find.text('Allocate SIM & plan'));
      if (kind == 'Passport') await tap('Digital eSIM');
      final catalog = (await s.dio.get(
        '/transactions/catalog',
        queryParameters: {'agent_id': s.user!['agent_id']},
      )).data;
      final sims = (catalog['sims'] as List)
          .where(
            (r) => r['sim_type'] == (kind == 'Passport' ? 'eSIM' : 'Physical'),
          )
          .toList();
      expect(sims, isNotEmpty);
      await reveal(find.byType(DropdownButtonFormField<String>));
      await t.tap(find.byType(DropdownButtonFormField<String>));
      await t.pumpAndSettle();
      await t.tap(find.text(sims.first['iccid']).last);
      await t.pumpAndSettle();
      await tap(catalog['plans'][0]['name']);
      await reveal(find.byType(SignaturePad));
      final box = t.getRect(find.byType(SignaturePad));
      final g = await t.startGesture(box.topLeft + const Offset(25, 45));
      for (var i = 1; i <= 20; i++) {
        await g.moveTo(box.topLeft + Offset(25 + i * 8, 45 + (i % 6) * 12));
        await t.pump(const Duration(milliseconds: 25));
      }
      await g.up();
      await shot('$kind-signature');
      expect(
        t
            .widget<SignaturePad>(find.byType(SignaturePad))
            .value
            .expand((s) => s)
            .length,
        greaterThanOrEqualTo(8),
      );
      await reveal(find.text('Save allocation draft'));
      expect(
        t
            .widget<OutlinedButton>(
              find.ancestor(
                of: find.text('Save allocation draft'),
                matching: find.byType(OutlinedButton),
              ),
            )
            .onPressed,
        isNotNull,
      );
      await tap('Save allocation draft');
      await idle();
      final saved = await s.store.get(key);
      expect(saved?['id'], isNotNull);
      final allocated = (await s.dio.get('/transactions/${saved!['id']}')).data;
      expect(allocated['data']['allocated'], true);
      expect(allocated['sim_id'], isNotNull);
      app.router.pop();
      await t.pump(const Duration(milliseconds: 500));
      app.router.push('/ekyc');
      await wait(find.text('Allocate SIM & plan'));
      await idle();
      await shot('$kind-restored');
      await tap('Dispatch demo activation');
      await wait(find.text('Demo activation successful'));
      await shot('$kind-success');
      final receipt = await s.dio.get<List<int>>(
        '/transactions/${saved['id']}/receipt',
        options: Options(responseType: ResponseType.bytes),
      );
      expect(receipt.data!.take(4), [37, 80, 68, 70]);
      await tap('Simulate SMS dispatch');
      await idle();
      final result = (await s.dio.get('/transactions/${saved['id']}')).data;
      expect(result['status'], 'ACTIVATED');
      await tap('Done · return to dashboard');
      await wait(find.text('Your day, at a glance'));
    }
    await s.list('inventory');
    final base = s.dio.options.baseUrl;
    s.dio.options.baseUrl = 'http://127.0.0.1:1/api';
    expect(await s.list('inventory'), isNotEmpty);
    expect(s.online, isFalse);
    await s.sync();
    expect(s.syncError, isNotNull);
    s.dio.options.baseUrl = base;
    await s.sync();
    expect(s.online, isTrue);
    expect(s.syncError, isNull);
    expect((await s.list('agents')).length, 1);
    s.timer?.cancel();
    await shot('recovered-home');
  });
}
