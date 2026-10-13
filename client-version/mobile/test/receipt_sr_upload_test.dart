import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/kyc_capture.dart';
import 'package:relay_agent/relay_theme.dart';
import 'package:relay_agent/services.dart';
import 'package:relay_agent/receipt_sr.dart';
import 'compact_steps_test.dart' show CompactMemoryStore, compactIntake;

class ReceiptCaptureService extends RelayService {
  final memory = CompactMemoryStore();
  final Json extraction;
  bool failFirstRead;
  bool queueFirstRead;
  final readOperations = <String>[];
  Json? submitted;
  String? receiptImage;
  ReceiptCaptureService(
    this.extraction, {
    this.failFirstRead = false,
    this.queueFirstRead = false,
  }) {
    ready = true;
    user = {
      'id': 'receipt-agent',
      'agent_id': 'receipt-agent',
      'role': 'Field Agent',
      'permissions': ['read', 'ekyc.write'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (request, handler) {
          if (request.path == '/kyc-captures/sale-submissions') {
            submitted = Json.from(request.data);
            handler.reject(
              DioException(
                requestOptions: request,
                response: Response(
                  requestOptions: request,
                  statusCode: 409,
                  data: {'detail': 'Sale already recorded'},
                ),
              ),
            );
            return;
          }
          if (request.path == '/kyc-captures/ocr-jobs') {
            receiptImage = request.data['image_base64'];
            readOperations.add(request.data['operation_id']);
          }
          final create = request.path == '/kyc-captures/ocr-jobs';
          final failed = create && failFirstRead && readOperations.length == 1;
          final queued = create && queueFirstRead;
          handler.resolve(
            Response(
              requestOptions: request,
              statusCode: 200,
              data: request.path == '/kyc-captures'
                  ? []
                  : request.path.startsWith('/kyc-captures/ocr-jobs')
                  ? {
                      'id': create
                          ? request.data['operation_id']
                          : readOperations.last,
                      'stage': 'RECEIPT',
                      'status': failed
                          ? 'FAILED'
                          : queued
                          ? 'PROCESSING'
                          : 'COMPLETED',
                      if (failed) 'error': 'Receipt could not be read',
                      if (queued) 'retry_after': 2,
                      'result': extraction,
                    }
                  : {'version': 0, 'data': <String, dynamic>{}},
            ),
          );
        },
      ),
    );
  }
  @override
  OfflineStore get store => memory;
  @override
  bool get isPreview => true;
  @override
  Future<List<Json>> list(String resource) async => [
    {'id': 'plan-350', 'name': '5G Unlimited Ultra'},
  ];
  @override
  Future<Uint8List> previewReceipt({String? reference}) async =>
      (await rootBundle.load('assets/demo/payment.png')).buffer.asUint8List();
}

