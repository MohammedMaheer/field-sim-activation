import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/customer_intake.dart';
import 'package:relay_agent/kyc_capture.dart';
import 'package:relay_agent/main.dart'
    show InfoCard, KeyValue, MetricTile, SectionTitle, StatusPill;
import 'package:relay_agent/receipt_reveal.dart';
import 'package:relay_agent/relay_theme.dart';
import 'package:relay_agent/scan_surface.dart';
import 'package:relay_agent/services.dart';
import 'compact_steps_test.dart'
    show
        CompactService,
        compactIntake,
        control,
        expectCompleteValue,
        expectFieldGap,
        settleCompact;

const longName = 'ANFAL MOHAMED BILAL KHAMIS ALZAABI';
const longReference = 'NATIVE-20261008-REQUEST-1790012345678900';
const longGuidance =
    'Your payment record is stored. The backend team will review the uploaded '
    'confirmation and send your branch a transaction update.';

Widget readingSurface(
  double scale,
  Widget child, {
  bool disableAnimations = true,
}) => MaterialApp(
  theme: relayTheme(),
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(
      textScaler: TextScaler.linear(scale),
      disableAnimations: disableAnimations,
    ),
    child: child!,
  ),
  home: Scaffold(
    body: SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: child,
    ),
  ),
);

Widget capturedSurface(double scale, Widget child) => ProviderScope(
  overrides: [serviceProvider.overrideWith((ref) => CompactService())],
  child: MaterialApp(
    theme: relayTheme(),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(scale), disableAnimations: true),
      child: child!,
    ),
    home: child,
  ),
);

