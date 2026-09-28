import 'dart:convert';
import 'package:archive/archive.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'main.dart' as app;
import 'services.dart';

// Separate build entry point. No credentials or requests to the hosted API.
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
            'history': [
              {
                'action': 'Demo extraction completed (simulated)',
                'actor': 'Preview',
                'at': DateTime.now().toIso8601String(),
              },
            ],
          });
          captures.insert(0, template);
          return template;
        }
        return captures;
      }
      final parts = path.split('/');
      final row = captures.firstWhere((r) => r['id'] == parts[2]);
      if (parts.length > 3) {
        final action = parts[3];
        if (action == 'original') return await previewReceipt();
        if (action == 'excel') return previewWorkbook(row['rows'] as List);
        if (action == 'rows') {
          row['rows'] = body['rows'];
          row['status'] = 'VALIDATED';
        }
        if (action == 'retry') row['status'] = 'EXTRACTED';
        if (action == 'submit') {
          row['status'] = 'SUBMITTED';
          Future<void>.delayed(const Duration(seconds: 3), () {
            row['status'] = 'VERIFIED';
            row['review'] = {
              'outcome': 'VERIFIED',
              'reason': 'Simulated reviewer approval in this browser demo.',
            };
            row['version']++;
          });
        }
        row['version']++;
        (row['history'] as List).add({
          'action': 'Demo $action',
          'actor': 'Zayn Mercer',
          'at': DateTime.now().toIso8601String(),
        });
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
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Demo receipts" sheetId="1" r:id="rId1"/></sheets></workbook>',
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
