import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:archive/archive.dart';
import 'package:relay_agent/preview_main.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('preview actions stay isolated and workbook uses edited rows', () async {
    final s = PreviewService(
      jsonDecode(File('assets/demo/workspace.json').readAsStringSync()),
    );
    addTearDown(s.dispose);
    expect(s.isPreview, true);
    expect((await s.dashboard())['today'], 12);
    await s.completeTask('task-0');
    expect((await s.proposalList('field-tasks')).first['status'], 'DONE');
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
