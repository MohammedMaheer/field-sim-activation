import 'services.dart';

/// Only an explicitly labelled SR returned with an image-bound backend check
/// can replace the order's SR. A request ID is never a substitute.
Json receiptSrFields(Json response, {String fallbackSr = ''}) {
  final fields = response['fields'];
  final sr = fields is Map ? (fields['sr_number'] ?? '').toString().trim() : '';
  final proof = (response['sr_check'] ?? '').toString().trim();
  return sr.isNotEmpty && proof.isNotEmpty
      ? {'sr_number': sr, 'receipt_sr_check': proof}
      : {'sr_number': fallbackSr, 'receipt_sr_check': ''};
}
