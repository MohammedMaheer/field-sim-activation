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
    expect(find.byType(IntakeCamera), findsNothing);
    expect(find.text('Ready to capture'), findsOneWidget);
    expect(find.text('Camera unavailable'), findsNothing);
    expect(find.text('Capture photo'), findsNothing);
  });

  testWidgets(
    'order capture replaces barcode and signature in the second step',
    (t) async {
      t.view.physicalSize = const Size(320, 640);
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
      expect(find.text('Scan order'), findsOneWidget);
      expect(find.text('Upload photo'), findsOneWidget);
      expect(find.text('Add customer signature'), findsNothing);
      expect(find.byTooltip('Scan SIM barcode'), findsNothing);
      await t.tap(find.text('Continue'));
      await t.pump(const Duration(milliseconds: 400));
      expect(find.textContaining('order details screen'), findsOneWidget);
      expect(t.takeException(), isNull);
    },
  );
}
