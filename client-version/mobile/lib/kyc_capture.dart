import 'kyc_journey.dart';
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dio/dio.dart';
import 'package:share_plus/share_plus.dart';
import 'package:uuid/uuid.dart';
import 'services.dart';

class KycCaptureScreen extends ConsumerStatefulWidget {
  const KycCaptureScreen({super.key});
  @override
  ConsumerState<KycCaptureScreen> createState() => _KycCaptureState();
}

class _KycCaptureState extends ConsumerState<KycCaptureScreen> {
  final source = TextEditingController();
  final formKey = GlobalKey();
  final historyKey = GlobalKey();
  Uint8List? bytes;
  String operation = const Uuid().v4();
  List<Json> captures = [], rows = [];
  Json? capture;
  String? error;
  bool busy = false, pending = false, dirty = false, loading = true;
  Timer? timer;
  String get key => 'kyc-draft-${ref.read(serviceProvider).user?['id']}';
  @override
  void initState() {
    super.initState();
    Future.microtask(initialize);
    timer = Timer.periodic(const Duration(seconds: 12), (_) {
      if (!busy) {
        if (pending) {
          upload();
        } else {
          refresh();
        }
      }
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    source.dispose();
    super.dispose();
  }

  Future<void> initialize() async {
    try {
      final saved = await ref.read(serviceProvider).store.get(key);
      if (saved != null && mounted) {
        source.text = saved['reference'] ?? '';
        bytes = saved['image'] == null ? null : base64Decode(saved['image']);
        operation = saved['operation'];
        pending = saved['pending'] == true;
      }
      await refresh();
    } catch (e) {
      if (mounted) setState(() => error = friendlyError(e));
    }
  }

  Future<void> saveDraft() async {
    await ref.read(serviceProvider).store.put(key, {
      'reference': source.text,
      'image': bytes == null ? null : base64Encode(bytes!),
      'operation': operation,
      'pending': pending,
    });
  }

  Future<void> refresh() async {
    try {
      final s = ref.read(serviceProvider);
      final result = await s.dio.get('/kyc-captures');
      Json? next;
      final requestedId = capture?['id'];
      if (capture != null) {
        next = Map<String, dynamic>.from(
          (await s.dio.get('/kyc-captures/${capture!['id']}')).data,
        );
      }
      if (mounted) {
        setState(() {
          captures = (result.data as List)
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
          if (next != null && capture?['id'] == requestedId) {
            capture = next;
            if (!dirty) {
              rows = (next['rows'] as List)
                  .map((e) => Map<String, dynamic>.from(e))
                  .toList();
            }
          }
          loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          loading = false;
          error =
              'Cannot reach the backend. Your saved screenshot remains on this device.';
        });
      }
    }
  }

  Future<void> act(Future<void> Function() action) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted) setState(() => error = friendlyError(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> pick(ImageSource from) async {
    await act(() async {
      final f = await ImagePicker().pickImage(
        source: from,
        maxWidth: from == ImageSource.camera ? 2000 : null,
        maxHeight: from == ImageSource.camera ? 2400 : null,
        imageQuality: from == ImageSource.camera ? 90 : null,
      );
      if (f == null) return;
      final data = await f.readAsBytes();
      if (data.length > 4000000) {
        throw Exception('Choose a PNG or JPEG image below 4 MB.');
      }
      if (!mounted) return;
      setState(() {
        bytes = data;
        operation = const Uuid().v4();
        pending = false;
      });
      await saveDraft();
    });
  }

  Future<void> upload() async {
    if (bytes == null || source.text.trim().length < 2 || busy) return;
    await act(() async {
      pending = true;
      await saveDraft();
      final s = ref.read(serviceProvider);
      try {
        final result = await s.dio.post(
          '/kyc-captures',
          data: {
            'agent_id': s.user!['agent_id'],
            'source_reference': source.text.trim(),
            'operation_id': operation,
            'image_base64': base64Encode(bytes!),
          },
        );
        await s.store.remove(key);
        if (!mounted) return;
        setState(() {
          capture = Map<String, dynamic>.from(result.data);
          rows = [];
          dirty = false;
          pending = false;
          bytes = null;
          source.clear();
          operation = const Uuid().v4();
        });
        await refresh();
      } on DioException catch (e) {
        if (e.response != null &&
            e.response!.statusCode != 429 &&
            e.response!.statusCode! < 500) {
          pending = false;
          await saveDraft();
        }
        rethrow;
      }
    });
  }

  Future<void> open(Json entry) async {
    if (dirty) {
      final leave = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Discard unsaved rows?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: const Text('Keep editing'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(c, true),
              child: const Text('Discard'),
            ),
          ],
        ),
      );
      if (leave != true) return;
    }
    await act(() async {
      final result = await ref
          .read(serviceProvider)
          .dio
          .get('/kyc-captures/${entry['id']}');
      if (mounted) {
        setState(() {
          capture = Map<String, dynamic>.from(result.data);
          rows = (capture!['rows'] as List)
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
          dirty = false;
        });
      }
    });
  }

