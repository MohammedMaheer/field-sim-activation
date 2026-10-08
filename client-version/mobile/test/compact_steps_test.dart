import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dio/dio.dart';
import 'package:relay_agent/customer_intake.dart';
import 'package:relay_agent/kyc_capture.dart';
import 'package:relay_agent/payment_invoice.dart';
import 'package:relay_agent/relay_theme.dart';
import 'package:relay_agent/services.dart';
import 'package:relay_agent/scan_surface.dart';
import 'package:relay_agent/transaction_journey.dart';

class CompactMemoryStore extends OfflineStore {
  final records = <String, Json>{};
  @override
  Future<Json?> get(String id) async => records[id];
  @override
  Future<void> put(String id, Json record) async => records[id] = record;
  @override
  Future<void> remove(String id) async => records.remove(id);
}

class CompactService extends RelayService {
  final memory = CompactMemoryStore();
  final Json? capture;
  @override
  OfflineStore get store => memory;
  @override
  bool get isPreview => true;
  @override
  Future<List<Json>> list(String resource) async => [
    {'id': 'plan-350', 'name': '5G Unlimited Ultra'},
  ];
  CompactService({this.capture}) {
    ready = true;
    user = {
      'id': 'compact-agent',
      'agent_id': 'compact-agent',
      'role': 'Field Agent',
      'permissions': ['read', 'ekyc.write'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (request, handler) {
          handler.resolve(
            Response(
              requestOptions: request,
              statusCode: 200,
              data: request.path == '/kyc-captures/compact-capture'
                  ? capture
                  : request.path == '/kyc-captures'
                  ? (capture == null ? <dynamic>[] : [capture])
                  : {'version': 0, 'data': <String, dynamic>{}},
            ),
          );
        },
      ),
    );
  }
}

// Keep layout checks on the production typography, outlines and control spacing.
ThemeData compactTheme() => relayTheme();

Json compactIntake(int step) => {
  'step': step,
  'capture_mode': 'SCREENSHOT_ORDER',
  'name': 'ANFAL MOHAMED BILAL KHAMIS ALZAABI',
  'document_number': '784199670518028',
  'nationality': 'United Arab Emirates',
  'birth_date': '1996-09-08',
  'expiry_date': '2031-10-06',
  'document_image': 'captured-customer',
  'document_check': 'customer-proof',
  'order_image': 'captured-order',
  'order_check': 'order-proof',
  'order_type': 'NEW',
  'package_name': 'New Freedom 325 Non-Stop data Local',
  'order_reference': 'SAMPLE-REQ-1790012345678900',
  'msisdn': '0502346653',
  'monthly_cost': '325',
  'prepayment': '0',
  'plan_id': 'plan-350',
  'plan_name': '5G Unlimited Ultra',
};

