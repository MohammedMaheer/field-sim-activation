import 'package:relay_agent/kyc_journey.dart';
import 'package:relay_agent/dashboard_charts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/main.dart';

void main() {
  testWidgets('guide preserves source stages before real screenshot capture', (
    tester,
  ) async {
    var capture = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: KycJourneyGuide(onCapture: () => capture = true),
          ),
        ),
      ),
    );
    for (final title in [
      'Emirates ID & OCR',
      'Customer information',
      'Plan information',
      'Order & customer details',
    ]) {
      expect(find.text(title), findsOneWidget);
      await tester.tap(find.text('Next stage'));
      await tester.pump();
    }
    expect(find.text('Capture, OCR & handoff'), findsOneWidget);
    await tester.tap(find.text('Go to capture'));
    expect(capture, isTrue);
    expect(tester.takeException(), isNull);
  });
  testWidgets('charts handle empty activity at narrow width and large text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(1.3)),
          child: Scaffold(
            body: ListView(
              children: [
                WeeklyActivityCard({
                  'trend': List.generate(
                    7,
                    (i) => {
                      'day': 'Mon',
                      'date': '2026-09-24',
                      'captures': 0,
                      'activations': 0,
                    },
                  ),
                }),
                const VerificationCard({
                  'capture_total': 0,
                  'capture_statuses': [],
                  'kyc_pending_review': 0,
                }),
              ],
            ),
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets('semantic status and performance tiles fit a phone viewport', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Column(
            children: [
              StatusPill('ACTIVE SHIFT'),
              Row(
                children: [
                  Expanded(child: MetricTile('Activations', '24', Icons.bolt)),
                  Expanded(child: MetricTile('Daily target', '30', Icons.flag)),
                ],
              ),
              InfoCard(
                icon: Icons.shield,
                text: 'Draft saved securely on this device.',
              ),
            ],
          ),
        ),
      ),
    );
    expect(find.text('ACTIVE SHIFT'), findsOneWidget);
    expect(find.text('24'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('error state offers a working retry', (tester) async {
    var called = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RetryView(
            error: StateError('offline'),
            onRetry: () => called = true,
          ),
        ),
      ),
    );
    await tester.tap(find.text('Try again'));
    expect(called, isTrue);
  });
}
