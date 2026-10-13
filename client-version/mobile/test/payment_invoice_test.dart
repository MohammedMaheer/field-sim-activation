import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/payment_invoice.dart';
import 'package:relay_agent/preview_main.dart';

void main() {
  test('saved document headings normalize to a distinct details section', () {
    for (final title in [
      'Invoice',
      'Payment invoice',
      'Sale receipt',
      'Reference bill',
      'Reference details',
    ]) {
      expect(referenceBillTitle(title), 'Reference details');
    }
    expect(referenceBillTitle('Customer'), 'Customer');
  });
  test(
    'sale reference bill shows SR only once with its verification status',
    () {
      final invoice = paymentInvoice({
        'id': 'sale-123',
        'status': 'SUBMITTED',
        'intake': {'capture_mode': 'SCREENSHOT_SALE', 'sr_number': 'SR-987654'},
        'sr_verification': {'status': 'PENDING'},
      });
      final fields = [
        for (final section in invoice['sections']) ...section['fields'],
      ];
      expect(
        fields.where((field) => field['label'] == 'SR number'),
        hasLength(1),
      );
      expect(
        (invoice['sections'] as List).first['fields'].any(
          (field) => field['label'] == 'SR number',
        ),
        isTrue,
        reason:
            'The SR is immediately visible beside the reference bill details',
      );
      expect(
        fields.firstWhere((field) => field['label'] == 'SR number')['value'],
        'SR-987654',
      );
      expect(
        fields.firstWhere(
          (field) => field['label'] == 'SR verification',
        )['value'],
        'Pending SR verification',
      );
    },
  );
  test(
    'order confirmation is a pending agent payment record without amounts',
    () {
      final invoice = paymentInvoice({
        'id': 'order-123',
        'status': 'SUBMITTED',
        'intake': {
          'capture_mode': 'SCREENSHOT_ORDER',
          'order_reference': 'SAMPLE-REQ-1001',
        },
      });
      expect(invoice['heading'], 'Payment recorded');
      expect(invoice['status'], 'Pending backend confirmation');
      expect([
        for (final section in invoice['sections'])
          for (final field in section['fields']) field['label'],
      ], isNot(contains('Customer signature')));
      final payment = (invoice['sections'] as List).firstWhere(
        (s) => s['title'] == 'Payment',
      );
      expect(
        [for (final f in payment['fields']) f['label']],
        ['Request ID', 'Sales agent payment record', 'Backend confirmation'],
      );
    },
  );
  test(
    'payment invoice uses evidence and does not infer paid amount from price',
    () {
      final row = <String, dynamic>{
        'id': 'payment-test-123',
        'document_kind': 'PAYMENT_CONFIRMATION',
        'status': 'SUBMITTED',
        'created_at': '2026-09-28',
        'intake': {
          'name': 'Alex Synthetic',
          'document_number': 'SAMPLE-ID-9090',
          'document_type': 'Passport',
          'plan_name': 'Plan A',
        },
        'plan_snapshot': {'monthly_cost': 350},
        'rows': [],
      };
      final invoice = paymentInvoice(row);
      final fields = {
        for (final section in invoice['sections'])
          for (final f in section['fields']) f['label']: f['value'],
      };
      expect(fields['Total paid'], 'Not recorded');
      expect(fields['Selfie'], 'Not recorded');
      expect(fields['Plan price'], 'AED 350.00');
      expect(fields['Document number'], '**** 9090');
      expect(fields['Document type'], 'Passport');
      row['rows'] = [
        {
          'fields': [
            {'label': 'Total paid', 'value': 'AED 199.00'},
          ],
        },
      ];
      row['activation'] = {'status': 'ACTIVATED', 'reference': 'EXT-123'};
      final text = ascii.decode(previewReceiptPdf(row));
      expect(text, contains('PAYMENT SUCCESSFUL'));
      expect(text, contains('199.00'));
      expect(text, contains('EXT-123'));
      expect(text, isNot(contains('SAMPLE-ID-9090')));
    },
  );
}
