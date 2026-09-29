import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as imaging;
import 'package:relay_agent/customer_intake.dart';
import 'package:relay_agent/preview_main.dart';
import 'package:relay_agent/services.dart';
import 'package:relay_agent/transaction_journey.dart' show SignaturePad;

void main() {
  testWidgets('camera recovery fits a narrow scanner and retries', (t) async {
    var retries = 0;
    await t.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 280,
              height: 190,
              child: CameraUnavailable(
                message: 'Camera unavailable',
                onRetry: () => retries++,
              ),
            ),
          ),
        ),
      ),
    );
    expect(find.text('Camera unavailable'), findsOneWidget);
    expect(t.takeException(), isNull);
    await t.tap(find.text('Try again'));
    expect(retries, 1);
  });
  test('automatic scan ignores a dark empty camera frame', () {
    final dark = imaging.fill(
      imaging.Image(width: 100, height: 60),
      color: imaging.ColorRgb8(28, 32, 40),
    );
    final document = imaging.fill(
      imaging.Image(width: 100, height: 60),
      color: imaging.ColorRgb8(238, 242, 248),
    );
    expect(
      looksLikeDocument(Uint8List.fromList(imaging.encodeJpg(dark))),
      isFalse,
    );
    expect(
      looksLikeDocument(Uint8List.fromList(imaging.encodeJpg(document))),
      isTrue,
    );
  });
  testWidgets('photo action stays on one line on a narrow phone', (t) async {
    t.view.physicalSize = const Size(320, 700);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.resetPhysicalSize);
    addTearDown(t.view.resetDevicePixelRatio);
    final service = PreviewService(
      jsonDecode(File('assets/demo/workspace.json').readAsStringSync()),
    );
    await t.pumpWidget(
      ProviderScope(
        overrides: [serviceProvider.overrideWith((ref) => service)],
        child: MaterialApp(
          home: CustomerIntakeScreen(
            initial: const {},
            onReady: (_) {},
            onHistory: () {},
          ),
        ),
      ),
    );
    await t.pump(const Duration(seconds: 1));
    final label = find.text('Upload photo');
    expect(label, findsOneWidget);
    expect(t.getSize(label).height, lessThan(25));
    final camera = find.byType(IntakeCamera);
    expect(camera, findsOneWidget);
    expect(t.widget<IntakeCamera>(camera).embedded, isTrue);
    expect(find.text('Capture photo'), findsNothing);
    await t.tap(find.byIcon(Icons.fullscreen));
    await t.pump();
    await t.pump(const Duration(milliseconds: 400));
    expect(find.byType(IntakeCamera, skipOffstage: false), findsOneWidget);
    expect(find.text('Capture photo'), findsOneWidget);
    await t.tap(find.byIcon(Icons.arrow_back));
    await t.pump();
    await t.pump(const Duration(seconds: 1));
    await t.pump();
    expect(find.text('Capture photo'), findsNothing);
  });

  testWidgets('signature sheet exposes reset and confirm actions', (t) async {
    t.view.physicalSize = const Size(390, 844);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.resetPhysicalSize);
    addTearDown(t.view.resetDevicePixelRatio);
    final service = PreviewService(
      jsonDecode(File('assets/demo/workspace.json').readAsStringSync()),
    );
    await t.pumpWidget(
      ProviderScope(
        overrides: [serviceProvider.overrideWith((ref) => service)],
        child: MaterialApp(
          home: CustomerIntakeScreen(
            initial: const {
              'step': 1,
              'document_check': 'preview-only-document',
            },
            onReady: (_) {},
            onHistory: () {},
          ),
        ),
      ),
    );
    await t.pump(const Duration(seconds: 1));
    await t.ensureVisible(find.text('Add customer signature'));
    await t.tap(find.text('Add customer signature'));
    await t.pumpAndSettle();
    expect(find.text('Reset'), findsOneWidget);
    expect(find.text('Confirm'), findsOneWidget);
    expect(
      t
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Confirm'))
          .onPressed,
      isNull,
    );
    await t.drag(find.byType(SignaturePad), const Offset(70, 30));
    await t.pump();
    await t.tap(find.text('Reset'));
    await t.pump();
    expect(
      t
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Confirm'))
          .onPressed,
      isNull,
    );
    await t.drag(find.byType(SignaturePad), const Offset(70, 30));
    await t.pump();
    await t.tap(find.text('Confirm'));
    await t.pump();
    expect(find.text('Signature saved · Edit'), findsOneWidget);
    expect(t.takeException(), isNull);
  });
}