Future<void> settleCompact(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Finder control(String label) =>
    find.ancestor(of: find.text(label), matching: find.byType(InputDecorator));

void expectFieldGap(WidgetTester tester, String upper, String lower) {
  final first = tester.getRect(control(upper));
  final next = tester.getRect(control(lower));
  expect(
    next.top - first.bottom,
    greaterThanOrEqualTo(10),
    reason: '$upper and $lower need a clear gap around their floating labels',
  );
}

void expectCompleteValue(WidgetTester tester, String label, String value) {
  final editor = find.descendant(
    of: control(label),
    matching: find.byType(EditableText),
  );
  final RenderEditable editable = tester
      .state<EditableTextState>(editor)
      .renderEditable;
  final boxes = editable.getBoxesForSelection(
    TextSelection(baseOffset: 0, extentOffset: value.length),
  );
  expect(boxes, isNotEmpty);
  for (final box in boxes) {
    expect(box.left, greaterThanOrEqualTo(-.1));
    expect(
      box.right,
      lessThanOrEqualTo(editable.size.width + .1),
      reason:
          '$label should wrap its complete captured value, not hide its ending',
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final font = FontLoader('DM Sans')
      ..addFont(rootBundle.load('assets/fonts/dmsans.ttf'));
    await font.load();
    final headings = FontLoader('Manrope')
      ..addFont(rootBundle.load('assets/fonts/manrope.ttf'));
    await headings.load();
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
      expect(frame.height, lessThan(180));
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

  for (final width in [300.0, 360.0, 390.0]) {
    for (final step in [0, 1]) {
      testWidgets('capture stage ${step + 1} fits $width with separated fields', (
        tester,
      ) async {
        tester.view.physicalSize = Size(width, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final values = compactIntake(step);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              serviceProvider.overrideWith((ref) => CompactService()),
            ],
            child: MaterialApp(
              theme: compactTheme(),
              home: CustomerIntakeScreen(
                initial: values,
                onReady: (_) {},
                onHistory: () {},
              ),
            ),
          ),
        );
        await settleCompact(tester);
        for (final title in ['1. Customer', '2. Order & plan', '3. Payment']) {
          final caption = find.text(title);
          final frame = find.ancestor(
            of: caption,
            matching: find.byType(AnimatedContainer),
          );
          final captionBounds = tester.getRect(caption);
          final frameBounds = tester.getRect(frame);
          expect(
            captionBounds.left - frameBounds.left,
            greaterThanOrEqualTo(6),
          );
          expect(
            frameBounds.right - captionBounds.right,
            greaterThanOrEqualTo(6),
          );
          expect(captionBounds.top - frameBounds.top, greaterThanOrEqualTo(8));
          expect(
            frameBounds.bottom - captionBounds.bottom,
            greaterThanOrEqualTo(8),
          );
          expect(
            captionBounds.height,
            greaterThanOrEqualTo(13),
            reason:
                'A full step caption must remain readable inside the framed demo',
          );
        }
        final heading = find.descendant(
          of: find.text('New transaction'),
          matching: find.byType(RichText),
        );
        expect(
          tester.renderObject<RenderParagraph>(heading).didExceedMaxLines,
          isFalse,
          reason:
              'New transaction must remain fully visible in the narrow framed demo',
        );
        if (step == 0) {
          expectFieldGap(tester, 'Full name', 'Document number');
          expectFieldGap(tester, 'Document number', 'Nationality');
          expectCompleteValue(tester, 'Full name', values['name']);
          if (width >= 360) {
            expect(
              tester.getRect(control('Date of birth')).right,
              lessThan(tester.getRect(control('Expiry date')).left),
            );
          } else {
            expectFieldGap(tester, 'Date of birth', 'Expiry date');
          }
        } else {
          expectFieldGap(tester, 'Order type', 'Package name');
          expectFieldGap(tester, 'Package name', 'Request ID');
          expectFieldGap(tester, 'Request ID', 'Monthly charge');
          expectFieldGap(tester, 'Monthly charge', 'Subscriber plan');
          expectCompleteValue(tester, 'Request ID', values['order_reference']);
          expectCompleteValue(tester, 'Package name', values['package_name']);
          if (width >= 360) {
            expect(
              tester.getRect(control('Request ID')).top,
              tester.getRect(control('Phone number')).top,
            );
          } else {
            expectFieldGap(tester, 'Request ID', 'Phone number');
          }
          final button = find.ancestor(
            of: find.text('Scan order'),
            matching: find.byWidgetPredicate((w) => w is FilledButton),
          );
          expect(
            tester.getRect(control('Order type')).top -
                tester.getRect(button).bottom,
            greaterThanOrEqualTo(10),
          );
        }
        final continueButton = find.ancestor(
          of: find.text('Continue'),
          matching: find.byWidgetPredicate((w) => w is FilledButton),
        );
        expect(continueButton.hitTestable(), findsOneWidget);
        expect(tester.getRect(continueButton).bottom, lessThanOrEqualTo(844));
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      });
    }

    testWidgets(
      'payment upload at $width separates photo actions from upload',
      (tester) async {
        tester.view.physicalSize = Size(width, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              serviceProvider.overrideWith((ref) => CompactService()),
            ],
            child: MaterialApp(
              theme: compactTheme(),
              home: KycCaptureScreen(initial: compactIntake(1)),
            ),
          ),
        );
        await settleCompact(tester);
        await tester.tap(find.text('Continue'));
        await settleCompact(tester);
        final photo = find.ancestor(
          of: find.text('Take photo'),
          matching: find.byWidgetPredicate((w) => w is OutlinedButton),
        );
        final upload = find.ancestor(
          of: find.text('Upload payment confirmation').last,
          matching: find.byWidgetPredicate((w) => w is FilledButton),
        );
        expect(photo, findsOneWidget);
        expect(upload, findsOneWidget);
        expect(
          tester.getRect(upload).top - tester.getRect(photo).bottom,
          greaterThanOrEqualTo(10),
        );
        final heading = find.text('Upload payment confirmation').first;
        final card = find
            .ancestor(of: heading, matching: find.byType(Card))
            .first;
        expect(
          tester.getRect(heading).left - tester.getRect(card).left,
          greaterThanOrEqualTo(16),
        );
        expect(
          tester.getRect(card).right - tester.getRect(heading).right,
          greaterThanOrEqualTo(16),
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        await tester.pump(const Duration(milliseconds: 100));
      },
    );
  }

  testWidgets(
    'narrow invoice keeps reference groups intact and supporting button separated',
    (tester) async {
      tester.view.physicalSize = const Size(360, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final invoice = paymentInvoice({
        'id': 'invoice-narrow',
        'status': 'SUBMITTED',
        'intake': {
          ...compactIntake(2),
          'order_reference': 'NATIVE-20261007-2230',
        },
      });
      final original = (invoice['sections'] as List)
          .expand((section) => section['fields'] as List)
          .firstWhere((field) => field['label'] == 'Request ID')['value'];
      await tester.pumpWidget(
        MaterialApp(
          theme: compactTheme(),
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: SingleChildScrollView(
                child: PaymentInvoiceSections(invoice: invoice),
              ),
            ),
          ),
        ),
      );
      final code = find.byWidgetPredicate(
        (widget) => widget is Text && widget.semanticsLabel == original,
      );
      expect(code, findsOneWidget);
      final displayed = tester.widget<Text>(code).data!;
      expect(displayed.replaceAll('\u200b', ''), original);
      final paragraph = tester.renderObject<RenderParagraph>(
        find.descendant(of: code, matching: find.byType(RichText)),
      );
      final finalGroup = displayed.indexOf('2230');
      final groupBoxes = paragraph.getBoxesForSelection(
        TextSelection(baseOffset: finalGroup, extentOffset: finalGroup + 4),
      );
      expect(
        groupBoxes.map((box) => box.top).toSet().length,
        1,
        reason:
            'The last reference group must not strand its final digit on another line',
      );
      final supporting = find.ancestor(
        of: find.text('Show supporting details'),
        matching: find.byWidgetPredicate((w) => w is OutlinedButton),
      );
      final paymentSection = find
          .ancestor(
            of: find.text('Backend confirmation'),
            matching: find.byType(Container),
          )
          .last;
      expect(
        tester.getRect(supporting).top - tester.getRect(paymentSection).bottom,
        greaterThanOrEqualTo(10),
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('captured field name and value have distinct input boxes', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final capture = <String, dynamic>{
      'id': 'compact-capture',
      'version': 0,
      'status': 'EXTRACTED',
      'source_reference': 'PAY-REF-0001',
      'document_kind': 'PAYMENT_CONFIRMATION',
      'created_at': '2026-10-08',
      'intake': compactIntake(2),
      'rows': [
        {
          'fields': [
            {'label': 'Request ID', 'value': '1570837383'},
          ],
        },
      ],
    };
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          serviceProvider.overrideWith(
            (ref) => CompactService(capture: capture),
          ),
        ],
        child: MaterialApp(
          theme: compactTheme(),
          home: const KycCaptureScreen(captureId: 'compact-capture'),
        ),
      ),
    );
    await settleCompact(tester);
    await tester.pump(const Duration(seconds: 2));
    await tester.scrollUntilVisible(
      find.text('Field name'),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    expectFieldGap(tester, 'Field name', 'Value');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(milliseconds: 100));
  });
}
