import 'dart:convert';
import 'dart:typed_data';
import 'payment_invoice.dart';
import 'receipt_print_native.dart'
    if (dart.library.js_interop) 'receipt_print_web.dart'
    as platform;
import 'sales_presentation.dart';

String _text(dynamic value) {
  final text = (value ?? '').toString().trim();
  return const HtmlEscape().convert(text.isEmpty ? 'Not recorded' : text);
}

String _privateValue(dynamic label, dynamic value) {
  final text = (value ?? '').toString().trim();
  if (text.isNotEmpty &&
      text != 'Not recorded' &&
      RegExp(
        r'document.*(?:number|id)|passport.*(?:number|no)|identity.*(?:number|id)|customer.*id|subscriber.*id|emirates.*id|national.*id|^id(?:\s|$)',
        caseSensitive: false,
      ).hasMatch(label.toString())) {
    return '•••• ${text.length > 4 ? text.substring(text.length - 4) : text}';
  }
  return text.isEmpty ? 'Not recorded' : text;
}

/// All receipt sections are included on paper, even when collapsed in the app.
String receiptPrintDocument(Map<String, dynamic> capture) {
  final intake = capture['intake'] as Map? ?? {};
  final sale = intake['capture_mode'] == 'SCREENSHOT_SALE';
  final payment = capture['document_kind'] == 'PAYMENT_CONFIRMATION';
  final projected =
      capture['invoice'] as Map? ??
      (sale || payment
          ? paymentInvoice(capture)
          : {
              'heading': capture['status'] == 'VERIFIED'
                  ? 'Receipt verified'
                  : capture['status'] == 'REJECTED'
                  ? 'Correction required'
                  : 'Final review pending',
              'status': capture['status'] == 'VERIFIED'
                  ? 'Verified'
                  : 'Pending backend verification',
              'sections': [
                {
                  'title': 'Receipt',
                  'fields': [
                    {
                      'label': 'Reference',
                      'value': capture['source_reference'],
                    },
                    {'label': 'Date', 'value': capture['created_at']},
                  ],
                },
                {
                  'title': 'Customer & plan',
                  'fields': [
                    for (final entry in {
                      'name': 'Customer name',
                      'document_number': 'Document number',
                      'msisdn': 'Phone number',
                      'plan_name': 'Plan',
                      'sim_identifier': 'SIM serial',
                    }.entries)
                      {'label': entry.value, 'value': intake[entry.key]},
                  ],
                },
                {
                  'title': 'Captured details',
                  'fields': [
                    for (final row in capture['rows'] as List? ?? [])
                      ...row['fields'] as List? ?? [],
                  ],
                },
              ],
            });
  final title = sale
      ? 'Sale receipt'
      : payment
      ? 'Payment invoice'
      : 'Activation receipt';
  final status = sale ? activationLabel(capture) : projected['heading'];
  final sections = projected['sections'] as List? ?? [];
  final content = sections.map((section) {
    final fields = section['fields'] as List? ?? [];
    final cells = fields
        .map(
          (field) =>
              '<tr><th>${_text(field['label'])}</th><td>${_text(_privateValue(field['label'], field['value']))}</td></tr>',
        )
        .join();
    return '<section><h2>${_text(section['title'])}</h2><table><tbody>$cells</tbody></table></section>';
  }).join();
  return '''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Qanawat ${_text(title)}</title><style>
@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#242738;font:12px/1.4 Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:12px;border-bottom:2px solid #85254f}header img{width:210px;height:auto}header div{text-align:right}h1{font-size:20px;margin:0 0 4px}h2{font-size:12px;margin:0;padding:7px 10px;background:#f4edf2;color:#722044;border-bottom:1px solid #e1d8df}
.status{margin:12px 0;border:1px solid #c8d7d2;background:#effaf6;padding:10px;font-size:13px;font-weight:bold}.reference{font-size:11px;color:#5d6575;overflow-wrap:anywhere}
main{columns:2;column-gap:14px}section{margin:0 0 12px;border:1px solid #dddfe6;border-radius:5px;overflow:hidden;break-inside:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed}tr{break-inside:avoid}th,td{padding:6px 9px;text-align:left;vertical-align:top;border-bottom:1px solid #e6e8ee;overflow-wrap:anywhere}th{width:43%;font-size:10px;color:#596274;font-weight:normal}td{font-size:11px;font-weight:600}tr:last-child th,tr:last-child td{border:0}
footer{border-top:1px solid #dfe2e9;padding-top:9px;color:#687082;font-size:10px;margin-top:8px}@media(max-width:600px){main{columns:1}}@media print{main{columns:2}}
</style></head><body><header><img src="/mobile-demo/assets/assets/branding/qanawat-logo.png" alt="Qanawat Connect Solutions LLC"><div><h1>${_text(title)}</h1><div class="reference">${_text(capture['source_reference'] ?? capture['id'])}</div></div></header><div class="status">${_text(status)}</div><main>$content</main><footer>Qanawat Connect Solutions LLC · ${_text(projected['status'])}</footer></body></html>''';
}

Future<void> printSaleReceipt(
  Uint8List bytes,
  Map<String, dynamic> capture,
  String filename,
) => platform.printReceiptBytes(bytes, receiptPrintDocument(capture), filename);
