import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dio/dio.dart';
import 'package:share_plus/share_plus.dart';
import 'package:uuid/uuid.dart';
import 'services.dart';
import 'experience.dart';
import 'transaction_steps.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

class TransactionScreen extends ConsumerStatefulWidget {
  const TransactionScreen({super.key});
  @override
  ConsumerState<TransactionScreen> createState() => _TransactionState();
}

class _TransactionState extends ConsumerState<TransactionScreen> {
  Json? record, catalog;
  Json identity = {};
  final fields = {
    for (final k in ['name', 'document_number', 'nationality', 'expiry', 'dob'])
      k: TextEditingController(),
  };
  final serial = TextEditingController();
  String kind = 'National Identity Card',
      simType = 'Physical',
      sim = '',
      plan = '',
      number = 'DEMO-050-0001',
      operation = const Uuid().v4();
  int step = 1;
  bool busy = false;
  String? error, notice;
  Timer? timer;
  List<List<Offset>> signature = [];
  RelayService get service => ref.read(serviceProvider);
  String get draftKey => 'transaction-journey-${service.user!['id']}';
  @override
  void initState() {
    super.initState();
    Future.microtask(restore);
    timer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (record?['status'] == 'PROCESSING' && !busy) {
        run(() async {
          apply(
            Map<String, dynamic>.from(
              (await service.dio.get('/transactions/${record!['id']}')).data,
            ),
          );
        });
      }
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    for (final c in fields.values) {
      c.dispose();
    }
    serial.dispose();
    super.dispose();
  }

  Future<void> restore() async {
    await run(() async {
      final saved = await service.store.get(draftKey);
      if (saved?['id'] != null) {
        try {
          apply(
            Map<String, dynamic>.from(
              (await service.dio.get('/transactions/${saved!['id']}')).data,
            ),
          );
        } on DioException catch (e) {
          if (e.response?.statusCode != 404) rethrow;
          await service.store.remove(draftKey);
        }
      }
      await loadCatalog();
    });
  }

  Future<void> loadCatalog() async {
    final data = await service.dio.get(
      '/transactions/catalog',
      queryParameters: {'agent_id': service.user!['agent_id']},
    );
    if (mounted) setState(() => catalog = Map<String, dynamic>.from(data.data));
  }

  void apply(Json r) {
    if (!mounted) return;
    setState(() {
      record = r;
      identity = Map<String, dynamic>.from(r['data']);
      step = r['stage'];
      kind = identity['document_type'];
      for (final k in fields.keys) {
        fields[k]!.text = identity[k]?.toString() ?? '';
      }
      sim = r['sim_id'] ?? '';
      plan = r['plan_id'] ?? '';
      if ((r['msisdn'] as String).startsWith('DEMO-05')) number = r['msisdn'];
      simType = identity['sim_type'] ?? simType;
      signature = (identity['signature'] as List? ?? [])
          .map(
            (s) => (s as List)
                .map(
                  (p) => Offset(
                    (p[0] as num).toDouble(),
                    (p[1] as num).toDouble(),
                  ),
                )
                .toList(),
          )
          .toList();
    });
  }

