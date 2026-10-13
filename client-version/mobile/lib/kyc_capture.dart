import 'package:go_router/go_router.dart';
import 'receipt_reveal.dart';
import 'typography.dart';
import 'relay_theme.dart';
import 'payment_invoice.dart';
import 'customer_intake.dart';
import 'kyc_journey.dart';
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dio/dio.dart';
import 'package:uuid/uuid.dart';
import 'services.dart';
import 'experience.dart';
import 'role_access.dart';
import 'receipt_sr.dart';
import 'receipt_document.dart';
import 'ocr_jobs.dart';
import 'branding.dart';
import 'exports.dart';
import 'sales_presentation.dart';

class KycCaptureScreen extends ConsumerStatefulWidget {
  final Json initial;
  final String? captureId;
  const KycCaptureScreen({super.key, this.initial = const {}, this.captureId});
  @override
  ConsumerState<KycCaptureScreen> createState() => _KycCaptureState();
}

class _KycCaptureState extends ConsumerState<KycCaptureScreen> {
  static const connectionWarning =
      'Cannot reach the backend. Your saved screenshot remains on this device.';
  late final RelayService capturedService;
  final source = TextEditingController();
  final formKey = GlobalKey();
  final historyKey = GlobalKey();
  final receiptScroll = ScrollController();
  Uint8List? bytes;
  String? receiptOriginalSr;
  String? receiptSrNotice;
  bool receiptSrReading = false, receiptSrRetry = false;
  bool receiptSrMismatch = false, receiptSrUnclear = false;
  StageOcrRequest? receiptReadRequest;
  String operation = const Uuid().v4();
  List<Json> captures = [], rows = [];
  Json? capture;
  Json intake = {};
  bool intakeReady = false;
  String? error;
  bool busy = false, pending = false, dirty = false, loading = true;
  Timer? timer;
  String get key => 'kyc-draft-${ref.read(serviceProvider).user?['id']}';
  @override
  void initState() {
    super.initState();
    capturedService = ref.read(serviceProvider);
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
    if (capture == null &&
        !pending &&
        intake['transaction_id'] != null &&
        intake['saved_draft_id'] == null) {
      unawaited(
        capturedService.dio
            .delete('/inventory/scan/${intake['transaction_id']}')
            .catchError(
              (_) => Response(requestOptions: RequestOptions(path: '')),
            ),
      );
    }
    source.dispose();
    receiptScroll.dispose();
    super.dispose();
  }

  Future<void> initialize() async {
    try {
      if (widget.captureId != null) {
        final result = await ref
            .read(serviceProvider)
            .dio
            .get('/kyc-captures/${widget.captureId}');
        if (!mounted) return;
        setState(() {
          capture = Map<String, dynamic>.from(result.data);
          rows = (capture!['rows'] as List? ?? [])
              .map((row) => Map<String, dynamic>.from(row))
              .toList();
        });
        await refresh();
        return;
      }
      final saved = await ref.read(serviceProvider).store.get(key);
      if (saved != null && saved['pending'] == true && mounted) {
        source.text = saved['reference'] ?? '';
        intake = Map<String, dynamic>.from(saved['intake'] ?? {});
        intakeReady = saved['intakeReady'] == true;
        bytes = saved['image'] == null ? null : base64Decode(saved['image']);
        operation = saved['operation'];
        pending = saved['pending'] == true;
      }
      if (!pending) intake = Map<String, dynamic>.from(widget.initial);
      await refresh();
    } catch (e) {
      if (mounted) {
        setState(() {
          error = friendlyError(e);
          loading = false;
        });
      }
    }
  }

  Future<void> saveDraft() async {
    await ref.read(serviceProvider).store.put(key, {
      'reference': source.text,
      'intake': intake,
      'intakeReady': intakeReady,
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
          if (error == connectionWarning) error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          loading = false;
          error = connectionWarning;
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
      final service = ref.read(serviceProvider);
      if (service.isPreview) {
        final sample = await service.previewReceipt(
          reference: intake['order_reference']?.toString(),
        );
        if (!mounted) return;
        setState(() {
          bytes = sample;
          source.text = intake['order_reference']?.toString() ?? "";
          pending = false;
        });
        if (sample != null) await readReceiptSr(sample);
        await saveDraft();
        return;
      }
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
      await readReceiptSr(data);
      await saveDraft();
    });
  }

