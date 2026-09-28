import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/scan_surface.dart';
import 'package:relay_agent/transaction_journey.dart';

void main() {
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
