import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/preview_main.dart';

class DemoCaptureText extends SharedPreviewService {
  DemoCaptureText() : super(baseUrl: 'http://127.0.0.1:1/api');
  @override
  Future<Uint8List> captureImage(List<String> lines) async =>
      Uint8List.fromList(utf8.encode(lines.join('\n')));
}

void main() {
  test(
    'demo order and its optional receipt contain one matching explicit sample SR',
    () async {
      final service = DemoCaptureText();
      addTearDown(service.dispose);
      final first = utf8.decode(await service.previewOrder());
      final reference = service.sampleReference!;
      final sr = service.demoSrForReference(reference);
      expect(first, contains('SR Number: $sr'));
      expect(sr, startsWith('SAMPLE-SR-'));
      expect(sr, isNot(reference));
      final receipt = utf8.decode(
        await service.previewReceipt(reference: reference),
      );
      expect(receipt, contains('SR Number: $sr'));
      await Future<void>.delayed(const Duration(milliseconds: 1));
      final next = utf8.decode(await service.previewOrder());
      expect(service.demoSrForReference(service.sampleReference), isNot(sr));
      expect(next, isNot(contains('SR Number: $sr')));
      // Resuming the first draft still generates evidence for that draft's own SR.
      expect(
        utf8.decode(await service.previewReceipt(reference: reference)),
        contains('SR Number: $sr'),
      );
    },
  );

  test('ordinary or missing request IDs do not invent sample SR values', () {
    final service = DemoCaptureText();
    addTearDown(service.dispose);
    for (final reference in [
      null,
      '',
      'REQ-123456',
      'SAMPLE-REQ-not-a-number',
    ]) {
      expect(service.demoSrForReference(reference), 'Not recorded');
    }
  });
}