  Future<void> readReceiptSr(Uint8List image) async {
    if (intake['capture_mode'] != 'SCREENSHOT_SALE') return;
    receiptOriginalSr ??= (intake['receipt_sr_check'] ?? '').toString().isEmpty
        ? (intake['sr_number'] ?? '').toString()
        : '';
    intake.remove('receipt_sr_check');
    intake['sr_number'] = receiptOriginalSr;
    if (mounted) {
      setState(() {
        receiptSrReading = true;
        receiptSrRetry = false;
        receiptSrMismatch = false;
        receiptSrUnclear = false;
        receiptSrNotice = 'Reading SR number from receipt…';
      });
    }
    try {
      final selectedImage = base64Encode(image);
      final selectedOperation = operation;
      final request = receiptReadRequest?.image == selectedImage
          ? receiptReadRequest!
          : receiptReadRequest = StageOcrRequest('RECEIPT', selectedImage);
      final result = await request.read(
        ref.read(serviceProvider),
        isCurrent: () =>
            mounted &&
            selectedOperation == operation &&
            bytes != null &&
            base64Encode(bytes!) == selectedImage,
        onStatus: (message) {
          if (mounted) setState(() => receiptSrNotice = message);
        },
      );
      final fields = receiptSrFields(
        result,
        fallbackSr: receiptOriginalSr ?? '',
      );
      if (!mounted) return;
      setState(() {
        intake.addAll(fields);
        receiptSrMismatch = receiptSrConflict(result, receiptOriginalSr ?? '');
        receiptSrUnclear = result['sr_status'] == 'UNCLEAR';
        receiptSrNotice = receiptSrMismatch
            ? 'Receipt SR does not match the order · replace or remove receipt'
            : (fields['receipt_sr_check'] ?? '').toString().isNotEmpty
            ? 'SR number read from receipt'
            : receiptSrUnclear
            ? 'SR number unclear · use a clearer receipt photo'
            : (fields['sr_number'] ?? '').toString().trim().isNotEmpty
            ? 'SR number read from order · not shown on receipt'
            : 'SR number not shown on receipt';
      });
    } on OcrReadCancelled {
      return;
    } catch (failure) {
      // A terminal failure needs a new job; a temporary interruption retains
      // the original operation so retry does not create concurrent OCR work.
      if (failure is! OcrTemporaryFailure) receiptReadRequest = null;
      if (mounted) {
        setState(() {
          receiptSrRetry = true;
          receiptSrNotice =
              'SR could not be read · retry or use a clearer photo';
        });
      }
    } finally {
      if (mounted) setState(() => receiptSrReading = false);
    }
  }

  Future<void> retryReceiptSr() async {
    final image = bytes;
    if (image == null) return;
    await act(() async {
      await readReceiptSr(image);
      await saveDraft();
    });
  }

  Future<void> removeReceipt() async {
    await act(() async {
      setState(() {
        bytes = null;
        intake.remove('payment_image');
        intake.remove('receipt_sr_check');
        intake['sr_number'] = receiptOriginalSr ?? '';
        receiptReadRequest = null;
        receiptSrNotice = null;
        receiptSrRetry = false;
        receiptSrMismatch = false;
        receiptSrUnclear = false;
        operation = const Uuid().v4();
      });
      await saveDraft();
    });
  }