  Future<void> command(String action) async {
    await act(() async {
      final response = await ref
          .read(serviceProvider)
          .dio
          .post(
            '/kyc-captures/${capture!['id']}/$action',
            data: {'version': capture!['version']},
          );
      if (mounted) {
        setState(() => capture = Map<String, dynamic>.from(response.data));
      }
      await refresh();
    });
  }

  Future<void> export(String type) async {
    await act(() async {
      final id = capture!['id'];
      final response = await ref
          .read(serviceProvider)
          .dio
          .get<List<int>>(
            '/kyc-captures/$id/$type',
            options: Options(responseType: ResponseType.bytes),
          );
      final ext = type == 'excel'
          ? 'xlsx'
          : capture!['image_type'] == 'image/jpeg'
          ? 'jpg'
          : 'png';
      await SharePlus.instance.share(
        ShareParams(
          files: [
            XFile.fromData(
              Uint8List.fromList(response.data!),
              name: 'kyc-$id.$ext',
            ),
          ],
          fileNameOverrides: ['kyc-$id.$ext'],
        ),
      );
    });
  }

  Widget gap() => const SizedBox(height: 16);
  @override
  Widget build(BuildContext context) {
    final editable =
        capture != null &&
        ['EXTRACTED', 'VALIDATED', 'REJECTED'].contains(capture!['status']);
    return Scaffold(
      appBar: AppBar(
        title: const Text('KYC capture'),
        actions: [
          IconButton(
            onPressed: busy ? null : refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          KycJourneyGuide(
            onHistory: () => Scrollable.ensureVisible(
              historyKey.currentContext!,
              duration: const Duration(milliseconds: 300),
            ),
            onCapture: () => Scrollable.ensureVisible(
              formKey.currentContext!,
              duration: const Duration(milliseconds: 300),
            ),
          ),
          gap(),
          if (error != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Text(error!, style: const TextStyle(color: Colors.red)),
              ),
            ),
          Card(
            key: formKey,
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'New transaction capture',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 3),
                  const Text(
                    'PNG or JPEG · up to 4 MB',
                    style: TextStyle(fontSize: 13, color: Color(0xFF596675)),
                  ),
                  gap(),
                  TextField(
                    controller: source,
                    maxLength: 120,
                    enabled: !busy && !pending,
                    decoration: const InputDecoration(
                      labelText: 'Source transaction reference',
                    ),
                    onChanged: (_) {
                      saveDraft();
                      setState(() {});
                    },
                  ),
                  gap(),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: busy || pending
                              ? null
                              : () => pick(ImageSource.camera),
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size(0, 62),
                            padding: const EdgeInsets.symmetric(vertical: 7),
                          ),
                          child: const Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.camera_alt_outlined, size: 20),
                              SizedBox(height: 3),
                              Text(
                                'Take photo',
                                maxLines: 1,
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton(
                          onPressed: busy || pending
                              ? null
                              : () => pick(ImageSource.gallery),
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size(0, 62),
                            padding: const EdgeInsets.symmetric(vertical: 7),
                          ),
                          child: const Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.upload, size: 20),
                              SizedBox(height: 3),
                              Text(
                                'Upload',
                                maxLines: 1,
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (bytes != null) ...[
                    gap(),
                    Image.memory(
                      bytes!,
                      height: 180,
                      fit: BoxFit.contain,
                      errorBuilder: (_, e, st) => const Text(
                        'Image preview unavailable. Choose a PNG or JPEG.',
                      ),
                    ),
                    gap(),
                    const Text('Screenshot saved encrypted on this device.'),
                    gap(),
                  ],
                  FilledButton(
                    onPressed:
                        busy || bytes == null || source.text.trim().length < 2
                        ? null
                        : upload,
                    child: Text(
                      busy
                          ? 'Working…'
                          : pending
                          ? 'Retry queued upload'
                          : 'Upload & run VPS OCR',
                    ),
                  ),
                  if (pending)
                    const Padding(
                      padding: EdgeInsets.only(top: 10),
                      child: Text(
                        'Upload queued locally. Automatic retry while this screen is open; reopen it after restarting to resume.',
                      ),
                    ),
                ],
              ),
            ),
          ),
          gap(),
          Card(
            key: historyKey,
            child: ExpansionTile(
              key: ValueKey('history-${capture?['id'] ?? 'new'}'),
              initiallyExpanded: false,
              title: const Text('Capture history'),
              subtitle: Text('${captures.length} recent captures'),
              children: [
                if (loading) const LinearProgressIndicator(),
                if (!loading && captures.isEmpty)
                  const ListTile(title: Text('No uploaded captures yet.')),
                ...captures.map(
                  (r) => ListTile(
                    title: Text(r['source_reference']),
                    subtitle: Text(r['status']),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: busy ? null : () => open(r),
                  ),
                ),
              ],
            ),
          ),
          if (capture != null) ...[
            gap(),
            const Divider(),
            Text(
              capture!['source_reference'],
              style: Theme.of(context).textTheme.titleLarge,
            ),
            gap(),
            Text(
              'Status: ${capture!['status']}',
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
            gap(),
            if (capture!['status'] == 'QUEUED')
              const Text(
                'Image saved. VPS OCR is processing. You can return later.',
              ),
            if (capture!['status'] == 'OCR_FAILED') ...[
              Text(capture!['error']),
              TextButton(
                onPressed: busy ? null : () => command('retry'),
                child: const Text('Retry VPS OCR'),
              ),
            ],
            OutlinedButton(
              onPressed: busy ? null : () => export('original'),
              child: const Text('Download / share original'),
            ),
            if ((capture!['lines'] as List? ?? []).isNotEmpty)
              ExpansionTile(
                title: const Text('Extracted OCR lines'),
                initiallyExpanded: rows.isEmpty,
                children: [
                  ...(capture!['lines'] as List).asMap().entries.map(
                    (entry) => ListTile(
                      title: Text(entry.value['text']),
                      subtitle: Text(
                        'Line ${entry.key + 1} · ${entry.value['confidence']}% confidence',
                      ),
                      trailing: editable
                          ? IconButton(
                              icon: const Icon(Icons.add),
                              onPressed: rows.length >= 100
                                  ? null
                                  : () {
                                      setState(() {
                                        rows.add({
                                          'reference': '',
                                          'customer': '',
                                          'account': '',
                                          'details': entry.value['text'],
                                          'source_line': entry.key,
                                        });
                                        dirty = true;
                                      });
                                    },
                            )
                          : null,
                    ),
                  ),
                ],
              ),
            gap(),
            Text(
              'Transaction rows',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            ...rows.asMap().entries.map((entry) {
              final i = entry.key, r = entry.value;
              return Card(
                key: ValueKey(
                  '${capture!['id']}-$i-${rows.length}-${capture!['version']}',
                ),
                margin: const EdgeInsets.symmetric(vertical: 10),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Text('Transaction ${i + 1}'),
                      gap(),
                      ...['reference', 'customer', 'account', 'details'].map(
                        (field) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: TextFormField(
                            initialValue: r[field],
                            enabled: !busy,
                            readOnly: !editable,
                            maxLength: field == 'details'
                                ? 1000
                                : field == 'account'
                                ? 80
                                : 120,
                            maxLines: field == 'details' ? 3 : 1,
                            decoration: InputDecoration(
                              counterText: editable ? null : '',
                              labelText: {
                                'reference': 'Transaction reference',
                                'customer': 'Customer',
                                'account': 'Account / MSISDN',
                                'details': 'Transaction details',
                              }[field],
                            ),
                            onChanged: (value) {
                              setState(() {
                                rows[i][field] = value;
                                dirty = true;
                              });
                            },
                          ),
                        ),
                      ),
                      if (editable)
                        TextButton(
                          onPressed: () {
                            setState(() {
                              rows.removeAt(i);
                              dirty = true;
                            });
                          },
                          child: const Text('Remove row'),
                        ),
                    ],
                  ),
                ),
              );
            }),
            if (editable) ...[
              OutlinedButton(
                onPressed: rows.length >= 100
                    ? null
                    : () {
                        setState(() {
                          rows.add({
                            'reference': '',
                            'customer': '',
                            'account': '',
                            'details': '',
                            'source_line': null,
                          });
                          dirty = true;
                        });
                      },
                child: const Text('Add transaction row'),
              ),
              gap(),
              FilledButton(
                onPressed: busy || rows.isEmpty
                    ? null
                    : () => act(() async {
                        if (rows.any(
                          (r) =>
                              r['reference'].toString().trim().length < 2 ||
                              r['details'].toString().trim().length < 2,
                        )) {
                          throw Exception(
                            'Each row needs a reference and transaction details.',
                          );
                        }
                        final result = await ref
                            .read(serviceProvider)
                            .dio
                            .patch(
                              '/kyc-captures/${capture!['id']}/rows',
                              data: {
                                'version': capture!['version'],
                                'rows': rows,
                                'reason':
                                    'Reviewed against original screenshot on mobile',
                              },
                            );
                        if (mounted) {
                          setState(() {
                            capture = Map<String, dynamic>.from(result.data);
                            dirty = false;
                          });
                        }
                      }),
                child: const Text('Save & validate rows'),
              ),
            ],
            if ((capture!['rows'] as List? ?? []).isNotEmpty &&
                capture!['status'] != 'EXTRACTED') ...[
              gap(),
              OutlinedButton(
                onPressed: busy || dirty ? null : () => export('excel'),
                child: const Text('Generate / share Excel'),
              ),
            ],
            if (capture!['status'] == 'VALIDATED')
              FilledButton(
                onPressed: busy || dirty ? null : () => command('submit'),
                child: const Text('Submit to backend team'),
              ),
            if (capture!['review'] != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 18),
                child: Text(
                  '${capture!['review']['outcome']}: ${capture!['review']['reason']}',
                ),
              ),
            gap(),
            const Text(
              'History',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            ...(capture!['history'] as List? ?? []).map(
              (event) => ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(event['action']),
                subtitle: Text('${event['actor']} · ${event['at']} UTC'),
              ),
            ),
          ],
          gap(),
        ],
      ),
    );
  }
}
