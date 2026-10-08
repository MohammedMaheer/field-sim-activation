import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/kyc_capture.dart';
import 'package:relay_agent/services.dart';

class CaptureMemoryStore extends OfflineStore {
  @override
  Future<Json?> get(String id) async => null;
  @override
  Future<void> put(String id, Json value) async {}
}

class ReconnectingCaptureService extends RelayService {
  final memory = CaptureMemoryStore();
  int reads = 0;
  @override
  OfflineStore get store => memory;
  @override
  bool get isPreview => true;
  @override
  Future<List<Json>> list(String resource) async => [
    {'id': 'plan-one', 'name': 'Plan One'},
  ];

  ReconnectingCaptureService() {
    ready = true;
    user = {
      'id': 'reconnecting-agent',
      'role': 'Field Agent',
      'permissions': ['read', 'ekyc.write'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (request, handler) {
          if (request.path == '/kyc-captures' && reads++ == 0) {
            handler.reject(
              DioException(
                requestOptions: request,
                type: DioExceptionType.connectionError,
              ),
            );
          } else {
            handler.resolve(
              Response(
                requestOptions: request,
                statusCode: 200,
                data: request.path == '/kyc-captures'
                    ? []
                    : {'version': 0, 'data': <String, dynamic>{}},
              ),
            );
          }
        },
      ),
    );
  }
}

void main() {
  testWidgets('payment screen clears a connection warning after reconnecting', (
    tester,
  ) async {
    final service = ReconnectingCaptureService();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [serviceProvider.overrideWith((ref) => service)],
        child: const MaterialApp(
          home: KycCaptureScreen(
            initial: {
              'step': 1,
              'capture_mode': 'SCREENSHOT_ORDER',
              'name': 'Avery Stone',
              'document_number': 'SAMPLE-ID-1001',
              'nationality': 'United Arab Emirates',
              'birth_date': '1990-01-01',
              'expiry_date': '2030-12-31',
              'document_image': 'captured',
              'document_check': 'customer-proof',
              'order_image': 'captured',
              'order_check': 'order-proof',
              'order_type': 'NEW',
              'order_reference': 'SAMPLE-REQUEST-1',
              'plan_id': 'plan-one',
              'msisdn': '0500000000',
            },
          ),
        ),
      ),
    );
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    await tester.tap(find.text('Continue'));
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    const warning =
        'Cannot reach the backend. Your saved screenshot remains on this device.';
    expect(find.text(warning), findsOneWidget);
    await tester.pump(const Duration(seconds: 12));
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(service.reads, greaterThanOrEqualTo(2));
    expect(find.text(warning), findsNothing);
    expect(find.text('Submit sale'), findsWidgets);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(milliseconds: 100));
  });
}