  Future<void> viewAttachedReceipt() async {
    final image = bytes;
    if (image == null) return;
    await showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .75,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Text('Payment receipt', style: RelayTypography.section),
              ),
              Expanded(
                child: InteractiveViewer(
                  maxScale: 5,
                  child: Center(
                    child: Image.memory(image, fit: BoxFit.contain),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(12),
                child: TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Close'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> upload() async {
    final saleFlow = intake['capture_mode'] == 'SCREENSHOT_SALE';
    if ((!saleFlow && bytes == null) || busy || receiptSrMismatch) return;
    await act(() async {
      pending = true;
      await saveDraft();
      final s = ref.read(serviceProvider);
      try {
        final result = await s.dio.post(
          saleFlow ? '/kyc-captures/sale-submissions' : '/kyc-captures',
          data: {
            'agent_id': s.user!['agent_id'],
            'source_reference': source.text.trim().isEmpty
                ? intake['order_reference'] ?? ''
                : source.text.trim(),
            if (!saleFlow) 'document_kind': 'PAYMENT_CONFIRMATION',
            'operation_id': operation,
            if (!saleFlow) 'image_base64': base64Encode(bytes!),
            'intake': {
              ...intake,
              if (saleFlow && bytes != null)
                'payment_image': base64Encode(bytes!),
            },
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
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && receiptScroll.hasClients) {
            receiptScroll.jumpTo(0);
          }
        });
        await refresh();
        ref.invalidate(dashboardProvider);
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
      if (capture == null) {
        throw StateError('Submit the sale first.');
      }
      final id = capture!['id'];
      final service = ref.read(serviceProvider);
      final response = await service.dio.get<List<int>>(
        '/kyc-captures/$id/$type',
        options: Options(responseType: ResponseType.bytes),
      );
      final ext = type == 'receipt'
          ? 'pdf'
          : type == 'excel'
          ? 'xlsx'
          : capture!['image_type'] == 'image/jpeg'
          ? 'jpg'
          : 'png';
      final file = ExportDocument.fromResponse(
        response,
        format: ext,
        fallbackFilename:
            'qanawat-${type == 'original'
                ? 'original-evidence'
                : type == 'excel'
                ? 'captured-details'
                : capture?['document_kind'] == 'PAYMENT_CONFIRMATION'
                ? 'reference-bill'
                : capture?['intake']?['capture_mode'] == 'SCREENSHOT_SALE'
                ? 'reference-bill'
                : 'sale-receipt'}-$id.$ext',
      );
      if (mounted) await file.share(context);
    });
  }

  Future<void> printReceipt() async {
    await act(() async {
      if (capture == null) throw StateError('Submit the sale first.');
      final service = ref.read(serviceProvider);
      final latest = await service.dio.get<Json>(
        '/kyc-captures/${capture!['id']}',
      );
      final current = Map<String, dynamic>.from(latest.data!);
      final response = await service.dio.get<List<int>>(
        '/kyc-captures/${current['id']}/receipt',
        options: Options(responseType: ResponseType.bytes),
      );
      final file = ExportDocument.fromResponse(
        response,
        format: 'pdf',
        fallbackFilename: 'qanawat-reference-bill-${current['id']}.pdf',
      );
      await printSaleReceipt(file.bytes, current, file.filename);
    });
  }

  Future<void> startNewTransaction() async {
    if (dirty &&
        !(await showDialog<bool>(
              context: context,
              builder: (c) => AlertDialog(
                title: const Text('Discard unsaved changes?'),
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
            ) ??
            false)) {
      return;
    }
    if (!mounted) return;
    context.push('/screenshot-capture');
  }

  String receiptDate(dynamic value) {
    final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    if (date == null) return '—';
    final labels = MaterialLocalizations.of(context);
    return '${labels.formatMediumDate(date)} · ${labels.formatTimeOfDay(TimeOfDay.fromDateTime(date))}';
  }

  List<Widget> receiptFields(Json row, bool editable) {
    final fields = row['fields'] as List;
    if (!editable) {
      return fields
          .map<Widget>(
            (f) => ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(
                f['label'],
                style: const TextStyle(fontSize: 13, color: Color(0xff6c6380)),
              ),
              subtitle: Text(
                f['value'],
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: Color(0xff302541),
                ),
              ),
            ),
          )
          .toList();
    }
    return [
      gap(),
      ...fields.map(
        (field) => Padding(
          key: ObjectKey(field),
          padding: const EdgeInsets.only(bottom: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextFormField(
                initialValue: field['label'],
                readOnly: !editable,
                enabled: !busy,
                maxLength: 120,
                decoration: const InputDecoration(
                  labelText: 'Field name',
                  counterText: '',
                ),
                onChanged: (v) => setState(() {
                  field['label'] = v;
                  dirty = true;
                }),
              ),
              const SizedBox(height: 12),
              TextFormField(
                initialValue: field['value'],
                readOnly: !editable,
                enabled: !busy,
                maxLength: 1000,
                minLines: 1,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Value',
                  counterText: '',
                ),
                onChanged: (v) => setState(() {
                  field['value'] = v;
                  dirty = true;
                }),
              ),

              if (editable)
                TextButton.icon(
                  onPressed: busy
                      ? null
                      : () => setState(() {
                          fields.remove(field);
                          dirty = true;
                        }),
                  icon: const Icon(Icons.remove_circle_outline),
                  label: const Text('Remove field'),
                ),
            ],
          ),
        ),
      ),
      if (editable)
        OutlinedButton.icon(
          onPressed: busy || fields.length >= 100
              ? null
              : () => setState(() {
                  fields.add({
                    'label': '',
                    'value': '',
                    'source_line': null,
                    'confidence': null,
                  });
                  dirty = true;
                }),
          icon: const Icon(Icons.add),
          label: const Text('Add field'),
        ),
      gap(),
    ];
  }

  Widget gap() => const SizedBox(height: 16);
  @override
  Widget build(BuildContext context) {
    if (widget.captureId != null && capture == null) {
      return Scaffold(
        appBar: AppBar(
          leading: const WorkspaceBackButton(),
          title: const Text('Transaction'),
        ),
        body: Center(
          child: loading
              ? const Text('Opening transaction…')
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(error ?? 'Transaction unavailable'),
                    const SizedBox(height: 12),
                    OutlinedButton(
                      onPressed: () {
                        setState(() {
                          loading = true;
                          error = null;
                        });
                        initialize();
                      },
                      child: const Text('Try again'),
                    ),
                  ],
                ),
        ),
      );
    }
    final currentUser = ref.watch(serviceProvider).user;
    final canWrite = canVisitMobilePage('/ekyc', currentUser);
    final canExport = (currentUser?['permissions'] as List? ?? []).contains(
      currentUser?['role'] == 'Field Agent' ? 'read' : 'report.read',
    );
    final editable =
        canWrite &&
        capture != null &&
        ['EXTRACTED', 'VALIDATED', 'REJECTED'].contains(capture!['status']);
    if (!loading && capture == null && !intakeReady) {
      return CustomerIntakeScreen(
        initial: intake,
        onReady: (value) {
          setState(() {
            intake = Map<String, dynamic>.from(value);
            intakeReady = true;
          });
          saveDraft();
        },
        onHistory: () async {
          final selected = await showModalBottomSheet<Json>(
            context: context,
            builder: (c) => SafeArea(
              child: ListView(
                children: [
                  const ListTile(title: Text('Transaction history')),
                  if (captures.isEmpty)
                    const ListTile(title: Text('No transactions yet')),
                  for (final item in captures)
                    ListTile(
                      title: Text(item['source_reference'] ?? ''),
                      subtitle: Text(item['status'] ?? ''),
                      onTap: () => Navigator.pop(c, item),
                    ),
                ],
              ),
            ),
          );
          if (selected != null) {
            await act(() async {
              final r = await ref
                  .read(serviceProvider)
                  .dio
                  .get('/kyc-captures/${selected['id']}');
              if (mounted) {
                setState(() {
                  capture = Map<String, dynamic>.from(r.data);
                  rows = List<Json>.from(
                    (capture!['rows'] as List).map(
                      (r) => Map<String, dynamic>.from(r),
                    ),
                  );
                });
              }
            });
          }
        },
      );
    }
    final receipt = capture;
    final compactBillHeader =
        receipt != null &&
        MediaQuery.sizeOf(context).width /
                MediaQuery.textScalerOf(context).scale(1) <
            360;
    final verified = receipt?['intake'] != null;
    final receiptSuccess = receipt?['status'] == 'VERIFIED';
    final saleMode = receipt?['intake']?['capture_mode'] == 'SCREENSHOT_SALE';
    final saleFlow = intake['capture_mode'] == 'SCREENSHOT_SALE';
    final payment =
        saleMode || receipt?['document_kind'] == 'PAYMENT_CONFIRMATION';
    final invoice = payment
        ? (receipt?['invoice'] as Map? ?? paymentInvoice(receipt!))
        : null;
    final verifiedReceiptFields = <Json>[];
    if (verified) {
      for (final row in rows) {
        final fields = row['fields'];
        if (fields is List) {
          for (final value in fields) {
            if (value is Map &&
                (value['value'] ?? '').toString().trim().isNotEmpty) {
              final label = (value['label'] ?? 'Receipt detail').toString();
              var text = value['value'].toString();
              if (RegExp(
                r'document|passport|identity|customer.*id|subscriber.*id|emirates.*id|national.*id|^id(?:\s|$)',
                caseSensitive: false,
              ).hasMatch(label)) {
                text = text.length > 4
                    ? '•••• ${text.substring(text.length - 4)}'
                    : '••••';
              }
              verifiedReceiptFields.add({'label': label, 'value': text});
            }
          }
        }
      }
    }
    final customerId = (receipt?['intake']?['document_number'] ?? '')
        .toString();
    final maskedCustomerId = customerId.isEmpty
        ? '—'
        : customerId.length > 4
        ? '•••• ${customerId.substring(customerId.length - 4)}'
        : '••••';
    return Scaffold(
      appBar: AppBar(
        leading: const WorkspaceBackButton(),
        title: Text(
          capture == null
              ? saleFlow
                    ? 'Submit sale'
                    : 'Payment'
              : payment
              ? 'Reference bill'
              : 'Receipt',
          maxLines: 2,
          style: const TextStyle(fontSize: 18, height: 1.05),
        ),
        actions: [
          if (capture != null)
            IconButton(
              tooltip: 'Home',
              onPressed: () => context.go('/'),
              icon: const Icon(Icons.home_outlined),
            ),
          if (canWrite && capture != null && !compactBillHeader)
            IconButton(
              tooltip: 'New transaction',
              onPressed: busy ? null : startNewTransaction,
              icon: const Icon(Icons.add),
            ),
          if (compactBillHeader)
            PopupMenuButton<String>(
              tooltip: 'Bill actions',
              enabled: !busy,
              onSelected: (action) {
                if (action == 'new') {
                  startNewTransaction();
                } else {
                  refresh();
                }
              },
              itemBuilder: (_) => [
                if (canWrite)
                  const PopupMenuItem(
                    value: 'new',
                    child: Text('New transaction'),
                  ),
                const PopupMenuItem(value: 'refresh', child: Text('Refresh')),
              ],
            )
          else
            IconButton(
              tooltip: 'Refresh',
              onPressed: busy ? null : refresh,
              icon: const Icon(Icons.refresh),
            ),
        ],
      ),
      body: ListView(
        controller: receiptScroll,
        padding: const EdgeInsets.all(20),
        children: [
          if (capture == null) ...[
            KycJourneyGuide(status: capture?['status']),
            gap(),
          ],
          if (error != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Text(error!, style: const TextStyle(color: Colors.red)),
              ),
            ),
          if (receipt != null && receipt['intake'] != null)
            ReceiptReveal(
              readyLabel: payment ? 'BILL READY' : 'RECEIPT READY',
              key: ValueKey('receipt-${receipt["id"]}'),
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  border: Border.all(color: const Color(0xff9adfc3)),
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x12174b35),
                      blurRadius: 18,
                      offset: Offset(0, 7),
                    ),
                  ],
                ),
                clipBehavior: Clip.antiAlias,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      color: receiptSuccess
                          ? const Color(0xffe8fbf2)
                          : const Color(0xfffff3d5),
                      child: Column(
                        children: [
                          Icon(
                            receiptSuccess
                                ? Icons.check_circle
                                : Icons.pending_outlined,
                            color: Color(0xff07966b),
                            size: 28,
                          ),
                          SizedBox(height: 3),
                          Text(
                            saleMode
                                ? activationLabel(receipt)
                                : payment
                                ? invoice!['heading']
                                : receiptSuccess
                                ? 'SUCCESS - RECEIPT VERIFIED'
                                : receipt['status'] == 'REJECTED'
                                ? 'CORRECTION REQUIRED'
                                : 'FINAL REVIEW PENDING',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w900,
                              color: Color(0xff183044),
                            ),
                          ),
                          Text(
                            saleMode
                                ? receiptSuccess
                                      ? 'Backend verification complete'
                                      : 'Pending backend verification'
                                : payment
                                ? invoice!['status']
                                : receiptSuccess
                                ? 'Receipt confirmed'
                                : payment
                                ? 'Payment confirmation saved'
                                : 'Receipt saved',
                            style: TextStyle(color: Color(0xff087756)),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        children: [
                          const Align(
                            alignment: Alignment.centerLeft,
                            child: QanawatBrand(width: 164, height: 47),
                          ),
                          const Divider(height: 16),
                          if (payment)
                            PaymentInvoiceSections(invoice: invoice!)
                          else ...[
                            _ReceiptLine(
                              'Reference',
                              receipt['source_reference'],
                            ),
                            _ReceiptLine('Customer', receipt['intake']['name']),
                            _ReceiptLine('ID number', maskedCustomerId),
                            _ReceiptLine(
                              'Phone number',
                              receipt['intake']['msisdn'],
                            ),
                            _ReceiptLine(
                              'SIM type',
                              receipt['intake']['sim_type'] == 'ESIM'
                                  ? 'eSIM'
                                  : 'Physical SIM',
                            ),
                            _ReceiptLine(
                              'Plan',
                              receipt['intake']['plan_name'],
                            ),
                            _ReceiptLine(
                              'SIM serial',
                              receipt['intake']['sim_identifier'],
                            ),
                            _ReceiptLine(
                              receiptSuccess ? 'Verified' : 'Date',
                              receiptDate(
                                receipt['review']?['at'] ??
                                    receipt['updated_at'],
                              ),
                            ),
                            if (verifiedReceiptFields.isNotEmpty) ...[
                              const Divider(height: 22),
                              const Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    'RECEIPT DETAILS',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  Text(
                                    'VALUE',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ],
                              ),
                              for (final field in verifiedReceiptFields)
                                _ReceiptLine(field['label'], field['value']),
                            ],
                          ],
                          const SizedBox(height: 12),
                          if (canExport)
                            FilledButton.tonalIcon(
                              onPressed: busy ? null : printReceipt,
                              icon: const Icon(Icons.print_outlined),
                              label: Text(
                                payment
                                    ? 'Print reference bill'
                                    : 'Print receipt',
                              ),
                            ),
                          const SizedBox(height: 8),
                          if (canExport)
                            OutlinedButton.icon(
                              onPressed: busy ? null : () => export('receipt'),
                              icon: const Icon(Icons.picture_as_pdf_outlined),
                              label: Text(
                                payment
                                    ? 'Download / share reference bill'
                                    : 'Download / share receipt',
                              ),
                            ),
                          const SizedBox(height: 10),
                          FilledButton(
                            onPressed: () => context.go('/'),
                            child: const Text('Done · Home'),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          gap(),
          if (capture == null)
            Card(
              key: formKey,
              color: const Color(0xFFF0EAFA),
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      saleFlow
                          ? 'Review & submit sale'
                          : 'Upload payment confirmation',
                      style: RelayTypography.section,
                    ),
                    const SizedBox(height: 6),
                    if (saleFlow) ...[
                      const SizedBox(height: 10),
                      _ReceiptLine(
                        'Customer',
                        intake['name'] ?? 'Not recorded',
                      ),
                      _ReceiptLine(
                        'Plan',
                        intake['plan_name'] ??
                            intake['package_name'] ??
                            'Not recorded',
                      ),
                      _ReceiptLine(
                        'Request ID',
                        intake['order_reference'] ?? 'Not recorded',
                      ),
                      const SizedBox(height: 10),
                      SrNumberSummary(
                        value: (intake['sr_number'] ?? '').toString(),
                        message:
                            receiptSrNotice ??
                            ((intake['sr_number'] ?? '')
                                    .toString()
                                    .trim()
                                    .isEmpty
                                ? 'Read automatically from order or receipt'
                                : 'SR number read from order'),
                        reading: receiptSrReading,
                        warning:
                            receiptSrMismatch ||
                            receiptSrUnclear ||
                            receiptSrRetry,
                        onRetry: receiptSrRetry && !busy && !pending
                            ? retryReceiptSr
                            : null,
                      ),
                    ] else
                      const Text(
                        'PNG or JPEG · up to 4 MB',
                        style: RelayTypography.caption,
                      ),
                    gap(),
                    if (!saleFlow)
                      TextField(
                        controller: source,
                        maxLength: 120,
                        enabled: !busy && !pending,
                        decoration: InputDecoration(
                          labelText: 'Request ID (optional)',
                          hintText: intake['order_reference']?.toString(),
                        ),
                        onChanged: (_) {
                          saveDraft();
                          setState(() {});
                        },
                      ),
                    if (!saleFlow) gap(),
                    if (saleFlow)
                      const Padding(
                        padding: EdgeInsets.only(bottom: 8),
                        child: Text(
                          'Payment receipt · optional',
                          style: RelayTypography.bodyStrong,
                        ),
                      ),
                    RelayPair(
                      first: OutlinedButton(
                        onPressed: busy || pending
                            ? null
                            : () => pick(ImageSource.camera),
                        style: RelayCaptureStyles.upload.copyWith(
                          minimumSize: const WidgetStatePropertyAll(
                            Size(0, 62),
                          ),
                          padding: const WidgetStatePropertyAll(
                            EdgeInsets.symmetric(vertical: 7),
                          ),
                        ),
                        child: const Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.camera_alt_outlined, size: 20),
                            SizedBox(height: 3),
                            Text('Take photo', textAlign: TextAlign.center),
                          ],
                        ),
                      ),
                      second: OutlinedButton(
                        onPressed: busy || pending
                            ? null
                            : () => pick(ImageSource.gallery),
                        style: RelayCaptureStyles.upload.copyWith(
                          minimumSize: const WidgetStatePropertyAll(
                            Size(0, 62),
                          ),
                          padding: const WidgetStatePropertyAll(
                            EdgeInsets.symmetric(vertical: 7),
                          ),
                        ),
                        child: const Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.upload, size: 20),
                            SizedBox(height: 3),
                            Text('Upload', textAlign: TextAlign.center),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (bytes != null) ...[
                      if (saleFlow)
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: const Color(0xffddd8e5)),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              InkWell(
                                onTap: viewAttachedReceipt,
                                borderRadius: BorderRadius.circular(8),
                                child: Image.memory(
                                  bytes!,
                                  width: 58,
                                  height: 78,
                                  fit: BoxFit.contain,
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text(
                                      'Receipt attached',
                                      style: RelayTypography.bodyStrong,
                                    ),
                                    const SizedBox(height: 4),
                                    Wrap(
                                      spacing: 4,
                                      children: [
                                        TextButton(
                                          onPressed: viewAttachedReceipt,
                                          style: TextButton.styleFrom(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 8,
                                            ),
                                            minimumSize: const Size(0, 44),
                                          ),
                                          child: const Text('View receipt'),
                                        ),
                                        TextButton(
                                          onPressed: busy || pending
                                              ? null
                                              : removeReceipt,
                                          style: TextButton.styleFrom(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 8,
                                            ),
                                            minimumSize: const Size(0, 44),
                                          ),
                                          child: const Text('Remove receipt'),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        )
                      else
                        Image.memory(
                          bytes!,
                          height: 180,
                          fit: BoxFit.contain,
                          errorBuilder: (_, e, st) => const Text(
                            'Image preview unavailable. Choose a PNG or JPEG.',
                          ),
                        ),
                      gap(),
                      if (!saleFlow) const Text('Image ready to upload'),
                      gap(),
                    ],
                    FilledButton(
                      onPressed:
                          busy ||
                              receiptSrMismatch ||
                              (!saleFlow && bytes == null)
                          ? null
                          : upload,
                      child: Text(
                        busy
                            ? 'Working…'
                            : pending
                            ? 'Retry queued upload'
                            : saleFlow
                            ? 'Submit sale'
                            : 'Upload payment confirmation',
                      ),
                    ),
                    if (pending)
                      const Padding(
                        padding: EdgeInsets.only(top: 10),
                        child: Text('Saved offline · upload pending'),
                      ),
                  ],
                ),
              ),
            ),
          if (capture != null)
            ExpansionTile(
              title: Text(
                saleMode
                    ? 'Sale details & history'
                    : 'Payment details & history',
              ),
              initiallyExpanded:
                  capture!['status'] == 'OCR_FAILED' ||
                  capture!['status'] == 'EXTRACTED' ||
                  capture!['status'] == 'VALIDATED',
              children: [
                const Divider(),
                Text(
                  capture!['source_reference'],
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                gap(),
                Text(
                  'Status: ${capture!['status'] == 'OCR_FAILED' ? 'Needs another image' : capture!['status']}',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                gap(),
                if (capture!['status'] == 'QUEUED')
                  Text(
                    payment
                        ? 'Preparing payment details…'
                        : 'Preparing receipt…',
                  ),
                if (canWrite && capture!['status'] == 'OCR_FAILED') ...[
                  const Text(
                    "We couldn't read this image automatically. Add the details below or try again.",
                  ),
                  TextButton(
                    onPressed: busy ? null : () => command('retry'),
                    child: const Text('Try again'),
                  ),
                ],
                OutlinedButton(
                  onPressed: busy ? null : () => export('original'),
                  child: const Text('Download / share original'),
                ),
                if ((capture!['lines'] as List? ?? []).isNotEmpty)
                  ExpansionTile(
                    title: Text(payment ? 'Text from image' : 'Receipt text'),
                    initiallyExpanded: rows.isEmpty,
                    children: [
                      ...(capture!['lines'] as List).asMap().entries.map(
                        (entry) => ListTile(
                          title: Text(entry.value['text']),
                          subtitle: Text('Line ${entry.key + 1}'),
                          trailing: editable
                              ? IconButton(
                                  icon: const Icon(Icons.add),
                                  onPressed: rows.length >= 100
                                      ? null
                                      : () {
                                          setState(() {
                                            rows.add({
                                              'fields': [
                                                {
                                                  'label': payment
                                                      ? 'Image text'
                                                      : 'Receipt text',
                                                  'value': entry.value['text'],
                                                  'source_line': entry.key,
                                                  'confidence':
                                                      entry.value['confidence'],
                                                },
                                              ],
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
                  payment ? 'Payment details' : 'Transaction rows',
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
                          if (r['fields'] is List)
                            ...receiptFields(r, editable)
                          else
                            ...[
                              'reference',
                              'customer',
                              'account',
                              'details',
                            ].map(
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
                                'fields': [
                                  {
                                    'label': '',
                                    'value': '',
                                    'source_line': null,
                                    'confidence': null,
                                  },
                                ],
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
                              (r) => r['fields'] is List
                                  ? ((r['fields'] as List).isEmpty ||
                                        (r['fields'] as List).any(
                                          (f) => f['label']
                                              .toString()
                                              .trim()
                                              .isEmpty,
                                        ) ||
                                        !(r['fields'] as List).any(
                                          (f) => f['value']
                                              .toString()
                                              .trim()
                                              .isNotEmpty,
                                        ))
                                  : (r['reference'].toString().trim().length <
                                            2 ||
                                        r['details'].toString().trim().length <
                                            2),
                            )) {
                              throw Exception(
                                'Check field names and enter at least one value per transaction.',
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
                                capture = Map<String, dynamic>.from(
                                  result.data,
                                );
                                dirty = false;
                              });
                            }
                          }),
                    child: const Text('Save details'),
                  ),
                ],
                if (canExport &&
                    (capture!['rows'] as List? ?? []).isNotEmpty &&
                    capture!['status'] != 'EXTRACTED') ...[
                  gap(),
                  OutlinedButton(
                    onPressed: busy || dirty ? null : () => export('excel'),
                    child: const Text('Share Excel'),
                  ),
                ],
                if (canWrite && capture!['status'] == 'VALIDATED')
                  FilledButton(
                    onPressed: busy || dirty ? null : () => command('submit'),
                    child: const Text('Submit for review'),
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
                    title: Text(
                      event['action']
                          .toString()
                          .replaceAll('KYC', 'Receipt')
                          .replaceAll('OCR', 'Details'),
                    ),
                    subtitle: Text('${event['actor']} · ${event['at']} UTC'),
                  ),
                ),
              ],
            ),
          gap(),
          Card(
            key: historyKey,
            color: const Color(0xFFE7F5F1),
            child: ExpansionTile(
              key: ValueKey('history-${capture?['id'] ?? 'new'}'),
              tilePadding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 4,
              ),
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
        ],
      ),
    );
  }
}

class _ReceiptLine extends StatelessWidget {
  const _ReceiptLine(this.label, this.value);
  final dynamic label;
  final dynamic value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            label.toString(),
            style: const TextStyle(color: Color(0xff64738a), fontSize: 13),
          ),
        ),
        const SizedBox(width: 12),
        Flexible(
          child: Text(
            value.toString().isEmpty ? '—' : value.toString(),
            textAlign: TextAlign.right,
            style: const TextStyle(
              color: Color(0xff202b3b),
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    ),
  );
}