  Future<void> run(Future<void> Function() fn) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
      notice = null;
    });
    try {
      await fn();
    } catch (e) {
      if (mounted) setState(() => error = friendlyError(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<Json> ensure() async {
    if (record != null) return record!;
    final r = Map<String, dynamic>.from(
      (await service.dio.post(
        '/transactions',
        data: {
          'agent_id': service.user!['agent_id'],
          'operation_id': operation,
        },
      )).data,
    );
    apply(r);
    await service.store.put(draftKey, {'id': r['id']});
    return r;
  }

  Future<void> command(String action, Json body) async {
    final r = await ensure();
    apply(
      Map<String, dynamic>.from(
        (await service.dio.post(
          '/transactions/${r['id']}/$action',
          data: {'version': r['version'], ...body},
        )).data,
      ),
    );
  }

  Future<void> scan(Uint8List bytes) async {
    if (bytes.length > 4000000) throw Exception('Use a PNG or JPEG up to 4 MB');
    await command('scan', {
      'document_type': kind,
      'image_base64': base64Encode(bytes),
    });
  }

  Future<void> pick(ImageSource source) async {
    await run(() async {
      final file = await ImagePicker().pickImage(source: source);
      if (file != null) await scan(await file.readAsBytes());
    });
  }

  Future<void> selfie() async {
    final pass = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (c) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.face_retouching_natural,
              size: 72,
              color: Color(0xFF087C6A),
            ),
            const SizedBox(height: 16),
            const Text(
              'Demo selfie / liveness',
              style: TextStyle(fontSize: 23, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            const Text(
              'Look forward · blink · hold still. This is a simulation. No selfie or biometric data is captured.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: () => Navigator.pop(c, true),
              child: const Text('Run passing demo check'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: const Text('Test failed check'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(c),
              child: const Text('Cancel'),
            ),
          ],
        ),
      ),
    );
    if (pass != null) {
      await run(() async {
        await command('liveness', {'scenario': pass ? 'pass' : 'fail'});
        if (mounted) setState(() => step = 1);
      });
    }
  }

  Future<void> history() async {
    await run(() async {
      final rows = (await service.dio.get('/transactions')).data as List;
      if (!mounted) return;
      final id = await showModalBottomSheet<String>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (c) => SizedBox(
          height: MediaQuery.sizeOf(c).height * .75,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(20),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Saved transactions',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Close history',
                      onPressed: () => Navigator.pop(c),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: rows.isEmpty
                    ? const Center(child: Text('No saved transactions yet'))
                    : ListView(
                        children: rows
                            .map(
                              (r) => ListTile(
                                title: Text(r['reference']),
                                subtitle: Text(
                                  '${r['customer']} · ${r['status']}',
                                ),
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () => Navigator.pop(c, r['id']),
                              ),
                            )
                            .toList(),
                      ),
              ),
            ],
          ),
        ),
      );
      if (id != null) {
        apply(
          Map<String, dynamic>.from(
            (await service.dio.get('/transactions/$id')).data,
          ),
        );
        await service.store.put(draftKey, {'id': id});
        await loadCatalog();
      }
    });
  }

  Future<void> receipt() async {
    await run(() async {
      final r = await service.dio.get(
        '/transactions/${record!['id']}/receipt',
        options: Options(responseType: ResponseType.bytes),
      );
      await SharePlus.instance.share(
        ShareParams(
          files: [
            XFile.fromData(
              Uint8List.fromList(r.data),
              mimeType: 'application/pdf',
              name: '${record!['reference']}.pdf',
            ),
          ],
          text: 'Relay demo activation receipt — no payment collected',
        ),
      );
    });
  }

  Future<void> reset() async {
    await service.store.remove(draftKey);
    if (!mounted) return;
    setState(() {
      record = null;
      identity = {};
      signature = [];
      step = 1;
      sim = '';
      plan = '';
      operation = const Uuid().v4();
      for (final c in fields.values) {
        c.clear();
      }
    });
    await run(loadCatalog);
  }

  Widget gap([double n = 16]) => SizedBox(height: n);
  Widget title(String text) => Text(
    text,
    style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w800),
  );
  Widget panel(
    List<Widget> children, {
    Color color = const Color(0xFFFAF8FD),
  }) => Card(
    color: color,
    child: Padding(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    ),
  );
  @override
  Widget build(BuildContext context) {
    final sims = (catalog?['sims'] as List? ?? [])
        .where(
          (s) =>
              s['sim_type'] == simType &&
              '${s['iccid']} ${s['serial']}'.toLowerCase().contains(
                serial.text.toLowerCase(),
              ),
        )
        .toList();
    final plans = catalog?['plans'] as List? ?? [];
    return Scaffold(
      appBar: AppBar(
        leading: const WorkspaceBackButton(),
        title: const Text('New connection'),
        actions: [
          IconButton(
            tooltip: 'Saved transactions',
            onPressed: busy ? null : history,
            icon: const Icon(Icons.history),
          ),
        ],
      ),
      body: AnimatedSwitcher(
        duration: motionDuration(context),
        switchInCurve: Curves.easeOutCubic,
        child: ListView(
          key: ValueKey(step),
          padding: const EdgeInsets.all(20),
          children: [
            panel([
              Text(
                'STEP $step OF 3 · ${['Identity & eKYC', 'SIM & Plan Allocation', 'Activation & Receipt'][step - 1]}',
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  color: Color(0xFF642AA0),
                ),
              ),
              gap(12),
              TransactionSteps(step: step),
              gap(12),
              const Text(
                'Demo identity, carrier and SMS · real server OCR. No payment collected.',
                style: TextStyle(fontSize: 13),
              ),
            ], color: const Color(0xFFF0E5FF)),
            gap(),
            if (error != null)
              panel([
                Text(error!, style: const TextStyle(color: Colors.red)),
                TextButton(
                  onPressed: busy ? null : restore,
                  child: const Text('Reload saved transaction'),
                ),
              ]),
            if (notice != null)
              panel([Text(notice!)], color: const Color(0xFFE1F6E9)),
            if (busy) const LinearProgressIndicator(),
            if (step == 1) ...[
              title('Verify the customer'),
              gap(),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(
                    value: 'National Identity Card',
                    label: Text('National ID'),
                  ),
                  ButtonSegment(value: 'Passport', label: Text('Passport')),
                ],
                selected: {kind},
                onSelectionChanged: busy
                    ? null
                    : (v) => setState(() {
                        if (kind != v.first) {
                          kind = v.first;
                          identity = {};
                          for (final field in fields.values) {
                            field.clear();
                          }
                        }
                      }),
              ),
              gap(),
              panel([
                if (identity['image'] != null)
                  Image.memory(
                    base64Decode(identity['image']),
                    height: 170,
                    fit: BoxFit.contain,
                  )
                else ...[
                  const Icon(
                    Icons.document_scanner_outlined,
                    size: 54,
                    color: Color(0xFF356BA1),
                  ),
                  gap(),
                  const Text(
                    'Scan a synthetic document',
                    textAlign: TextAlign.center,
                  ),
                ],
                gap(),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: busy ? null : () => pick(ImageSource.camera),
                        icon: const Icon(Icons.camera_alt_outlined),
                        label: const Text('Camera'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: busy
                            ? null
                            : () => pick(ImageSource.gallery),
                        icon: const Icon(Icons.upload),
                        label: const Text('Upload'),
                      ),
                    ),
                  ],
                ),
                TextButton(
                  onPressed: busy
                      ? null
                      : () => run(() async {
                          final sample = (await service.dio.get(
                            '/transactions/sample/${kind == 'Passport' ? 'passport' : 'id'}',
                          )).data;
                          await scan(base64Decode(sample['image_base64']));
                        }),
                  child: const Text('Use synthetic sample'),
                ),
              ], color: const Color(0xFFEAF4FF)),
              gap(),
              if (identity['ocr_lines'] != null) ...[
                panel([
                  title('Customer details'),
                  gap(),
                  for (final pair in [
                    ['name', 'Full legal name'],
                    ['document_number', 'Document number'],
                    ['nationality', 'Nationality'],
                    ['expiry', 'Expiry · YYYY-MM-DD'],
                    ['dob', 'Date of birth · YYYY-MM-DD'],
                  ])
                    Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: TextField(
                        controller: fields[pair[0]],
                        maxLength: pair[0] == 'document_number' ? 75 : 120,
                        onChanged: (_) => setState(() {
                          identity['identity_saved'] = false;
                          identity['identity_verified'] = false;
                        }),
                        decoration: InputDecoration(
                          labelText: pair[1],
                          counterText: '',
                        ),
                      ),
                    ),
                  FilledButton(
                    onPressed: busy
                        ? null
                        : () => run(
                            () => command('identity', {
                              for (final e in fields.entries)
                                e.key: e.value.text.trim(),
                            }),
                          ),
                    child: const Text('Save reviewed details'),
                  ),
                ]),
                gap(),
                ExpansionTile(
                  title: const Text('OCR text & confidence'),
                  children: (identity['ocr_lines'] as List)
                      .map<Widget>(
                        (l) => ListTile(
                          title: Text(l['text']),
                          trailing: Text('${l['confidence']}%'),
                        ),
                      )
                      .toList(),
                ),
                gap(),
                panel([
                  const Text(
                    'Selfie / liveness',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  gap(8),
                  Text(
                    identity['liveness'] == 'SIMULATED_FAIL'
                        ? 'Demo check failed. Retry to continue.'
                        : 'Simulation only — no biometric data is captured.',
                  ),
                  gap(),
                  FilledButton(
                    onPressed: busy || identity['identity_saved'] != true
                        ? null
                        : selfie,
                    child: const Text('Open demo selfie check'),
                  ),
                ], color: const Color(0xFFE0F5EB)),
              ],
              gap(),
              TextButton(
                onPressed: () => context.push('/screenshot-capture'),
                child: const Text('Screenshot OCR & backend review'),
              ),
            ],
            if (step == 2) ...[
              title('Allocate SIM & plan'),
              gap(8),
              Text('${identity['name']} · demo identity checked'),
              gap(),
              TextButton(
                onPressed: busy ? null : () => setState(() => step = 1),
                child: const Text('Back to identity'),
              ),
              gap(),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'Physical', label: Text('Physical SIM')),
                  ButtonSegment(value: 'eSIM', label: Text('Digital eSIM')),
                ],
                selected: {simType},
                onSelectionChanged: busy
                    ? null
                    : (v) => setState(() {
                        simType = v.first;
                        sim = '';
                      }),
              ),
              gap(),
              TextField(
                controller: serial,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  labelText: 'Search ICCID',
                  prefixIcon: Icon(Icons.qr_code_scanner),
                ),
              ),
              TextButton.icon(
                icon: const Icon(Icons.qr_code_scanner),
                label: const Text('Scan / re-scan SIM barcode'),
                onPressed: busy
                    ? null
                    : () async {
                        final code = await Navigator.of(context).push<String>(
                          MaterialPageRoute(
                            builder: (_) => const SimBarcodeScreen(),
                          ),
                        );
                        if (mounted && code != null) {
                          setState(() {
                            serial.text = code;
                            sim = '';
                          });
                        }
                      },
              ),
              gap(),
              DropdownButtonFormField<String>(
                key: ValueKey('$sim-$simType-${sims.length}'),
                initialValue: sims.any((s) => s['id'] == sim) ? sim : null,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Assigned SIM'),
                items: sims
                    .map<DropdownMenuItem<String>>(
                      (s) => DropdownMenuItem(
                        value: s['id'],
                        child: Text(
                          s['iccid'],
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                    .toList(),
                onChanged: busy ? null : (v) => setState(() => sim = v ?? ''),
              ),
              if (sims.isEmpty)
                const Text(
                  'No matching stock. Refresh or request an assignment.',
                ),
              TextButton(
                onPressed: busy ? null : () => run(loadCatalog),
                child: const Text('Refresh available stock'),
              ),
              gap(),
              title('Subscriber plan'),
              gap(),
              ...plans.map(
                (p) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Card(
                    color: plan == p['id']
                        ? const Color(0xFFECE0FA)
                        : Colors.white,
                    child: ListTile(
                      selected: plan == p['id'],
                      onTap: () => setState(() => plan = p['id']),
                      title: Text(
                        p['name'],
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                      subtitle: Text(
                        '${p['data_gb']} GB · ${p['speed']}\nAED ${p['monthly_cost']} / month',
                      ),
                      trailing: Icon(
                        plan == p['id']
                            ? Icons.check_circle
                            : Icons.circle_outlined,
                      ),
                    ),
                  ),
                ),
              ),
              gap(),
              title('Phone number'),
              gap(),
              Wrap(
                spacing: 8,
                children: (catalog?['numbers'] as List? ?? [])
                    .map<Widget>(
                      (n) => ChoiceChip(
                        label: Text(n),
                        selected: number == n,
                        onSelected: (_) => setState(() => number = n),
                      ),
                    )
                    .toList(),
              ),
              gap(),
              title('Customer signature'),
              gap(),
              SignaturePad(
                value: signature,
                onChanged: (v) => setState(() => signature = v),
              ),
              TextButton(
                onPressed: () => setState(() => signature = []),
                child: const Text('Clear signature'),
              ),
              const Text(
                'Use a synthetic customer signature.',
                style: TextStyle(fontSize: 13),
              ),
              gap(),
              OutlinedButton(
                onPressed:
                    busy ||
                        plan.isEmpty ||
                        sim.isEmpty ||
                        signature.expand((s) => s).length < 8
                    ? null
                    : () => run(() async {
                        await command('allocate', {
                          'plan_id': plan,
                          'sim_id': sim,
                          'msisdn': number,
                          'signature': signature
                              .map((s) => s.map((p) => [p.dx, p.dy]).toList())
                              .toList(),
                        });
                        if (mounted) {
                          setState(
                            () => notice =
                                'Allocation draft saved. Resume from Saved transactions.',
                          );
                        }
                      }),
                child: const Text('Save allocation draft'),
              ),
              gap(),
              FilledButton(
                onPressed:
                    busy ||
                        plan.isEmpty ||
                        sim.isEmpty ||
                        signature.expand((s) => s).length < 8
                    ? null
                    : () => run(() async {
                        await command('allocate', {
                          'plan_id': plan,
                          'sim_id': sim,
                          'msisdn': number,
                          'signature': signature
                              .map((s) => s.map((p) => [p.dx, p.dy]).toList())
                              .toList(),
                        });
                        await command('submit', {});
                      }),
                child: const Text('Dispatch demo activation'),
              ),
            ],
            if (step == 3 && record != null) ...[
              panel([
                Icon(
                  record!['status'] == 'ACTIVATED'
                      ? Icons.check_circle_outline
                      : ['PROCESSING', 'SUBMITTED'].contains(record!['status'])
                      ? Icons.hourglass_top
                      : Icons.error_outline,
                  color: record!['status'] == 'ACTIVATED'
                      ? const Color(0xFF0A8C71)
                      : const Color(0xFF9B5E14),
                  size: 58,
                ),
                gap(),
                title(
                  record!['status'] == 'ACTIVATED'
                      ? 'Demo activation successful'
                      : 'Activation ${record!['status'].toString().toLowerCase()}',
                ),
                gap(8),
                const Text(
                  'Simulated carrier result. No real service activated.',
                ),
              ], color: const Color(0xFFE0F6EA)),
              gap(),
              panel([
                title('Relay · Demo receipt'),
                gap(),
                for (final entry in {
                  'Reference': record!['reference'],
                  'Customer': record!['customer'],
                  'Plan': record!['plan'],
                  'SIM': identity['iccid'],
                  'Phone number': record!['msisdn'],
                  'Agent': record!['agent'],
                  'Outlet': record!['outlet'],
                  'Total incl. VAT': 'AED ${record!['receipt']?['total']}',
                  'VAT': 'AED ${record!['receipt']?['vat']}',
                }.entries)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 9),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          entry.key,
                          style: const TextStyle(
                            color: Colors.blueGrey,
                            fontSize: 13,
                          ),
                        ),
                        Text(
                          '${entry.value}',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
                gap(),
                const Text(
                  'No payment collected. Not a tax invoice or regulatory certificate.',
                  style: TextStyle(fontSize: 13),
                ),
              ]),
              gap(),
              FilledButton(
                onPressed: busy || record!['status'] != 'ACTIVATED'
                    ? null
                    : receipt,
                child: const Text('Download / share receipt'),
              ),
              gap(10),
              OutlinedButton(
                onPressed: busy || record!['status'] != 'ACTIVATED'
                    ? null
                    : () => run(() async {
                        await service.dio.post(
                          '/transactions/${record!['id']}/sms',
                        );
                        if (mounted) {
                          setState(
                            () => notice =
                                'SMS dispatch simulated. No message was sent.',
                          );
                        }
                      }),
                child: const Text('Simulate SMS dispatch'),
              ),
              gap(10),
              OutlinedButton(
                onPressed: busy ? null : reset,
                child: const Text('Start new transaction'),
              ),
              TextButton(
                onPressed: () => context.go('/'),
                child: const Text('Done · return to dashboard'),
              ),
            ],
            gap(24),
          ],
        ),
      ),
    );
  }
}

