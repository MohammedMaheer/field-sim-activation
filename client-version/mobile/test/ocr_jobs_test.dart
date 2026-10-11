import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/ocr_jobs.dart';
import 'package:relay_agent/services.dart';

void main() {
  test(
    'queued scans retain one operation through busy and network retries',
    () async {
      final service = RelayService()..user = {'id': 'agent-one'};
      final operations = <String>[], statuses = <String>[];
      var creates = 0, reads = 0;
      service.dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (request, handler) {
            if (request.method == 'POST') {
              operations.add(request.data['operation_id']);
              if (creates++ == 0) {
                handler.reject(
                  DioException(
                    requestOptions: request,
                    response: Response(
                      requestOptions: request,
                      statusCode: 429,
                    ),
                  ),
                );
                return;
              }
            } else if (reads++ == 0) {
              handler.reject(
                DioException(
                  requestOptions: request,
                  type: DioExceptionType.connectionError,
                ),
              );
              return;
            }
            handler.resolve(
              Response(
                requestOptions: request,
                statusCode: 202,
                data: {
                  'id': 'scan-one',
                  'stage': 'DOCUMENT',
                  'status': reads > 1 ? 'COMPLETED' : 'QUEUED',
                  'result': {'document_check': 'proof-one'},
                  'retry_after': 1,
                },
              ),
            );
          },
        ),
      );
      final operation = StageOcrRequest('DOCUMENT', 'same-photo');
      final result = await operation.read(service, onStatus: statuses.add);
      expect(result['document_check'], 'proof-one');
      expect(operations.toSet(), {operation.operationId});
      expect(operation.jobId, 'scan-one');
      expect(statuses, contains('Waiting for scanner…'));
      expect(statuses, contains('Photo retained · waiting to reconnect…'));
    },
  );

  test('changed account cannot receive an earlier scan result', () async {
    final service = RelayService()..user = {'id': 'agent-one'};
    service.dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (request, handler) {
          service.user = {'id': 'agent-two'};
          handler.resolve(
            Response(
              requestOptions: request,
              data: {
                'id': 'one',
                'stage': 'DOCUMENT',
                'status': 'COMPLETED',
                'result': {'name': 'Old customer'},
              },
            ),
          );
        },
      ),
    );
    await expectLater(
      StageOcrRequest('DOCUMENT', 'photo').read(service),
      throwsA(isA<OcrReadCancelled>()),
    );
  });

  test(
    'a replaced order clears old charges, plan, identifiers and receipt proof',
    () {
      final cleaned = withoutStageCapture({
        'name': 'Customer',
        'document_check': 'customer-proof',
        'document_image': 'customer-photo',
        'order_image': 'old-order',
        'order_check': 'old-proof',
        'plan_id': 'old-plan',
        'monthly_cost': '350',
        'prepayment': '50',
        'sr_number': 'old-sr',
        'receipt_sr_check': 'old-receipt-proof',
        'payment_image': 'old-payment',
      }, 'ORDER');
      expect(cleaned, {
        'name': 'Customer',
        'document_check': 'customer-proof',
        'document_image': 'customer-photo',
      });
      expect(withoutStageCapture(cleaned, 'DOCUMENT'), {'step': 0});
    },
  );
}
