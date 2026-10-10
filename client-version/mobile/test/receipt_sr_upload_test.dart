import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/kyc_capture.dart';
import 'package:relay_agent/relay_theme.dart';
import 'package:relay_agent/services.dart';
import 'compact_steps_test.dart' show CompactMemoryStore, compactIntake;

class ReceiptCaptureService extends RelayService {
  final memory = CompactMemoryStore();
  final Json extraction;
  Json? submitted;
  String? receiptImage;
  ReceiptCaptureService(this.extraction) {
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
          if (request.path == '/kyc-captures/receipt-fields') {
            receiptImage = request.data['image_base64'];
          }
          handler.resolve(
            Response(
              requestOptions: request,
              statusCode: 200,
              data: request.path == '/kyc-captures'
                  ? []
                  : request.path == '/kyc-captures/receipt-fields'
                  ? extraction
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
}
