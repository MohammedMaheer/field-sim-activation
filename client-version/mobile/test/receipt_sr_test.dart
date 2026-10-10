import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/receipt_sr.dart';

void main() {
  test(
    'explicit image-bound receipt SR replaces order SR without deriving request ID',
    () {
      expect(
        receiptSrFields({
          'fields': {'sr_number': 'SR-000765', 'request_id': 'REQ-99'},
          'sr_check': 'bound-proof',
        }, fallbackSr: 'SR-ORDER'),
        {'sr_number': 'SR-000765', 'receipt_sr_check': 'bound-proof'},
      );
      expect(
        receiptSrFields({
          'fields': {'request_id': 'REQ-99'},
        }, fallbackSr: 'SR-ORDER'),
        {'sr_number': 'SR-ORDER', 'receipt_sr_check': ''},
      );
    },
  );
  test(
    'unreadable receipts do not fabricate or retain a previous receipt SR',
    () {
      expect(receiptSrFields({'fields': {}}, fallbackSr: ''), {
        'sr_number': '',
        'receipt_sr_check': '',
      });
      expect(
        receiptSrFields({
          'fields': {'sr_number': 'SR-UNPROVEN'},
        }),
        {'sr_number': '', 'receipt_sr_check': ''},
      );
    },
  );
}
