import 'payment_invoice.dart';
import 'dart:convert';
import 'dart:ui' as ui;
import 'package:archive/archive.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'main.dart' as app;
import 'services.dart';

// Separate build entry point. All signed-in actions use the shared hosted API.
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SemanticsBinding.instance.ensureSemantics();
  runApp(
    ProviderScope(
      overrides: [
        serviceProvider.overrideWith((ref) => SharedPreviewService()),
      ],
      child: const app.RelayApp(),
    ),
  );
}

// The phone demo selects explicitly enabled sample accounts on the server.
// Sessions and capture shortcuts still use the shared role-scoped API.
class SharedPreviewService extends RelayService {
  String? sampleReference;
  SharedPreviewService({String? baseUrl}) {
    dio.options.baseUrl = baseUrl ?? Uri.base.resolve('/api').toString();
  }
  @override
  bool get isPreview => true;
  @override
  bool get hasAccountPicker => true;
  @override
  String get refreshStorageKey => 'relay_mobile_demo_refresh_v1';
  @override
  Future<void> initialize() async {
    // Old preview sessions used native login and could replace portal cookies.
    // Discard that browser token locally; never refresh or revoke it remotely.
    await store.secure.delete(key: 'relay_refresh');
    await super.initialize();
  }

  @override
  Future<List<Json>> signInAccounts() async {
    final response = await dio.get('/auth/mobile-demo/accounts');
    return (response.data as List)
        .map((value) => Map<String, dynamic>.from(value))
        .toList();
  }

  @override
  Future<void> login(String email, String password) async {
    final response = await dio.post(
      '/auth/mobile-demo/login',
      data: {'email': email},
    );
    access = response.data['access_token'];
    user = Map<String, dynamic>.from(response.data['user']);
    await store.secure.write(
      key: refreshStorageKey,
      value: response.data['refresh_token'],
    );
    await sync();
    notifyListeners();
  }

  @override
  Future<Uint8List> previewIdentity() async =>
      (await rootBundle.load('assets/demo/identity.png')).buffer.asUint8List();
  @override
  Future<Uint8List> previewOrder() async {
    sampleReference = 'SAMPLE-REQ-${DateTime.now().microsecondsSinceEpoch}';
    return captureImage([
      'Order Details',
      'Order Type: NEW',
      'Product Name: Subscriber plan',
      'Package Name: 5G Unlimited Ultra',
      'MSISDN: 0500000000',
      'Request Id: $sampleReference',
      'Basic Plan: AED 350 Monthly - AED 0 Prepayment',
      'Grand Total: 350 Monthly / 0 Prepayment',
      'not including VAT',
    ]);
  }

  @override
  Future<Uint8List> previewReceipt({String? reference}) async => captureImage([
    'Success',
    'Order created successfully',
    'Request Id: ${reference ?? sampleReference ?? "Not recorded"}',
    'Customer: Avery Stone',
    'Date: ${DateTime.now().toIso8601String().substring(0, 10)}',
  ]);

