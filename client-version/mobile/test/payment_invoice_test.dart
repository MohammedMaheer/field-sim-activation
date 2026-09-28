import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/payment_invoice.dart';
import 'package:relay_agent/preview_main.dart';

void main() {
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