void setPhoneSize(WidgetTester tester, double width) {
  tester.view.physicalSize = Size(width, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void expectReadableText(
  WidgetTester tester,
  String text,
  double width, {
  Rect? frame,
}) {
  final label = find.text(text);
  expect(label, findsOneWidget);
  final bounds = tester.getRect(label);
  expect(bounds.left, greaterThanOrEqualTo(15.5), reason: text);
  expect(bounds.right, lessThanOrEqualTo(width - 15.5), reason: text);
  if (frame != null) {
    expect(bounds.top, greaterThanOrEqualTo(frame.top - .5), reason: text);
    expect(bounds.bottom, lessThanOrEqualTo(frame.bottom + .5), reason: text);
  }
  final paragraph = tester.renderObject<RenderParagraph>(
    find.descendant(of: label, matching: find.byType(RichText)),
  );
  expect(
    paragraph.didExceedMaxLines,
    isFalse,
    reason: '$text must be readable in full, including with larger text',
  );
  // A wrapped line's trailing spaces can extend its selection box beyond the
  // reading area. Check visible words, including every part of long references.
  for (final word in RegExp(r'\S+').allMatches(text)) {
    for (final box in paragraph.getBoxesForSelection(
      TextSelection(baseOffset: word.start, extentOffset: word.end),
    )) {
      expect(box.left, greaterThanOrEqualTo(-.5), reason: text);
      expect(
        box.right,
        lessThanOrEqualTo(paragraph.size.width + .5),
        reason: '$text must wrap within its reading area',
      );
    }
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    for (final entry in {
      'DM Sans': 'assets/fonts/dmsans.ttf',
      'Manrope': 'assets/fonts/manrope.ttf',
      'MaterialIcons': 'fonts/MaterialIcons-Regular.otf',
    }.entries) {
      final loader = FontLoader(entry.key)
        ..addFont(rootBundle.load(entry.value));
      await loader.load();
    }
  });

  for (final width in [300.0, 360.0, 390.0]) {
    for (final scale in [1.0, 1.5, 2.0]) {
      if (scale > 1) {
        for (final step in [0, 1]) {
          testWidgets(
            'captured stage ${step + 1} stays readable at $width with text $scale',
            (tester) async {
              setPhoneSize(tester, width);
              final values = compactIntake(step);
              await tester.pumpWidget(
                capturedSurface(
                  scale,
                  CustomerIntakeScreen(
                    initial: values,
                    onReady: (_) {},
                    onHistory: () {},
                  ),
                ),
              );
              await settleCompact(tester);
              for (final title in [
                '1. Customer',
                '2. Order & plan',
                '3. Payment',
              ]) {
                expectReadableText(tester, title, width);
                final paragraph = tester.renderObject<RenderParagraph>(
                  find.descendant(
                    of: find.text(title),
                    matching: find.byType(RichText),
                  ),
                );
                expect(
                  paragraph.getTransformTo(null).getMaxScaleOnAxis(),
                  greaterThanOrEqualTo(.99),
                  reason:
                      'Stage labels must honor larger text without shrinking',
                );
              }
              final scroll = find.byType(Scrollable).first;
              if (step == 0) {
                await tester.scrollUntilVisible(
                  control('Full name'),
                  120,
                  scrollable: scroll,
                );
                expectCompleteValue(tester, 'Full name', values['name']);
                await tester.scrollUntilVisible(
                  control('Nationality'),
                  120,
                  scrollable: scroll,
                );
                expectFieldGap(tester, 'Document number', 'Nationality');
              } else {
                await tester.scrollUntilVisible(
                  control('Package name'),
                  120,
                  scrollable: scroll,
                );
                expectCompleteValue(
                  tester,
                  'Package name',
                  values['package_name'],
                );
                await tester.scrollUntilVisible(
                  control('Request ID'),
                  120,
                  scrollable: scroll,
                );
                expectCompleteValue(
                  tester,
                  'Request ID',
                  values['order_reference'],
                );
                expectFieldGap(tester, 'Package name', 'Request ID');
              }
              await tester.ensureVisible(find.text('Continue'));
              await tester.pump();
              expect(find.text('Continue').hitTestable(), findsOneWidget);
              expect(tester.takeException(), isNull);
              await tester.pumpWidget(const SizedBox());
            },
          );
        }

        testWidgets(
          'payment confirmation actions remain reachable at $width with text $scale',
          (tester) async {
            setPhoneSize(tester, width);
            await tester.pumpWidget(
              capturedSurface(
                scale,
                KycCaptureScreen(initial: compactIntake(1)),
              ),
            );
            await settleCompact(tester);
            await tester.ensureVisible(find.text('Continue'));
            await tester.tap(find.text('Continue'));
            await settleCompact(tester);
            expect(tester.takeException(), isNull);
            for (final action in ['Take photo', 'Upload']) {
              await tester.scrollUntilVisible(
                find.text(action),
                120,
                scrollable: find.byType(Scrollable).first,
              );
              await tester.pump();
              expectReadableText(tester, action, width);
              expect(find.text(action).hitTestable(), findsOneWidget);
            }
            final upload = find.text('Upload payment confirmation').last;
            await tester.scrollUntilVisible(
              upload,
              120,
              scrollable: find.byType(Scrollable).first,
            );
            await tester.ensureVisible(upload);
            await tester.pump();
            final paragraph = tester.renderObject<RenderParagraph>(
              find.descendant(of: upload, matching: find.byType(RichText)),
            );
            expect(paragraph.didExceedMaxLines, isFalse);
            expect(upload.hitTestable(), findsOneWidget);
            expect(tester.takeException(), isNull);
            await tester.pumpWidget(const SizedBox());
            await tester.pump(const Duration(milliseconds: 100));
          },
        );
      }

      testWidgets(
        'shared reading components retain complete text at $width / $scale',
        (tester) async {
          setPhoneSize(tester, width);
          await tester.pumpWidget(
            readingSurface(
              scale,
              const Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SectionTitle('Customer and backend confirmation details'),
                  SizedBox(height: 16),
                  KeyValue('Full customer name', longName),
                  KeyValue('Backend confirmation reference', longReference),
                  SizedBox(height: 16),
                  InfoCard(icon: Icons.info_outline, text: longGuidance),
                  SizedBox(height: 16),
                  MetricTile(
                    'Completed sales this month',
                    '12,345',
                    Icons.receipt_long_outlined,
                  ),
                  SizedBox(height: 16),
                  StatusPill('Pending backend confirmation'),
                ],
              ),
            ),
          );
          await tester.pump(const Duration(milliseconds: 250));
          for (final text in [
            'Customer and backend confirmation details',
            'Full customer name',
            longName,
            'Backend confirmation reference',
            longReference,
            longGuidance,
            'Completed sales this month',
            '12,345',
            'Pending backend confirmation',
          ]) {
            expectReadableText(tester, text, width);
          }
          for (final label in [
            'Full customer name',
            'Backend confirmation reference',
          ]) {
            final row = tester.getRect(
              find.ancestor(
                of: find.text(label),
                matching: find.byType(KeyValue),
              ),
            );
            final value = tester.getRect(
              find.text(
                label == 'Full customer name' ? longName : longReference,
              ),
            );
            final caption = tester.getRect(find.text(label));
            expect(caption.overlaps(value), isFalse, reason: label);
            expect(value.bottom, lessThanOrEqualTo(row.bottom), reason: label);
          }
          await tester.ensureVisible(find.text('Pending backend confirmation'));
          await tester.pump();
          expect(
            find.text('Pending backend confirmation').hitTestable(),
            findsOneWidget,
          );
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
        },
      );

      testWidgets(
        'scanner labels and captured preview remain usable at $width / $scale',
        (tester) async {
          setPhoneSize(tester, width);
          await tester.pumpWidget(
            readingSurface(
              scale,
              const ScanSurface(document: 'Customer details'),
            ),
          );
          await tester.pump(const Duration(milliseconds: 100));
          final empty = tester.getRect(find.byType(ScanSurface));
          for (final text in [
            'CUSTOMER DETAILS',
            'Identity document',
            'Ready to capture',
            'Position document',
          ]) {
            expectReadableText(tester, text, width, frame: empty);
          }
          expect(
            tester.getRect(find.text('Ready to capture')).bottom,
            lessThan(tester.getRect(find.text('Position document')).top),
          );
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
          await tester.pumpWidget(
            readingSurface(
              scale,
              const ScanSurface(image: 'captured', illustration: true),
            ),
          );
          await tester.pump(const Duration(milliseconds: 100));
          final captured = tester.getRect(find.byType(ScanSurface));
          expectReadableText(
            tester,
            'Document captured',
            width,
            frame: captured,
          );
          expectReadableText(tester, 'View', width, frame: captured);
          expect(find.text('View').hitTestable(), findsOneWidget);
          await tester.tap(find.text('View'));
          await tester.pump(const Duration(milliseconds: 300));
          expect(
            find.byTooltip('Collapse document preview').hitTestable(),
            findsOneWidget,
          );
          expect(
            tester.getSize(find.byType(ScanSurface)).height,
            greaterThan(captured.height),
          );
          final expanded = tester.getRect(find.byType(ScanSurface));
          expectReadableText(
            tester,
            'Document captured',
            width,
            frame: expanded,
          );
          expect(tester.takeException(), isNull);
          await tester.tap(find.byTooltip('Collapse document preview'));
          await tester.pump();
          expect(find.text('View').hitTestable(), findsOneWidget);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
        },
      );

      testWidgets(
        'invoice printer preserves long values and replay at $width / $scale',
        (tester) async {
          setPhoneSize(tester, width);
          await tester.pumpWidget(
            readingSurface(
              scale,
              const ReceiptReveal(
                child: Card(
                  child: Padding(
                    padding: EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        SectionTitle('Payment recorded'),
                        SizedBox(height: 12),
                        KeyValue('Customer', longName),
                        KeyValue('Request ID', longReference),
                        KeyValue('Status', 'Pending backend confirmation'),
                      ],
                    ),
                  ),
                ),
              ),
              disableAnimations: false,
            ),
          );
          await tester.pump(const Duration(milliseconds: 1100));
          expect(tester.takeException(), isNull);
          await tester.pump(const Duration(milliseconds: 1200));
          expectReadableText(tester, 'INVOICE READY', width);
          for (final text in [
            'Payment recorded',
            'Customer',
            longName,
            'Request ID',
            longReference,
            'Status',
            'Pending backend confirmation',
          ]) {
            expectReadableText(tester, text, width);
          }
          final paper = find.byKey(const ValueKey('invoice-feed'));
          final printedHeight = tester.getSize(paper).height;
          expect(printedHeight, greaterThan(0));
          await tester.ensureVisible(find.byTooltip('Replay invoice printing'));
          await tester.tap(find.byTooltip('Replay invoice printing'));
          await tester.pump();
          expect(tester.getSize(paper).height, 0);
          await tester.pump(const Duration(milliseconds: 2300));
          expect(tester.getSize(paper).height, closeTo(printedHeight, .5));
          await tester.ensureVisible(find.text('Pending backend confirmation'));
          await tester.pump();
          expect(
            find.text('Pending backend confirmation').hitTestable(),
            findsOneWidget,
          );
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
        },
      );
    }
  }
}