  Future<Uint8List> captureImage(List<String> lines) async {
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    canvas.drawRect(
      const Rect.fromLTWH(0, 0, 1100, 800),
      Paint()..color = Colors.white,
    );
    var y = 50.0;
    for (var i = 0; i < lines.length; i++) {
      final text = TextPainter(
        text: TextSpan(
          text: lines[i],
          style: TextStyle(
            color: const Color(0xff17263c),
            fontSize: i == 0 ? 38 : 30,
            fontWeight: i == 0 ? FontWeight.bold : FontWeight.normal,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: 1000);
      text.paint(canvas, Offset(48, y));
      y += text.height + 30;
    }
    final picture = recorder.endRecording();
    final image = await picture.toImage(1100, 800);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    picture.dispose();
    return bytes!.buffer.asUint8List();
  }
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
        ? "${paymentInvoice(row)['heading'].toString().toUpperCase()} - ${paymentInvoice(row)['status']}"
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
    for (final row in data['/kyc-captures'] as List) {
      if (row['document_kind'] == 'PAYMENT_CONFIRMATION') {
        row['invoice'] = paymentInvoice(row);
      }
    }
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
  Future<Uint8List> previewReceipt({String? reference}) async =>
      (await rootBundle.load('assets/demo/payment.png')).buffer.asUint8List();
  @override
  Future<Uint8List> previewIdentity() async =>
      (await rootBundle.load('assets/demo/identity.png')).buffer.asUint8List();
  @override
  Future<Uint8List> previewOrder() async =>
      (await rootBundle.load('assets/demo/order.png')).buffer.asUint8List();
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
    if (path == '/inventory/scan') {
      return {
        'sim_identifier': 'SIM-SAMPLE-1001',
        'sim_type': 'PHYSICAL',
        'stage': 'IN_PROGRESS',
        'payment_status': 'NOT_UPLOADED',
      };
    }
    if (path.startsWith('/inventory/scan/')) return {'discarded': true};
    if (path == '/kyc-captures/saved-drafts') {
      final drafts = data.putIfAbsent(path, () => <Json>[]) as List;
      if (o.method == 'POST') {
        final values = Map<String, dynamic>.from(body['data']);
        final id =
            values['saved_draft_id'] ??
            'draft-${DateTime.now().microsecondsSinceEpoch}';
        values['saved_draft_id'] = id;
        drafts.removeWhere((r) => r['id'] == id);
        final row = {
          'id': id,
          'data': values,
          'created_at': DateTime.now().toIso8601String(),
        };
        drafts.insert(0, row);
        return row;
      }
      return drafts;
    }
    if (path.startsWith('/kyc-captures/saved-drafts/')) {
      (data['/kyc-captures/saved-drafts'] as List?)?.removeWhere(
        (r) => r['id'] == path.split('/').last,
      );
      return {'discarded': true};
    }
    if (path == '/kyc-captures/draft') {
      if (o.method == 'PUT') {
        data[path] = {'version': body['version'] + 1, 'data': body['data']};
      }
      return data[path] ?? {'version': 0, 'data': <String, dynamic>{}};
    }
    if (path == '/kyc-captures/read-document') {
      return {
        'name': 'Avery Stone',
        'document_number': 'SAMPLE-ID-1001',
        'document_check': 'preview-only-document',
        'nationality': 'United Arab Emirates',
        'birth_date': '1990-01-01',
        'expiry_date': '2030-12-31',
      };
    }
    if (path == '/kyc-captures/read-order') {
      final catalog = data['/resources/plans'] as List? ?? [];
      final plan = catalog.isNotEmpty
          ? catalog.first as Map
          : <String, dynamic>{};
      return {
        'order_reference': 'SAMPLE-REQ-1001',
        'msisdn': '0500000000',
        'product_name': 'Subscriber plan',
        'package_name': plan['name'] ?? 'Connect Plus',
        'monthly_cost': '${plan['monthly_cost'] ?? 150}',
        'prepayment': '0',
        'plan_id': plan['id'] ?? 'sample-plan',
        'plan_name': plan['name'] ?? 'Connect Plus',
        'order_check': 'preview-only-order',
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
      return data['/resources/plans'] ?? const <Json>[];
    }
    if (path.startsWith('/kyc-captures')) {
      final captures = data['/kyc-captures'] as List;
      if (path == '/kyc-captures') {
        if (o.method == 'POST') {
          final savedId = body['intake']?['saved_draft_id'];
          (data['/kyc-captures/saved-drafts'] as List?)?.removeWhere(
            (r) => r['id'] == savedId,
          );
          final template = jsonDecode(jsonEncode(captures.last)) as Json;
          template.addAll({
            'id': 'capture-${DateTime.now().microsecondsSinceEpoch}',
            'agent_id': user?['agent_id'],
            'source_reference': body['source_reference'],
            'status': 'SUBMITTED',
            'version': 1,
            'review': null,
            'intake': body['intake'],
            'document_kind': body['document_kind'],
            'payment_reference': 'PAY-CAPTURE-1001',
            'rows': [
              {
                'fields': [
                  {'label': 'Payment reference', 'value': 'PAY-CAPTURE-1001'},
                  {'label': 'Customer', 'value': 'Avery Stone'},
                  {'label': 'Total paid', 'value': 'AED 350.00'},
                  {'label': 'Payment method', 'value': 'Card'},
                  {'label': 'Date', 'value': '2026-09-29'},
                ],
              },
            ],
            'lines': [],
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
        return captures
            .where((row) => row['agent_id'] == user?['agent_id'])
            .toList();
      }
      final parts = path.split('/');
      final row = captures.firstWhere((r) => r['id'] == parts[2]);
      if (row['agent_id'] != user?['agent_id']) {
        throw StateError('Transaction unavailable');
      }
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
