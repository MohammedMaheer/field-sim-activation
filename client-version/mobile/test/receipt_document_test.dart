import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/receipt_document.dart';

void main() {
  test('legacy receipt preserves review state and captured totals', () {
    final html = receiptPrintDocument({
      'id': 'historical-a',
      'document_kind': 'ACTIVATION_RECEIPT',
      'status': 'REJECTED',
      'intake': {'document_number': 'P12345678'},
      'rows': [
        {
          'fields': [
            {'label': 'Total paid', 'value': 'AED 199.00'},
          ],
        },
      ],
    });
    expect(html, contains('Correction required'));
    expect(html, contains('AED 199.00'));
    expect(html, contains('•••• 5678'));
    expect(html, isNot(contains('Payment successful')));
  });
  test(
    'paper document includes collapsed fields, current SR state and masked identity',
    () {
      final html = receiptPrintDocument({
        'id': 'paper-a',
        'source_reference': 'REQ-123',
        'status': 'VERIFIED',
        'document_kind': 'SALE_SCREENSHOTS',
        'activation_label': 'Activated · SR mismatch',
        'intake': {'capture_mode': 'SCREENSHOT_SALE'},
        'invoice': {
          'heading': 'Sale confirmed',
          'status': 'Verified',
          'sections': [
            {
              'title': 'Invoice',
              'fields': [
                {'label': 'Invoice number', 'value': 'PAY-123'},
              ],
            },
            {
              'title': 'Customer',
              'fields': [
                {'label': 'Customer name', 'value': 'Jordan & Vale'},
                {'label': 'Document number', 'value': '7841999999999876'},
                {'label': 'Nationality', 'value': 'United Arab Emirates'},
              ],
            },
            {
              'title': 'Order details',
              'fields': [
                {'label': 'Notes', 'value': '<script>invalid()</script>'},
                {'label': 'Prepayment on order', 'value': 0},
                {'label': 'Router serial', 'value': null},
              ],
            },
          ],
        },
      });
      expect(html, contains('Qanawat'));
      expect(html, contains('<h1>Reference bill</h1>'));
      expect(html, contains('<h2>Reference details</h2>'));
      expect(html, isNot(contains('<h2>Reference bill</h2>')));
      expect(RegExp('<img ').allMatches(html), hasLength(1));
      expect(html, contains('Reference bill number'));
      expect(html, isNot(contains('Invoice')));
      expect(html, contains('Activated · SR mismatch'));
      expect(html, contains('Nationality'));
      expect(html, contains('Jordan &amp; Vale'));
      expect(html, contains('•••• 9876'));
      expect(html, isNot(contains('7841999999999876')));
      expect(html, contains('&lt;script&gt;invalid()&lt;&#47;script&gt;'));
      expect(html, isNot(contains('<script>invalid()')));
      expect(html, contains('<td>0</td>'));
      expect(html, contains('Not recorded'));
      expect(html, isNot(contains('<canvas')));
      expect(html, isNot(contains('cdnjs')));
    },
  );
}
