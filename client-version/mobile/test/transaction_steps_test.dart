import 'dart:io';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:relay_agent/services.dart';
import 'package:relay_agent/transaction_journey.dart';
import 'visual_layout_test.dart' show VisualService;
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/transaction_steps.dart';

void main() {
  testWidgets(
    'three reference stages stay legible at narrow width and large text',
    (t) async {
      t.view.physicalSize = const Size(320, 500);
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.resetPhysicalSize);
      addTearDown(t.view.resetDevicePixelRatio);
      final loader = FontLoader('MaterialIcons')
        ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
      await loader.load();
      final textLoader = FontLoader('DM Sans')
        ..addFont(rootBundle.load('assets/fonts/dmsans.ttf'));
      await textLoader.load();
      final boundary = GlobalKey();
      for (var step = 1; step <= 3; step++) {
        await t.pumpWidget(
          MaterialApp(
            theme: ThemeData(fontFamily: 'DM Sans'),
            home: RepaintBoundary(
              key: boundary,
              child: Scaffold(
                backgroundColor: const Color(0xFFF0E5FF),
                body: MediaQuery(
                  data: const MediaQueryData(
                    textScaler: TextScaler.linear(1.5),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        const SizedBox(height: 40),
                        Text('STEP $step OF 3'),
                        const SizedBox(height: 20),
                        TransactionSteps(step: step),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        await t.pumpAndSettle();
        expect(find.byType(Icon), findsNWidgets(3));
        expect(
          find.byIcon(Icons.check_circle_outline),
          findsNWidgets(step - 1),
        );
        expect(find.byIcon(TransactionSteps.icons[step - 1]), findsOneWidget);
        expect(t.takeException(), isNull);
        if (const bool.fromEnvironment('VISUAL_EVIDENCE')) {
          final target =
              boundary.currentContext!.findRenderObject()!
                  as RenderRepaintBoundary;
          await t.runAsync(() async {
            final image = await target.toImage();
            final bytes = await image.toByteData(
              format: ui.ImageByteFormat.png,
            );
            final file = File(
              '../output/qa/transaction-icons/mobile-step-$step.png',
            );
            file.parent.createSync(recursive: true);
            file.writeAsBytesSync(bytes!.buffer.asUint8List());
            image.dispose();
          });
        }
      }
    },
  );

  testWidgets('signature gestures remain captured inside a scrolling form', (
    t,
  ) async {
    List<List<Offset>> strokes = [];
    await t.pumpWidget(
      MaterialApp(
        home: StatefulBuilder(
          builder: (c, set) => Scaffold(
            body: ListView(
              children: [
                const SizedBox(height: 650),
                SignaturePad(
                  value: strokes,
                  onChanged: (v) => set(() => strokes = v),
                ),
                const SizedBox(height: 400),
              ],
            ),
          ),
        ),
      ),
    );
    await t.scrollUntilVisible(find.byType(SignaturePad), 350);
    await t.ensureVisible(find.byType(SignaturePad));
    await t.pumpAndSettle();
    final box = t.getRect(find.byType(SignaturePad));
    final g = await t.startGesture(box.topLeft + const Offset(25, 45));
    for (var i = 1; i <= 20; i++) {
      await g.moveTo(box.topLeft + Offset(25 + i * 8, 45 + (i % 6) * 12));
      await t.pump(const Duration(milliseconds: 25));
    }
    await g.up();
    expect(strokes.expand((s) => s).length, greaterThanOrEqualTo(8));
  });

  testWidgets('identity completion has a gated, working next-stage action', (
    t,
  ) async {
    for (final verified in [false, true]) {
      final service = VisualService({
        '/transactions/demo': {
          'id': 'demo',
          'version': 1,
          'stage': 1,
          'status': 'DRAFT',
          'msisdn': 'DEMO-050-0001',
          'data': {
            'document_type': 'National Identity Card',
            'name': 'Jordan Demo',
            'ocr_lines': [],
            'identity_saved': true,
            'identity_verified': verified,
          },
        },
        '/transactions/catalog': {'sims': [], 'plans': [], 'numbers': []},
      });
      service.user = {'id': 'demo-user', 'agent_id': 'demo-agent'};
      await service.memoryStore.put('transaction-journey-demo-user', {
        'id': 'demo',
      });
      await t.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: const MaterialApp(home: TransactionScreen()),
        ),
      );
      await t.pumpAndSettle();
      final next = find.text('Continue to SIM & plan');
      await t.scrollUntilVisible(
        next,
        350,
        scrollable: find.byType(Scrollable).first,
      );
      final button = t.widget<FilledButton>(
        find.ancestor(
          of: next,
          matching: find.byWidgetPredicate((w) => w is FilledButton),
        ),
      );
      expect(button.onPressed != null, verified);
      if (verified) {
        await t.tap(next);
        await t.pumpAndSettle();
        expect(find.text('Allocate SIM & plan'), findsOneWidget);
      }
      expect(t.takeException(), isNull);
      await t.pumpWidget(const SizedBox());
    }
  });

  testWidgets('all three native transaction screens render without overflow', (
    t,
  ) async {
    t.view.physicalSize = const Size(390, 844);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.resetPhysicalSize);
    addTearDown(t.view.resetDevicePixelRatio);
    for (final entry in {
      'DM Sans': 'assets/fonts/dmsans.ttf',
      'MaterialIcons': 'fonts/MaterialIcons-Regular.otf',
    }.entries) {
      final loader = FontLoader(entry.key)
        ..addFont(rootBundle.load(entry.value));
      await loader.load();
    }
    for (var step = 1; step <= 3; step++) {
      final record = <String, dynamic>{
        'id': 'demo',
        'version': 1,
        'stage': step,
        'status': step == 3 ? 'ACTIVATED' : 'DRAFT',
        'msisdn': 'DEMO-050-0001',
        'reference': 'RLY-DEMO',
        'customer': 'Jordan Demo',
        'plan': 'Demo plan',
        'agent': 'Demo agent',
        'outlet': 'Demo branch',
        'receipt': {'total': '100', 'vat': '4.76'},
        'data': {
          'name': 'Jordan Demo',
          'document_type': 'National Identity Card',
          'iccid': 'DEMO-SIM-001',
        },
      };
      final service = VisualService({
        '/transactions/demo': record,
        '/transactions/catalog': {
          'sims': [],
          'plans': [],
          'numbers': ['DEMO-050-0001'],
        },
      });
      service.user = {
        'id': 'demo-user',
        'agent_id': 'demo-agent',
        'permissions': ['ekyc.write'],
      };
      await service.memoryStore.put('transaction-journey-demo-user', {
        'id': 'demo',
      });
      final boundary = GlobalKey();
      await t.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: MaterialApp(
            theme: ThemeData(
              fontFamily: 'DM Sans',
              colorScheme: ColorScheme.fromSeed(
                seedColor: const Color(0xFF713BB6),
              ),
            ),
            home: RepaintBoundary(
              key: boundary,
              child: const TransactionScreen(),
            ),
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(find.byType(TransactionSteps), findsOneWidget);
      expect(t.takeException(), isNull);
      if (const bool.fromEnvironment('VISUAL_EVIDENCE')) {
        final target =
            boundary.currentContext!.findRenderObject()!
                as RenderRepaintBoundary;
        await t.runAsync(() async {
          final image = await target.toImage();
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          final file = File(
            '../output/qa/transaction-icons/mobile-screen-$step.png',
          );
          file.parent.createSync(recursive: true);
          file.writeAsBytesSync(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }
      await t.drag(find.byType(Scrollable).first, const Offset(0, -1600));
      await t.pumpAndSettle();
      expect(t.takeException(), isNull);
      await t.pumpWidget(const SizedBox());
    }
  });
}
