import 'payment_invoice.dart';
import 'dart:convert';
import 'package:archive/archive.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'main.dart' as app;
import 'services.dart';

// Separate build entry point. Only the public plan catalog uses the hosted API.
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SemanticsBinding.instance.ensureSemantics();
  final data =
      jsonDecode(await rootBundle.loadString('assets/demo/workspace.json'))
          as Json;
  runApp(
    ProviderScope(
      overrides: [serviceProvider.overrideWith((ref) => PreviewService(data))],
      child: const app.RelayApp(),
    ),
  );
}

Uint8List previewReceiptPdf(Json row) {
  final intake = row['intake'] as Map? ?? {};
  final status = row['status'] == 'VERIFIED'
      ? 'SUCCESS - RECEIPT VERIFIED'
      : row['status'] == 'REJECTED'
      ? 'CORRECTION REQUIRED'
      : 'FINAL REVIEW PENDING';
  final lines = [
    row['document_kind'] == 'PAYMENT_CONFIRMATION'
        ? 'RELAY | PAYMENT INVOICE'
        : 'RELAY | ACTIVATION RECEIPT',
    row['document_kind'] == 'PAYMENT_CONFIRMATION'
        ? 'PAYMENT SUCCESSFUL - ${paymentInvoice(row)['status']}'
        : status,
    'Reference: ${row['source_reference']}',
    'Customer: ${intake['name'] ?? ''}',
    'Date: ${row['created_at'] ?? DateTime.now().toIso8601String()}',
    'ID: **** ${intake['document_number'].toString().length > 4 ? intake['document_number'].toString().substring(intake['document_number'].toString().length - 4) : ''}',
    'Phone: ${intake['msisdn'] ?? ''}',
    'SIM type: ${intake['sim_type'] == 'ESIM' ? 'eSIM' : 'Physical SIM'}',
    'SIM serial: ${intake['sim_identifier'] ?? ''}',
    'Plan: ${intake['plan_name'] ?? ''}',
    if (row['document_kind'] == 'PAYMENT_CONFIRMATION')
      for (final section in paymentInvoice(row)['sections'])
        for (final field in section['fields'])
          '${section['title']} / ${field['label']}: ${field['value']}',
    for (final item in row['rows'] as List? ?? [])
      for (final field in item['fields'] as List? ?? [])
        if (!RegExp(
          r'document|identity|passport|customer.*id|subscriber.*id|emirates.*id|national.*id|^id(?:\s|$)',
          caseSensitive: false,
        ).hasMatch(field['label'].toString()))
          '${field['label']}: ${field['value']}',
  ];
  String clean(String text) => text
      .replaceAll(RegExp(r'[^\x20-\x7E]'), ' ')
      .replaceAll('\\', '\\\\')
      .replaceAll('(', '\\(')
      .replaceAll(')', '\\)');
  final wrapped = <String>[];
  for (final line in lines) {
    final text = line.replaceAll(RegExp(r'[^\x20-\x7E]'), ' ');
    for (var start = 0; start < text.length; start += 88) {
      wrapped.add(text.substring(start, (start + 88).clamp(0, text.length)));
    }
  }
  final pageCount = (wrapped.length / 56).ceil().clamp(1, 1000);
  final objects = <String>[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [${List.generate(pageCount, (i) => "${4 + i * 2} 0 R").join(" ")}] /Count $pageCount >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (var page = 0; page < pageCount; page++) {
    final chunk = wrapped.skip(page * 56).take(56);
    final stream =
        'BT /F1 9 Tf 48 800 Td 12 TL ${chunk.map((v) => "(${clean(v)}) Tj T*").join(" ")} (Page ${page + 1} of $pageCount) Tj ET';
    objects.add(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + page * 2} 0 R >>',
    );
    objects.add('<< /Length ${stream.length} >>\nstream\n$stream\nendstream');
  }
  var pdf = '%PDF-1.4\n';
  final offsets = <int>[0];
  for (var i = 0; i < objects.length; i++) {
    offsets.add(pdf.length);
    pdf += '${i + 1} 0 obj\n${objects[i]}\nendobj\n';
  }
  final xref = pdf.length;
  pdf += 'xref\n0 ${objects.length + 1}\n0000000000 65535 f \n';
  for (final offset in offsets.skip(1)) {
    pdf += '${offset.toString().padLeft(10, '0')} 00000 n \n';
  }
  pdf +=
      'trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n$xref\n%%EOF';
  return Uint8List.fromList(ascii.encode(pdf));
}

class PreviewStore extends OfflineStore {
  final values = <String, Json>{};
  @override
  Future<void> initialize() async {}
  @override
  Future<Json?> get(String id) async => values[id];
  @override
  Future<void> put(String id, Json value) async {
    values[id] = value;
  }