class SignaturePad extends StatelessWidget {
  final List<List<Offset>> value;
  final ValueChanged<List<List<Offset>>> onChanged;
  const SignaturePad({super.key, required this.value, required this.onChanged});
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (c, box) {
      Offset norm(Offset p) =>
          Offset((p.dx / box.maxWidth).clamp(0, 1), (p.dy / 160).clamp(0, 1));
      return Semantics(
        label: 'Customer signature pad',
        child: GestureDetector(
          onPanStart: (d) => onChanged([
            ...value,
            [norm(d.localPosition)],
          ]),
          onPanUpdate: (d) {
            if (value.isNotEmpty && value.expand((s) => s).length < 3000) {
              onChanged([
                ...value.take(value.length - 1),
                [...value.last, norm(d.localPosition)],
              ]);
            }
          },
          child: Container(
            height: 160,
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: const Color(0xFFBDA6D4)),
              borderRadius: BorderRadius.circular(12),
            ),
            child: CustomPaint(
              painter: _SignaturePainter(value),
              size: Size(box.maxWidth, 160),
            ),
          ),
        ),
      );
    },
  );
}

class _SignaturePainter extends CustomPainter {
  final List<List<Offset>> value;
  _SignaturePainter(this.value);
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFF692C4D)
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    for (final stroke in value) {
      if (stroke.isEmpty) continue;
      final path = Path()
        ..moveTo(stroke.first.dx * size.width, stroke.first.dy * size.height);
      for (final p in stroke.skip(1)) {
        path.lineTo(p.dx * size.width, p.dy * size.height);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _SignaturePainter oldDelegate) => true;
}

class SimBarcodeScreen extends StatefulWidget {
  const SimBarcodeScreen({super.key});
  @override
  State<SimBarcodeScreen> createState() => _SimBarcodeState();
}

class _SimBarcodeState extends State<SimBarcodeScreen> {
  bool returned = false;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Scan SIM barcode')),
    body: Column(
      children: [
        const Padding(
          padding: EdgeInsets.all(20),
          child: Text(
            'Align the SIM barcode. You can go back and enter its ICCID manually.',
          ),
        ),
        Expanded(
          child: MobileScanner(
            onDetect: (capture) {
              for (final barcode in capture.barcodes) {
                final value = barcode.rawValue?.trim();
                if (!returned && value != null && value.isNotEmpty) {
                  returned = true;
                  Navigator.pop(context, value);
                  break;
                }
              }
            },
          ),
        ),
      ],
    ),
  );
}
