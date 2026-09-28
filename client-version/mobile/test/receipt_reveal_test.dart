import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/receipt_reveal.dart';

void main() {
  testWidgets(
    'invoice feeds through slot and can replay without losing content',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: ReceiptReveal(
                child: SizedBox(height: 400, child: Text('Invoice customer')),
              ),
            ),
          ),
        ),
      );
      final paper = find.byKey(const ValueKey('invoice-feed'));
      expect(tester.widget<FractionalTranslation>(paper).translation.dy, -1);
      await tester.pump(const Duration(milliseconds: 1100));
      final halfway = tester
          .widget<FractionalTranslation>(paper)
          .translation
          .dy;
      expect(halfway, greaterThan(-1));
      expect(halfway, lessThan(0));
      await tester.pumpAndSettle();
      expect(tester.widget<FractionalTranslation>(paper).translation.dy, 0);
      await tester.tap(find.byTooltip('Replay invoice printing'));
      await tester.pump();
      expect(tester.widget<FractionalTranslation>(paper).translation.dy, -1);
      await tester.pumpAndSettle();
      expect(find.text('Invoice customer'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('reduced motion displays complete invoice immediately', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(disableAnimations: true),
          child: Scaffold(body: ReceiptReveal(child: SizedBox(height: 200))),
        ),
      ),
    );
    expect(
      tester
          .widget<FractionalTranslation>(
            find.byKey(const ValueKey('invoice-feed')),
          )
          .translation
          .dy,
      0,
    );
    expect(tester.takeException(), isNull);
  });
}
