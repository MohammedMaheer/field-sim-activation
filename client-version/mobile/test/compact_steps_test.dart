import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/scan_surface.dart';
import 'package:relay_agent/transaction_journey.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final font = FontLoader('DM Sans')
      ..addFont(rootBundle.load('assets/fonts/dmsans.ttf'));
    await font.load();
  });

  testWidgets('empty preview scanner fits at 390px without clipping labels', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    for (final document in [
      'Customer details',
      'Order details',
      'Emirates ID',
    ]) {
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(fontFamily: 'DM Sans'),
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: ScanSurface(document: document),
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));
      expect(tester.takeException(), isNull);
      final frame = tester.getRect(find.byType(ScanSurface));
      final ready = tester.getRect(find.text('Ready to capture'));
      final guidance = tester.getRect(find.text('Position document'));
      for (final text in [
        document.toUpperCase(),
        'Identity document',
        'Ready to capture',
        'Position document',
      ]) {
        final bounds = tester.getRect(find.text(text));
        expect(bounds.left, greaterThanOrEqualTo(frame.left));
        expect(bounds.right, lessThanOrEqualTo(frame.right));
        expect(bounds.top, greaterThanOrEqualTo(frame.top));
        expect(bounds.bottom, lessThanOrEqualTo(frame.bottom));
      }
      expect(ready.bottom, lessThan(guidance.top));
      expect(frame.height, lessThan(160));
    }
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('captured document collapses and remains inspectable', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: ScanSurface(image: 'captured', illustration: true),
        ),
      ),
    );
    expect(tester.getSize(find.byType(ScanSurface)).height, lessThan(80));
    await tester.tap(find.text('View'));
    await tester.pump();
    expect(tester.getSize(find.byType(ScanSurface)).height, greaterThan(200));
    await tester.tap(find.byTooltip('Collapse document preview'));
    await tester.pump();
    expect(tester.getSize(find.byType(ScanSurface)).height, lessThan(80));
    expect(tester.takeException(), isNull);
  });

  testWidgets('compact signature pad fits a narrow phone', (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SignaturePad(height: 120, value: const [], onChanged: (_) {}),
        ),
      ),
    );
    expect(tester.getSize(find.byType(SignaturePad)).height, 120);
    expect(tester.takeException(), isNull);
  });
}
