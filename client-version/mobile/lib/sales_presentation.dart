import 'services.dart';

String salesRoleLabel(dynamic role) =>
    role == 'Field Agent' ? 'Sales agent' : '$role';
String productLabel(dynamic product) => switch ('$product') {
  'ALL' => 'All products',
  'NEW' => 'New postpaid',
  'MNP' => 'MNP postpaid',
  'P2P' => 'P2P',
  'HW' => 'Home Wireless',
  'ELIFE' => 'eLife',
  'WASEL' => 'Wasel',
  'VISITOR' => 'Visitor',
  _ => '$product',
};

String activationLabel(Json sale) {
  if (sale['activation_label'] is String) return sale['activation_label'];
  if (sale['status'] == 'CANCELLED') return 'Cancelled';
  if (sale['status'] == 'FAILED') return 'Activation failed';
  final captureMode = sale['intake']?['capture_mode'] ?? sale['capture_mode'];
  final external =
      sale['status'] == 'CLOSED' ||
      sale['external_activation_recorded'] == true ||
      ['SCREENSHOT_ORDER', 'SCREENSHOT_SALE'].contains(captureMode);
  if (!external) return 'Pending backend review';
  final sr = sale['sr_verification']?['status'];
  if (sr == 'MISMATCH') return 'Activated · SR mismatch';
  if (sr != 'MATCHED') return 'Activated · Pending SR verification';
  return sale['status'] == 'CLOSED'
      ? 'Fully activated'
      : 'Activated · Pending backend review';
}

String recordedValue(dynamic value) =>
    value == null || '$value'.trim().isEmpty ? 'Not recorded' : '$value';
