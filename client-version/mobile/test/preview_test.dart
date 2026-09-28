import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:archive/archive.dart';
import 'package:relay_agent/preview_main.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('receipt PDF keeps pending and verified outcomes distinct', () {
    final row = <String, dynamic>{
      'source_reference': 'RCP-TEST',
      'status': 'SUBMITTED',
      'intake': {
        'name': 'Alex Sample',
        'msisdn': 'SAMPLE-PHONE',
        'plan_name': 'Test plan',
      },
      'rows': [
        {
          'fields': [
            {'label': 'Customer ID', 'value': 'PRIVATE-ID-12345678'},
            {'label': 'Order ID', 'value': 'ORDER-12345678'},
          ],
        },
      ],
    };
    final pending = ascii.decode(previewReceiptPdf(row));
    expect(pending, startsWith('%PDF-1.4'));
    expect(pending, contains('FINAL REVIEW PENDING'));
    expect(pending, isNot(contains('SUCCESS')));
    expect(pending, isNot(contains('PRIVATE-ID-12345678')));
    expect(pending, contains('ORDER-12345678'));
    row['status'] = 'VERIFIED';
    expect(
      ascii.decode(previewReceiptPdf(row)),
      contains('SUCCESS - RECEIPT VERIFIED'),
    );
  });
  test('preview actions stay isolated and workbook uses edited rows', () async {
    final s = PreviewService(
      jsonDecode(File('assets/demo/workspace.json').readAsStringSync()),
    );
    addTearDown(s.dispose);
    expect(s.isPreview, true);
    expect((await s.dashboard())['today'], 12);
    await s.dio.post('/inventory/sim-0/move', data: {'status': 'RETURNED'});
    expect((await s.list('inventory')).first['status'], 'RETURNED');
    await s.dio.post('/agents/demo-agent/shift', data: {'action': 'end'});
    expect((await s.list('agents')).first['on_shift'], false);
    final capture = (await s.dio.post(
      '/kyc-captures',
      data: {'source_reference': 'DEMO-NEW'},
    )).data;
    final id = capture['id'];
    await s.dio.patch(
      '/kyc-captures/$id/rows',
      data: {
        'rows': [
          {
            'reference': '00123',
            'customer': 'Edited Demo',
            'account': '0001',
            'details': '=NOT_A_FORMULA',
          },
        ],
      },
    );
    final bytes = previewWorkbook(capture['rows']);
    final archive = ZipDecoder().decodeBytes(bytes);
    final xml = utf8.decode(
      archive.findFile('xl/worksheets/sheet1.xml')!.content,
    );
    expect(xml, contains('Edited Demo'));
    expect(xml, contains('00123'));
    expect(xml, contains('t="inlineStr"'));
    await s.dio.post('/kyc-captures/$id/submit');
    expect(capture['status'], 'SUBMITTED');
    await Future<void>.delayed(const Duration(milliseconds: 3200));
    expect(capture['status'], 'SUBMITTED');
    await s.logout();
    expect(s.user, isNull);
    await s.login('', '');
    expect(s.user!['id'], 'demo-user');
    expect(() => s.dio.get('/unknown'), throwsA(anything));
  });
}