  @override
  Future<void> remove(String id) async {
    values.remove(id);
  }

  @override
  Future<void> clear() async {
    values.clear();
  }
}

class PreviewService extends RelayService {
  final Json data;
  final memory = PreviewStore();
  final publicApi = Dio(
    BaseOptions(
      connectTimeout: const Duration(seconds: 5),
      receiveTimeout: const Duration(seconds: 6),
    ),
  );
  @override
  OfflineStore get store => memory;
  @override
  bool get isPreview => true;
  PreviewService(this.data) {
    user = Map<String, dynamic>.from(data['user']);
    ready = true;
    dio.interceptors.clear();
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (o, h) async {
          try {
            final result = await dispatch(o);
            h.resolve(
              Response(requestOptions: o, data: result, statusCode: 200),
            );
          } catch (e) {
            h.reject(
              DioException(
                requestOptions: o,
                response: Response(
                  requestOptions: o,
                  statusCode: 400,
                  data: {'detail': e.toString()},
                ),
              ),
            );
          }
        },
      ),
    );
  }
  @override
  Future<void> initialize() async {}
  @override
  Future<void> login(String email, String password) async {
    user = Map<String, dynamic>.from(data['user']);
    notifyListeners();
  }

  @override
  Future<void> logout() async {
    user = null;
    await memory.clear();
    notifyListeners();
  }

  @override
  Future<void> sync() async {
    syncing = true;
    notifyListeners();
    await Future<void>.delayed(const Duration(milliseconds: 350));
    syncing = false;
    notifyListeners();
  }

  @override
  Future<Uint8List> previewReceipt() async =>
      (await rootBundle.load('assets/demo/receipt.png')).buffer.asUint8List();
  Future<dynamic> dispatch(RequestOptions o) async {
    await Future<void>.delayed(const Duration(milliseconds: 180));
    final path = o.path;
    final body = o.data is Map
        ? Map<String, dynamic>.from(o.data)
        : <String, dynamic>{};
    if (path == '/health') return {'status': 'ok'};
    if (path.startsWith('/agents/') && path.endsWith('/shift')) {
      data['/resources/agents'][0]['on_shift'] = body['action'] == 'start';
      data['/dashboard']['agents'][0]['on_shift'] = body['action'] == 'start';
      return {};
    }
    if (path.startsWith('/field-tasks/') && o.method == 'PATCH') {
      final row = (data['/field-tasks'] as List).firstWhere(
        (r) => r['id'] == path.split('/')[2],
      );
      row['status'] = 'DONE';
      data['/dashboard']['tasks_open'] = (data['/field-tasks'] as List)
          .where((r) => r['status'] == 'OPEN')
          .length;
      return row;
    }
    if (path.startsWith('/inventory/') && path.endsWith('/move')) {
      final row = (data['/resources/inventory'] as List).firstWhere(
        (r) => r['id'] == path.split('/')[2],
      );
      row['status'] = body['status'];
      data['/dashboard']['stock'] = (data['/resources/inventory'] as List)
          .where((r) => r['status'] == 'AVAILABLE')
          .length;
      return row;
    }
    if (path == '/support-tickets' && o.method == 'POST') {
      final row = {
        ...body,
        'id': 'support-${DateTime.now().microsecondsSinceEpoch}',
        'created_at': DateTime.now().toIso8601String(),
        'status': 'OPEN',
      };
      (data[path] as List).insert(0, row);
      return row;
    }
    if (path == '/kyc-captures/draft') {
      if (o.method == 'PUT') {
        data[path] = {'version': body['version'] + 1, 'data': body['data']};
      }
      return data[path] ?? {'version': 0, 'data': <String, dynamic>{}};
    }
    if (path == '/kyc-captures/read-document') {
      return {
        'name': 'Alex Sample',
        'document_number': 'SAMPLE-ID-1001',
        'nationality': 'United Arab Emirates',
        'birth_date': '1990-01-01',
        'expiry_date': '2030-12-31',
      };
    }
    if (path == '/resources/plans') {
      try {
        final url = Uri.base.resolve('/api/public/plans').toString();
        final response = await publicApi.get<List<dynamic>>(url);
        data['/resources/plans'] = response.data ?? const <Json>[];
        return data['/resources/plans'];
      } on DioException {
        // Keep the preview usable offline; online edits come from the shared catalog.
      }
      return [
        {
          'id': 'zip-5g-unlimited',
          'name': '5G Unlimited Ultra',
          'monthly_cost': 350,
          'promotion': 'Unlimited 5G Data + 1500 Flexi Mins',
        },
        {
          'id': 'zip-flexi-postpaid',
          'name': 'Flexi Postpaid',
          'monthly_cost': 250,
          'promotion': '100GB 5G Data + 500 Local Mins',
        },
        {
          'id': 'zip-tourist-prepaid',
          'name': 'Tourist Prepaid',
          'monthly_cost': 199,
          'promotion': '50GB High Speed + Free Roaming',
        },
        {
          'id': 'zip-enterprise-m2m',
          'name': 'Enterprise M2M',
          'monthly_cost': 85,
          'promotion': 'Telemetry VPN + Fixed IP',
        },
      ];
    }
    if (path.startsWith('/kyc-captures')) {
      final captures = data['/kyc-captures'] as List;
      if (path == '/kyc-captures') {
        if (o.method == 'POST') {
          final template = jsonDecode(jsonEncode(captures.last)) as Json;
          template.addAll({
            'id': 'capture-${DateTime.now().microsecondsSinceEpoch}',
            'source_reference': body['source_reference'],
            'status': 'EXTRACTED',
            'version': 1,
            'review': null,
            'intake': body['intake'],
            'document_kind': body['document_kind'],
            'payment_reference': body['source_reference'],
            'created_at': DateTime.now().toIso8601String(),
            'plan_snapshot': (data['/resources/plans'] as List? ?? [])
                .firstWhere(
                  (p) => p['id'] == body['intake']?['plan_id'],
                  orElse: () => <String, dynamic>{},
                ),
            'history': [
              {
                'action': 'Receipt details prepared',
                'actor': 'Preview',
                'at': DateTime.now().toIso8601String(),
              },
            ],
          });
          captures.insert(0, template);
          if (template['document_kind'] == 'PAYMENT_CONFIRMATION') {
            template['invoice'] = paymentInvoice(template);
          }
          return template;
        }
        return captures;
      }
      final parts = path.split('/');
      final row = captures.firstWhere((r) => r['id'] == parts[2]);
      if (parts.length > 3) {
        final action = parts[3];
        if (action == 'original') return await previewReceipt();
        if (action == 'receipt') return previewReceiptPdf(row);
        if (action == 'excel') return previewWorkbook(row['rows'] as List);
        if (action == 'rows') {
          row['rows'] = body['rows'];
          row['status'] = 'VALIDATED';
        }
        if (action == 'retry') row['status'] = 'EXTRACTED';
        if (action == 'submit') {
          row['status'] = 'SUBMITTED';
        }
        row['version']++;
        (row['history'] as List).add({
          'action': 'Receipt $action',
          'actor': 'Zayn Mercer',
          'at': DateTime.now().toIso8601String(),
        });
      }
      if (row['document_kind'] == 'PAYMENT_CONFIRMATION') {
        row['invoice'] = paymentInvoice(row);
      }
      return row;
    }
    if (o.method == 'GET' && data.containsKey(path)) return data[path];
    throw StateError('This action is unavailable in the preview.');
  }
}

