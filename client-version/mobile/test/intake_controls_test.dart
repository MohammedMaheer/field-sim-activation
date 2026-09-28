import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/customer_intake.dart';
import 'package:relay_agent/preview_main.dart';
import 'package:relay_agent/services.dart';
import 'package:relay_agent/transaction_journey.dart' show SignaturePad;

void main() {
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
            initial: const {'step': 1},
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
