import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/dashboard_charts.dart';

void main() {
  testWidgets(
    'weekly chart uses current net sales instead of historical orders',
    (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: WeeklyActivityCard({
                'trend': [
                  {
                    'date': '2026-10-11',
                    'day': 'Sun',
                    'captures': 2,
                    'activations': 0,
                  },
                ],
                'sales_trend': [
                  {
                    'date': '2026-10-11',
                    'day': 'Sun',
                    'captures': 2,
                    'activations': 1,
                  },
                ],
              }),
            ),
          ),
        );
        expect(
          find.bySemanticsLabel(RegExp('2026-10-11: 2 captures, 1 sales')),
          findsOneWidget,
        );
        expect(
          find.bySemanticsLabel(RegExp('2026-10-11: 2 captures, 0 sales')),
          findsNothing,
        );
        expect(tester.takeException(), isNull);
      } finally {
        semantics.dispose();
      }
    },
  );

  testWidgets(
    'empty current net sales series does not fall back to legacy totals',
    (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: WeeklyActivityCard({
                'trend': [
                  {
                    'date': '2026-10-11',
                    'day': 'Sun',
                    'captures': 2,
                    'activations': 3,
                  },
                ],
                'sales_trend': <Map<String, dynamic>>[],
              }),
            ),
          ),
        );
        expect(
          find.bySemanticsLabel(RegExp('2026-10-11: 2 captures, 3 sales')),
          findsNothing,
        );
        expect(tester.takeException(), isNull);
      } finally {
        semantics.dispose();
      }
    },
  );
}