Uint8List previewWorkbook(List rows) {
  final zip = Archive();
  void add(String name, String text) {
    final bytes = utf8.encode(text);
    zip.addFile(ArchiveFile(name, bytes.length, bytes));
  }

  String escape(Object? v) => const HtmlEscape().convert(v?.toString() ?? '');
  final dynamicFields = rows.any((r) => r['fields'] is List);
  final values = dynamicFields
      ? <List<dynamic>>[
          ['Transaction', 'Field', 'Value'],
          for (final entry in rows.asMap().entries)
            for (final field
                in (entry.value['fields'] as List? ??
                    [
                      for (final key in [
                        'reference',
                        'customer',
                        'account',
                        'details',
                      ])
                        {'label': key, 'value': entry.value[key]},
                    ]))
              ['${entry.key + 1}', field['label'], field['value']],
        ]
      : [
          ['Reference', 'Customer', 'Account', 'Details'],
          ...rows.map(
            (r) => [r['reference'], r['customer'], r['account'], r['details']],
          ),
        ];
  // Inline string cells intentionally preserve text and prevent formula execution.
  // ignore: prefer_interpolation_to_compose_strings
  final xml = values
      .asMap()
      .entries
      .map(
        (e) =>
            // ignore: prefer_interpolation_to_compose_strings
            '<row r="${e.key + 1}">' +
            e.value
                .asMap()
                .entries
                .map(
                  (c) =>
                      '<c r="${String.fromCharCode(65 + c.key)}${e.key + 1}" t="inlineStr"><is><t xml:space="preserve">${escape(c.value)}</t></is></c>',
                )
                .join() +
            '</row>',
      )
      .join();
  add(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  );
  add(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  add(
    'xl/workbook.xml',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Receipts" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  add(
    'xl/_rels/workbook.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  add(
    'xl/worksheets/sheet1.xml',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>$xml</sheetData></worksheet>',
  );
  return Uint8List.fromList(ZipEncoder().encode(zip));
}