Future<void> settleReceipt(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
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

  Future<void> openReview(
    WidgetTester tester,
    ReceiptCaptureService service, {
    Json? initial,
    GlobalKey? boundary,
  }) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [serviceProvider.overrideWith((ref) => service)],
        child: RepaintBoundary(
          key: boundary,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: relayTheme(),
            home: KycCaptureScreen(initial: initial ?? compactIntake(1)),
          ),
        ),
      ),
    );
    await settleReceipt(tester);
    await tester.tap(find.text('Continue'));
    await settleReceipt(tester);
  }

  Future<void> uploadReceipt(WidgetTester tester) async {
    await tester.ensureVisible(find.text('Upload'));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.text('Upload'));
    await settleReceipt(tester);
  }

  Future<void> screenshot(
    WidgetTester tester,
    GlobalKey key,
    String name,
  ) async {
    const output = String.fromEnvironment('SR_VISUAL_OUTPUT');
    if (output.isEmpty) return;
    final boundary =
        key.currentContext!.findRenderObject() as RenderRepaintBoundary;
    await tester.runAsync(() async {
      final image = await boundary.toImage();
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      final file = File('$output/$name.png');
      file.parent.createSync(recursive: true);
      file.writeAsBytesSync(bytes!.buffer.asUint8List());
      image.dispose();
    });
  }

  for (final hasSr in [true, false]) {
    testWidgets(
      'receipt extraction ${hasSr ? 'records printed SR' : 'allows unreadable SR'} in submitted sale',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final service = ReceiptCaptureService(
          hasSr
              ? {
                  'fields': {'sr_number': 'SR-765'},
                  'sr_check': 'image-proof',
                }
              : {
                  'fields': {'request_id': 'REQ-DO-NOT-USE'},
                  'sr_check': '',
                },
        );
        await tester.pumpWidget(
          ProviderScope(
            overrides: [serviceProvider.overrideWith((ref) => service)],
            child: MaterialApp(
              theme: relayTheme(),
              home: KycCaptureScreen(initial: compactIntake(1)),
            ),
          ),
        );
        await settleReceipt(tester);
        await tester.tap(find.text('Continue'));
        await settleReceipt(tester);
        await tester.ensureVisible(find.text('Upload'));
        await tester.pump(const Duration(milliseconds: 100));
        await tester.tap(find.text('Upload'));
        await settleReceipt(tester);
        expect(service.receiptImage, isNotEmpty);
        expect(
          find.text(
            hasSr
                ? 'SR number read from receipt'
                : 'SR number not shown on receipt',
          ),
          findsOneWidget,
        );
        final submit = find.ancestor(
          of: find.text('Submit sale'),
          matching: find.byType(FilledButton),
        );
        await tester.ensureVisible(submit);
        await tester.pump(const Duration(milliseconds: 100));
        await tester.tap(submit);
        await settleReceipt(tester);
        final intake = Json.from(service.submitted!['intake']);
        expect(intake['sr_number'], hasSr ? 'SR-765' : '');
        expect(intake['receipt_sr_check'], hasSr ? 'image-proof' : '');
        expect(intake['payment_image'], service.receiptImage);
        expect(base64Decode(intake['payment_image']), isNotEmpty);
        expect(intake['order_reference'], compactIntake(1)['order_reference']);
        // A permanent duplicate response is shown, never queued for endless retry.
        expect(
          service.memory.records['kyc-draft-receipt-agent']!['pending'],
          isFalse,
        );
        await tester.drag(find.byType(ListView).first, const Offset(0, 1000));
        await settleReceipt(tester);
        expect(find.textContaining('Sale already recorded'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        await tester.pump(const Duration(milliseconds: 100));
      },
    );
  }

  testWidgets(
    'failed receipt OCR has a clear retry without asking for a typed SR',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final boundary = GlobalKey();
      final service = ReceiptCaptureService({
        'fields': {'sr_number': 'SR-NEW-246810'},
        'sr_check': 'new-image-proof',
      }, failFirstRead: true);
      await openReview(tester, service, boundary: boundary);
      await uploadReceipt(tester);
      await tester.ensureVisible(find.byType(SrNumberSummary));
      await settleReceipt(tester);
      expect(
        find.text('SR could not be read · retry or use a clearer photo'),
        findsOneWidget,
      );
      expect(find.text('Read SR again'), findsOneWidget);
      expect(service.readOperations, hasLength(1));
      await screenshot(tester, boundary, 'sr-ocr-retry');
      await tester.tap(find.text('Read SR again'));
      await settleReceipt(tester);
      expect(service.readOperations, hasLength(2));
      expect(service.readOperations.first, isNot(service.readOperations.last));
      expect(find.text('SR-NEW-246810'), findsOneWidget);
      expect(find.text('SR number read from receipt'), findsOneWidget);
      expect(find.text('Read SR again'), findsNothing);
      await screenshot(tester, boundary, 'sr-ocr-read');
      expect(find.text('Reference · optional'), findsNothing);
      await tester.ensureVisible(find.text('View receipt'));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.tap(find.text('View receipt'));
      await settleReceipt(tester);
      expect(find.byType(InteractiveViewer), findsOneWidget);
      expect(find.text('Payment receipt'), findsOneWidget);
      await screenshot(tester, boundary, 'sr-receipt-full-view');
      await tester.tap(find.text('Close'));
      await settleReceipt(tester);
      expect(find.byType(InteractiveViewer), findsNothing);
      final submit = find.widgetWithText(FilledButton, 'Submit sale');
      await tester.ensureVisible(submit);
      await settleReceipt(tester);
      await tester.tap(submit);
      await settleReceipt(tester);
      final intake = Json.from(service.submitted!['intake']);
      expect(intake['sr_number'], 'SR-NEW-246810');
      expect(intake['receipt_sr_check'], 'new-image-proof');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(milliseconds: 100));
    },
  );

  testWidgets(
    'queued receipt OCR holds submit until the same job supplies the SR',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final boundary = GlobalKey();
      final service = ReceiptCaptureService({
        'fields': {'sr_number': 'SR-QUEUED-135790'},
        'sr_check': 'queued-image-proof',
      }, queueFirstRead: true);
      await openReview(tester, service, boundary: boundary);
      await uploadReceipt(tester);
      expect(find.text('Reading captured screen…'), findsOneWidget);
      final working = find.widgetWithText(FilledButton, 'Working…');
      expect(tester.widget<FilledButton>(working).onPressed, isNull);
      await tester.ensureVisible(find.byType(SrNumberSummary));
      await tester.pump(const Duration(milliseconds: 100));
      await screenshot(tester, boundary, 'sr-ocr-reading');
      await tester.pump(const Duration(seconds: 2));
      await settleReceipt(tester);
      expect(service.readOperations, hasLength(1));
      expect(find.text('SR-QUEUED-135790'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Submit sale'),
            )
            .onPressed,
        isNotNull,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(milliseconds: 100));
    },
  );

  testWidgets(
    'receipt without SR keeps the OCR order SR and its original source',
    (tester) async {
      final service = ReceiptCaptureService({
        'fields': {'request_id': 'REQ-NOT-SR'},
      });
      await openReview(
        tester,
        service,
        initial: {...compactIntake(1), 'sr_number': 'SR-FROM-ORDER'},
      );
      expect(find.text('SR-FROM-ORDER'), findsOneWidget);
      expect(find.text('SR number read from order'), findsOneWidget);
      await uploadReceipt(tester);
      expect(find.text('SR-FROM-ORDER'), findsOneWidget);
      expect(
        find.text('SR number read from order · not shown on receipt'),
        findsOneWidget,
      );
      final submit = find.widgetWithText(FilledButton, 'Submit sale');
      await tester.ensureVisible(submit);
      await tester.pump(const Duration(milliseconds: 100));
      await tester.tap(submit);
      await settleReceipt(tester);
      expect(service.submitted!['intake']['sr_number'], 'SR-FROM-ORDER');
      expect(service.submitted!['intake']['receipt_sr_check'], '');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(milliseconds: 100));
    },
  );

  testWidgets(
    'conflicting receipt is explained and removal preserves the order SR',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final boundary = GlobalKey();
      final service = ReceiptCaptureService({
        'fields': {'sr_number': 'SR-DIFFERENT'},
        'sr_check': 'conflicting-proof',
        'sr_status': 'READ',
      });
      await openReview(
        tester,
        service,
        boundary: boundary,
        initial: {...compactIntake(1), 'sr_number': 'SR-ORDER-112233'},
      );
      await uploadReceipt(tester);
      await tester.ensureVisible(find.byType(SrNumberSummary));
      await settleReceipt(tester);
      expect(find.text('SR-ORDER-112233'), findsOneWidget);
      expect(
        find.text(
          'Receipt SR does not match the order · replace or remove receipt',
        ),
        findsOneWidget,
      );
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Submit sale'),
            )
            .onPressed,
        isNull,
      );
      await screenshot(tester, boundary, 'sr-ocr-conflicting-receipt');
      await tester.ensureVisible(find.text('Remove receipt'));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.tap(find.text('Remove receipt'));
      await settleReceipt(tester);
      expect(find.text('SR-ORDER-112233'), findsOneWidget);
      expect(find.text('SR number read from order'), findsOneWidget);
      expect(find.text('Receipt attached'), findsNothing);
      final submit = find.widgetWithText(FilledButton, 'Submit sale');
      expect(tester.widget<FilledButton>(submit).onPressed, isNotNull);
      await tester.ensureVisible(submit);
      await tester.pump(const Duration(milliseconds: 100));
      await tester.tap(submit);
      await settleReceipt(tester);
      expect(service.submitted!['intake']['sr_number'], 'SR-ORDER-112233');
      expect(
        service.submitted!['intake'].containsKey('receipt_sr_check'),
        isFalse,
      );
      expect(
        service.submitted!['intake'].containsKey('payment_image'),
        isFalse,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(milliseconds: 100));
    },
  );

  testWidgets(
    'unclear printed SR asks for a clearer photo and never fills request ID',
    (tester) async {
      final service = ReceiptCaptureService({
        'fields': {'request_id': 'REQ-NEVER-AN-SR'},
        'sr_status': 'UNCLEAR',
      });
      await openReview(tester, service);
      await uploadReceipt(tester);
      expect(
        find.text('SR number unclear · use a clearer receipt photo'),
        findsOneWidget,
      );
      expect(find.text('REQ-NEVER-AN-SR'), findsNothing);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Submit sale'),
            )
            .onPressed,
        isNotNull,
      );
      final submit = find.widgetWithText(FilledButton, 'Submit sale');
      await tester.ensureVisible(submit);
      await tester.pump(const Duration(milliseconds: 100));
      await tester.tap(submit);
      await settleReceipt(tester);
      expect(service.submitted!['intake']['sr_number'], '');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(milliseconds: 100));
    },
  );
}
