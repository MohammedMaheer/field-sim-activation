import 'dart:async';
import 'package:dio/dio.dart';
import 'package:uuid/uuid.dart';
import 'services.dart';

class OcrTemporaryFailure implements Exception {
  final String message;
  const OcrTemporaryFailure(this.message);
  @override
  String toString() => message;
}

class OcrReadCancelled implements Exception {}

/// One stable operation survives transient network failures and polling retries.
class StageOcrRequest {
  final String stage, image, operationId;
  String? jobId;
  StageOcrRequest(this.stage, this.image) : operationId = const Uuid().v4();

  Future<Json> read(
    RelayService service, {
    void Function(String)? onStatus,
    bool Function()? isCurrent,
    Duration budget = const Duration(seconds: 120),
  }) async {
    final account = service.user?['id'];
    final deadline = DateTime.now().add(budget);
    var retryAfter = 2;
    bool current() =>
        service.user?['id'] == account && (isCurrent?.call() ?? true);
    while (DateTime.now().isBefore(deadline)) {
      if (!current()) throw OcrReadCancelled();
      try {
        final response = jobId == null
            ? await service.dio.post(
                '/kyc-captures/ocr-jobs',
                data: {
                  'operation_id': operationId,
                  'stage': stage,
                  'image_base64': image,
                },
              )
            : await service.dio.get('/kyc-captures/ocr-jobs/$jobId');
        if (!current()) throw OcrReadCancelled();
        final job = Json.from(response.data);
        jobId = job['id']?.toString() ?? jobId;
        if (job['stage'] != stage || jobId == null) {
          throw const OcrTemporaryFailure(
            'Scanner response could not be confirmed. Your photo is retained; retry.',
          );
        }
        if (job['status'] == 'COMPLETED') return Json.from(job['result'] ?? {});
        if (job['status'] == 'FAILED') {
          throw Exception(
            job['error']?.toString() ??
                'This screen could not be read. Try a clearer photo.',
          );
        }
        retryAfter = ((job['retry_after'] as num?)?.toInt() ?? 2).clamp(1, 5);
        onStatus?.call(
          job['status'] == 'PROCESSING'
              ? 'Reading captured screen…'
              : 'Waiting for scanner…',
        );
      } on DioException catch (error) {
        if (error.response?.statusCode != 429 &&
            error.response != null &&
            error.response!.statusCode! < 500) {
          rethrow;
        }
        onStatus?.call('Photo retained · waiting to reconnect…');
      }
      await Future<void>.delayed(Duration(seconds: retryAfter));
    }
    throw const OcrTemporaryFailure(
      'Scanner is still processing. Your photo is retained; retry to continue.',
    );
  }
}

const documentCaptureFields = <String>[
  'document_image',
  'document_check',
  'document_type',
  'name',
  'arabic_name',
  'document_number',
  'nationality',
  'birth_date',
  'expiry_date',
  'issue_date',
  'gender',
];
const orderCaptureFields = <String>[
  'order_image',
  'order_check',
  'order_reference',
  'product_name',
  'package_name',
  'monthly_cost',
  'prepayment',
  'order_type',
  'account_number',
  'sim_identifier',
  'router_serial',
  'router_fulfilment',
  'advance_transaction_number',
  'sr_number',
  'receipt_sr_check',
  'plan_id',
  'plan_name',
  'msisdn',
  'order_fields',
  'payment_image',
  'sr_manual',
];

Json withoutStageCapture(Json current, String stage) {
  final next = Json.from(current);
  for (final key
      in stage == 'DOCUMENT'
          ? [...documentCaptureFields, ...orderCaptureFields]
          : orderCaptureFields) {
    next.remove(key);
  }
  next.remove('_ocr');
  if (stage == 'DOCUMENT') next['step'] = 0;
  return next;
}

String? ocrWarning(Json result) {
  final warnings = result['_ocr']?['warnings'];
  return warnings is List && warnings.isNotEmpty
      ? warnings.first.toString()
      : null;
}
