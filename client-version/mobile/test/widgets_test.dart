import 'package:relay_agent/kyc_journey.dart';
import 'package:relay_agent/dashboard_charts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/main.dart';

void main() {
  testWidgets('capture progress follows real status including rejection', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final entry in <String?, int>{
      null: 0,
      'QUEUED': 0,
      'OCR_FAILED': 0,
      'EXTRACTED': 1,
      'VALIDATED': 1,
      'REJECTED': 1,
      'SUBMITTED': 2,
      'VERIFIED': 2,
    }.entries) {
      expect(captureStage(entry.key), entry.value);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: KycJourneyGuide(status: entry.key),
            ),
          ),
        ),
      );
      expect(
        find.text('YOUR TRANSACTION · STEP ${entry.value + 1} OF 3'),
        findsOneWidget,
      );
      expect(find.text('Capture transaction'), findsOneWidget);
      expect(find.text('Review details'), findsOneWidget);
      expect(find.text('Submit & track'), findsOneWidget);
      expect(find.text('Next stage'), findsNothing);
      expect(tester.takeException(), isNull);
    }
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
