import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/receipt_reveal.dart';

const headerKey = ValueKey('invoice-header');
const footerKey = ValueKey('invoice-footer');

Widget invoice({VoidCallback? onHeader, VoidCallback? onFooter}) => SizedBox(
  height: 400,
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      SizedBox(
        height: 60,
        child: GestureDetector(
          key: headerKey,
          behavior: HitTestBehavior.opaque,
          onTap: onHeader,
          child: const ColoredBox(
            color: Color(0xffa62156),
            child: Center(child: Text('Invoice customer')),
          ),
        ),
      ),
      const Spacer(),
      SizedBox(
        height: 60,
        child: GestureDetector(
          key: footerKey,
          behavior: HitTestBehavior.opaque,
          onTap: onFooter,
          child: const ColoredBox(
            color: Color(0xff215af5),
            child: Center(child: Text('Invoice total')),
          ),
        ),
      ),
    ],
  ),
);

Finder paperClip() => find
    .descendant(of: find.byType(ReceiptReveal), matching: find.byType(ClipRect))
    .last;

void expectHeaderFirst(WidgetTester tester) {
  final clip = tester.getRect(paperClip());
  final header = tester.getRect(find.byKey(headerKey));
  final footer = tester.getRect(find.byKey(footerKey));
  expect(clip.height, greaterThan(60));
  expect(clip.height, lessThan(340));
  expect(header.top, greaterThanOrEqualTo(clip.top));
  expect(header.bottom, lessThanOrEqualTo(clip.bottom));
  expect(clip.contains(footer.center), isFalse);
  expect(find.byKey(headerKey).hitTestable(), findsOneWidget);
  expect(find.byKey(footerKey).hitTestable(), findsNothing);
}

void expectFullyPrinted(WidgetTester tester) {
  final clip = tester.getRect(paperClip());
  expect(clip.height, 400);
  expect(clip.contains(tester.getCenter(find.byKey(headerKey))), isTrue);
  expect(clip.contains(tester.getCenter(find.byKey(footerKey))), isTrue);
  expect(find.byKey(headerKey).hitTestable(), findsOneWidget);
  expect(find.byKey(footerKey).hitTestable(), findsOneWidget);
}

void main() {
  for (final width in [320.0, 360.0, 390.0]) {
    for (final scale in [1.0, 1.3]) {
      testWidgets('printer status fits $width px at $scale text scale', (
        tester,
      ) async {
        tester.view.physicalSize = Size(width, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(textScaler: TextScaler.linear(scale)),
              child: Scaffold(
                body: SingleChildScrollView(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: ReceiptReveal(
                      readyLabel: 'RECEIPT READY',
                      child: invoice(),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        final status = find.byKey(const ValueKey('receipt-printer-status'));
        final headerHeight = tester.getTopLeft(paperClip()).dy;
        expect(find.text('PRINTING…'), findsOneWidget);
        await tester.pumpAndSettle();
        expect(find.text('RECEIPT READY'), findsOneWidget);
        final paragraph = tester.renderObject<RenderParagraph>(status);
        final lines = paragraph
            .getBoxesForSelection(
              const TextSelection(baseOffset: 0, extentOffset: 13),
            )
            .map((box) => box.top)
            .toSet();
        expect(lines.length, lessThanOrEqualTo(2));
        expect(paragraph.didExceedMaxLines, isFalse);
        expect(tester.getTopLeft(paperClip()).dy, headerHeight);
        expect(
          tester.getSize(find.byTooltip('Replay invoice printing')).width,
          greaterThanOrEqualTo(48),
        );
        expect(tester.takeException(), isNull);
      });
    }
  }
  testWidgets('invoice prints header first downwards and replays in order', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var headerTaps = 0, footerTaps = 0;
    final app = MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: ReceiptReveal(
            child: invoice(
              onHeader: () => headerTaps++,
              onFooter: () => footerTaps++,
            ),
          ),
        ),
      ),
    );
    await tester.pumpWidget(app);
    expect(tester.getRect(paperClip()).height, 0);
    expect(find.byKey(headerKey).hitTestable(), findsNothing);
    expect(find.byKey(footerKey).hitTestable(), findsNothing);

    await tester.pump(const Duration(milliseconds: 1100));
    expectHeaderFirst(tester);
    await tester.tap(find.byKey(headerKey));
    expect(headerTaps, 1);
    expect(footerTaps, 0);
    await tester.pumpAndSettle();
    expectFullyPrinted(tester);
    await tester.tap(find.byKey(footerKey));
    expect(footerTaps, 1);

    // Refreshing the same receipt must not start the print again.
    await tester.pumpWidget(app);
    expectFullyPrinted(tester);
    await tester.tap(find.byTooltip('Replay invoice printing'));
    await tester.pump();
    expect(tester.getRect(paperClip()).height, 0);
    expect(find.byKey(headerKey).hitTestable(), findsNothing);
    expect(find.byKey(footerKey).hitTestable(), findsNothing);
    await tester.pump(const Duration(milliseconds: 1100));
    expectHeaderFirst(tester);
    await tester.pumpAndSettle();
    expectFullyPrinted(tester);
    expect(tester.takeException(), isNull);
  });
  testWidgets('reduced motion shows full invoice and replay keeps it visible', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: Scaffold(body: ReceiptReveal(child: invoice())),
        ),
      ),
    );
    expectFullyPrinted(tester);
    await tester.tap(find.byTooltip('Replay invoice printing'));
    await tester.pump(const Duration(milliseconds: 1100));
    expectFullyPrinted(tester);
    expect(find.text('INVOICE READY'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
