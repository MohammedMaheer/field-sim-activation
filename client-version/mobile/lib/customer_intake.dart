import 'scan_surface.dart';
import 'experience.dart';
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:camera/camera.dart';
import 'package:dio/dio.dart';
import 'package:image/image.dart' as imaging;
import 'package:image_picker/image_picker.dart';
import 'services.dart';
import 'transaction_journey.dart' show SignaturePad, SimBarcodeScreen;

class DocumentScanResult {
  final Uint8List image;
  final Json? fields;
  const DocumentScanResult(this.image, [this.fields]);
}

bool looksLikeDocument(Uint8List bytes) {
  final decoded = imaging.decodeImage(bytes);
  if (decoded == null) return false;
  final sample = imaging.copyResize(decoded, width: 64);
  var bright = 0;
  final total = sample.width * sample.height;
  for (final pixel in sample) {
    final luminance = pixel.r * .299 + pixel.g * .587 + pixel.b * .114;
    if (luminance > 155) bright++;
  }
  return bright / total > .16;
}

class CameraUnavailable extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  const CameraUnavailable({super.key, required this.message, this.onRetry});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(
          Icons.no_photography_outlined,
          color: Color(0xff63f3d6),
          size: 28,
        ),
        const SizedBox(height: 8),
        Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 15,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 4),
        const Text(
          'Enable camera or upload photo',
          textAlign: TextAlign.center,
          style: TextStyle(color: Color(0xffb4ccd9), fontSize: 12),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: onRetry,
          style: OutlinedButton.styleFrom(
            foregroundColor: const Color(0xff63f3d6),
            side: const BorderSide(color: Color(0xff63f3d6)),
            visualDensity: VisualDensity.compact,
          ),
          icon: const Icon(Icons.refresh, size: 18),
          label: const Text('Try again'),
        ),
      ],
    ),
  );
}

class IntakeCamera extends StatefulWidget {
  final bool selfie, embedded;
  final String document;
  final Future<Json?> Function(Uint8List)? onAutoDetect;
  final void Function(DocumentScanResult)? onResult;
  const IntakeCamera({
    super.key,
    this.selfie = false,
    this.embedded = false,
    this.document = 'Emirates ID',
    this.onAutoDetect,
    this.onResult,
  });
  @override
  State<IntakeCamera> createState() => _IntakeCameraState();
}

class _IntakeCameraState extends State<IntakeCamera>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  CameraController? controller;
  String? error;
  bool taking = false, checking = false, finished = false;
  Timer? autoScan;
  bool expanded = false, starting = false;
  StateSetter? refreshExpanded;
  late final AnimationController scan;
  @override
  void initState() {
    super.initState();
    scan = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    );
    WidgetsBinding.instance.addObserver(this);
    start();
  }

  void refresh() {
    if (!mounted) return;
    setState(() {});
    refreshExpanded?.call(() {});
  }

  Future<void> start() async {
    if (starting || finished || !mounted) return;
    starting = true;
    error = null;
    refresh();
    try {
      final cameras = await availableCameras();
      if (!mounted || finished) return;
      final camera = cameras.firstWhere(
        (c) =>
            c.lensDirection ==
            (widget.selfie
                ? CameraLensDirection.front
                : CameraLensDirection.back),
        orElse: () => cameras.first,
      );
      final next = CameraController(
        camera,
        ResolutionPreset.high,
        enableAudio: false,
      );
      controller = next;
      await next.initialize();
      if (!mounted || controller != next) {
        await next.dispose();
        return;
      }
      error = null;
      scan.repeat(reverse: true);
      refresh();
      if (!widget.selfie && widget.onAutoDetect != null) {
        autoScan?.cancel();
        autoScan = Timer.periodic(
          const Duration(milliseconds: 3200),
          (_) => scanFrame(),
        );
      }
    } catch (_) {
      if (!mounted) return;
      scan.stop();
      error = 'Camera unavailable';
    } finally {
      starting = false;
      refresh();
      // Permission dialogs can pause the app while initialization is running.
      // Resume the interrupted attempt once the dialog has closed.
      if (mounted &&
          !finished &&
          controller == null &&
          error == null &&
          WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed) {
        unawaited(start());
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused) {
      autoScan?.cancel();
      scan.stop();
      final active = controller;
      controller = null;
      active?.dispose();
    } else if (state == AppLifecycleState.resumed &&
        controller == null &&
        !finished) {
      start();
    }
  }

  void complete(DocumentScanResult result) {
    if (finished || !mounted) return;
    finished = true;
    autoScan?.cancel();
    collapse();
    if (widget.onResult != null) {
      widget.onResult!(result);
    } else {
      Navigator.pop(context, result);
    }
  }

  Future<void> scanFrame() async {
    final active = controller;
    if (!mounted ||
        finished ||
        checking ||
        taking ||
        active?.value.isInitialized != true) {
      return;
    }
    checking = true;
    refresh();
    try {
      final frame = await active!.takePicture();
      final bytes = await frame.readAsBytes();
      final fields = await widget.onAutoDetect?.call(bytes);
      if (mounted && controller == active && fields != null) {
        complete(DocumentScanResult(bytes, fields));
      }
    } catch (_) {
      // Continue scanning an unreadable or moving document.
    } finally {
      checking = false;
      refresh();
    }
  }

  Future<void> capture() async {
    if (taking || checking || controller?.value.isInitialized != true) return;
    taking = true;
    refresh();
    try {
      final image = await controller!.takePicture();
      complete(DocumentScanResult(await image.readAsBytes()));
    } catch (_) {
      error = 'Could not capture photo';
    } finally {
      taking = false;
      refresh();
    }
  }

  Future<void> expand() async {
    if (expanded) return;
    setState(() => expanded = true);
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (routeContext) => StatefulBuilder(
          builder: (_, update) {
            refreshExpanded = update;
            return Scaffold(
              appBar: AppBar(
                leading: BackButton(
                  onPressed: () => Navigator.of(routeContext).pop(),
                ),
                title: Text(widget.document),
              ),
              body: Column(
                children: [
                  Expanded(child: surface(full: true)),
                  Padding(
                    padding: const EdgeInsets.all(18),
                    child: captureButton(),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
    refreshExpanded = null;
    if (mounted) setState(() => expanded = false);
  }

  void collapse() {
    if (expanded && mounted) {
      refreshExpanded = null;
      Navigator.of(context).pop();
      expanded = false;
    }
  }

  Widget captureButton() => FilledButton.icon(
    onPressed: taking || checking || controller?.value.isInitialized != true
        ? null
        : capture,
    icon: const Icon(Icons.camera_alt),
    label: const Text('Capture photo'),
  );
  Widget livePreview() {
    final size = controller!.value.previewSize!;
    final portrait =
        !kIsWeb && MediaQuery.orientationOf(context) == Orientation.portrait;
    return ClipRect(
      child: FittedBox(
        fit: BoxFit.cover,
        child: SizedBox(
          width: portrait ? size.height : size.width,
          height: portrait ? size.width : size.height,
          child: CameraPreview(controller!),
        ),
      ),
    );
  }

  Widget surface({bool full = false}) => ClipRRect(
    borderRadius: BorderRadius.circular(full ? 0 : 20),
    child: ColoredBox(
      color: const Color(0xff11233a),
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (controller?.value.isInitialized == true && (full || !expanded))
            livePreview()
          else if (error == null)
            const Center(
              child: CircularProgressIndicator(color: Color(0xff56efd2)),
            ),
          if (error != null)
            Center(
              child: CameraUnavailable(
                message: error!,
                onRetry: starting ? null : start,
              ),
            ),
          if (controller?.value.isInitialized == true && error == null)
            IgnorePointer(
              child: Center(
                child: AspectRatio(
                  aspectRatio: widget.document == 'Passport' ? 1.4 : 1.58,
                  child: Container(
                    margin: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      border: Border.all(
                        color: const Color(0xff63f3d6),
                        width: 2,
                      ),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: AnimatedBuilder(
                      animation: scan,
                      builder: (_, child) => Align(
                        alignment: Alignment(
                          0,
                          MediaQuery.disableAnimationsOf(context)
                              ? 0
                              : scan.value * 1.7 - .85,
                        ),
                        child: Container(
                          height: 2,
                          decoration: const BoxDecoration(
                            gradient: LinearGradient(
                              colors: [
                                Color(0x002df3d2),
                                Color(0xffbdfff0),
                                Color(0xff2df3d2),
                                Color(0x002df3d2),
                              ],
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: Color(0xff3cf6d7),
                                blurRadius: 14,
                                spreadRadius: 2,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          if (controller?.value.isInitialized == true && error == null)
            Positioned(
              left: 12,
              right: 12,
              bottom: 12,
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 7,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xe6142538),
                    borderRadius: BorderRadius.circular(30),
                  ),
                  child: Text(
                    checking
                        ? 'Reading document…'
                        : 'Position ${widget.document.toLowerCase()}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
          if (widget.embedded && !full)
            Positioned.fill(
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: expand,
                  child: const Align(
                    alignment: Alignment.topRight,
                    child: Padding(
                      padding: EdgeInsets.all(12),
                      child: Icon(Icons.fullscreen, color: Colors.white),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    ),
  );
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    autoScan?.cancel();
    refreshExpanded = null;
    scan.dispose();
    controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.embedded
      ? SizedBox(height: 190, child: surface())
      : Scaffold(
          appBar: AppBar(
            title: Text(widget.selfie ? 'Selfie' : 'Scan document'),
          ),
          body: Column(
            children: [
              Expanded(child: surface(full: true)),
              Padding(
                padding: const EdgeInsets.all(24),
                child: captureButton(),
              ),
            ],
          ),
        );
}

class CustomerIntakeScreen extends ConsumerStatefulWidget {
  final Json initial;
  final void Function(Json) onReady;
  final VoidCallback onHistory;
  const CustomerIntakeScreen({
    super.key,
    required this.initial,
    required this.onReady,
    required this.onHistory,
  });
  @override
  ConsumerState<CustomerIntakeScreen> createState() => _CustomerIntakeState();
}

class _CustomerIntakeState extends ConsumerState<CustomerIntakeScreen> {
  final scannerKey = GlobalKey<_IntakeCameraState>();
  bool scannerPaused = false;
  Json data = {};
  List<Json> plans = [];
  int step = 0, version = 0, revision = 0;
  bool busy = true, reading = false;
  Timer? planRefresh;
  String? error;
  final Set<String> missing = {};
  final Map<String, GlobalKey> fieldAnchors = {};
  final Map<String, FocusNode> fieldFocus = {};
  String get cacheKey => 'intake-${ref.read(serviceProvider).user?['id']}';
  @override
  void initState() {
    super.initState();
    load();
    planRefresh = Timer.periodic(
      const Duration(seconds: 20),
      (_) => refreshPlans(),
    );
  }

  Future<void> refreshPlans() async {
    try {
      final updated = await ref.read(serviceProvider).list('plans');
      if (mounted && jsonEncode(updated) != jsonEncode(plans)) {
        setState(() => plans = updated);
      }
    } catch (_) {
      // Preserve the last loaded catalog while the device is offline.
    }
  }

  Future<void> load() async {
    final service = ref.read(serviceProvider);
    try {
      final cached = await service.store.get(cacheKey);
      final result = await service.dio.get('/kyc-captures/draft');
      data = {...result.data['data'], ...?cached?['data'], ...widget.initial};
      version = cached?['version'] ?? result.data['version'];
      step = (data['step'] as int? ?? 0).clamp(0, 1);
      plans = await service.list('plans');
    } catch (e) {
      final cached = await service.store.get(cacheKey);
      data = {...?cached?['data'], ...widget.initial};
      version = cached?['version'] ?? 0;
      error = 'Saved details loaded. Check connection.';
    }
    if (mounted) {
      setState(() {
        busy = false;
        revision++;
      });
    }
  }

  Future<void> cache() async => ref.read(serviceProvider).store.put(cacheKey, {
    'data': data,
    'version': version,
  });
  void set(String k, dynamic v) {
    setState(() {
      data[k] = v;
      missing.remove(k);
      error = null;
    });
  }

  @override
  void dispose() {
    planRefresh?.cancel();
    for (final focus in fieldFocus.values) {
      focus.dispose();
    }
    super.dispose();
  }

  String fieldLabel(String key) => switch (key) {
    'name' => 'full name',
    'document_number' => 'document number',
    'nationality' => 'nationality',
    'birth_date' => 'date of birth',
    'expiry_date' => 'document expiry date',
    'document_image' => 'ID or passport photo',
    'sim_identifier' => 'SIM barcode',
    'msisdn' => 'phone number',
    'plan_id' => 'subscriber plan',
    'signature' => 'customer signature',
    _ => key,
  };

  Future<void> showMissing(Set<String> fields) async {
    final first = fields.first;
    setState(() {
      missing
        ..clear()
        ..addAll(fields);
      error = 'Required to continue: ${fields.map(fieldLabel).join(', ')}.';
    });
    final anchor = fieldAnchors[first]?.currentContext;
    if (anchor != null) {
      await Scrollable.ensureVisible(
        anchor,
        alignment: .35,
        duration: motionDuration(context),
        curve: Curves.easeOutCubic,
      );
      fieldFocus[first]?.requestFocus();
    }
  }

  Future<Json?> autoRead(Uint8List frame) async {
    if (ref.read(serviceProvider).isPreview || !looksLikeDocument(frame)) {
      return null;
    }
    try {
      final response = await ref
          .read(serviceProvider)
          .dio
          .post(
            '/kyc-captures/read-document',
            data: {'image_base64': encodeDocument(frame)},
            options: Options(receiveTimeout: const Duration(seconds: 7)),
          );
      final fields = Map<String, dynamic>.from(response.data);
      return fields['name'] != null && fields['document_number'] != null
          ? fields
          : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> photo(
    String key,
    bool gallery, {
    DocumentScanResult? captured,
  }) async {
    Uint8List? bytes;
    Json? scannedFields;
    final service = ref.read(serviceProvider);
    if (captured == null && mounted) {
      setState(() => scannerPaused = true);
      await Future<void>.delayed(const Duration(milliseconds: 200));
    }
    if (!mounted) return;
    try {
      if (captured != null) {
        bytes = captured.image;
        scannedFields = captured.fields;
      } else if (service.isPreview && gallery) {
        bytes = await service.previewReceipt();
      } else if (gallery) {
        final f = await ImagePicker().pickImage(
          source: ImageSource.gallery,
          maxWidth: 1200,
          maxHeight: 1200,
          imageQuality: 75,
        );
        bytes = await f?.readAsBytes();
      } else {
        final result = await Navigator.push<DocumentScanResult>(
          context,
          MaterialPageRoute(
            builder: (_) => IntakeCamera(
              selfie: key == 'selfie_image',
              onAutoDetect: key == 'document_image' ? autoRead : null,
            ),
          ),
        );
        bytes = result?.image;
        scannedFields = result?.fields;
      }
      if (bytes == null) return;
      if (!mounted) return;
      setState(() {
        busy = true;
        reading = key == 'document_image';
      });
      if (key == 'document_image') {
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }
      data[key] = encodeDocument(bytes);
      if (mounted) setState(() {});
      if (key == 'document_image') {
        try {
          if (scannedFields != null) {
            data.addAll(scannedFields);
          } else {
            final r = await service.dio.post(
              '/kyc-captures/read-document',
              data: {'image_base64': data[key]},
            );
            data.addAll(Map<String, dynamic>.from(r.data));
          }
          revision++;
        } catch (e) {
          error = 'Photo saved. Check the details.';
        }
      }
      await cache();
    } catch (e) {
      error = 'Could not read photo. Try again.';
    } finally {
      if (mounted) {
        setState(() {
          busy = false;
          reading = false;
          scannerPaused = false;
        });
      }
    }
  }

  String encodeDocument(Uint8List bytes) {
    final decoded = imaging.decodeImage(bytes);
    if (decoded == null) throw Exception('Choose a valid photo');
    final resized = imaging.copyResize(
      decoded,
      width: decoded.width >= decoded.height ? 1200 : null,
      height: decoded.height > decoded.width ? 1200 : null,
    );
    final encoded = imaging.encodeJpg(resized, quality: 75);
    if (encoded.length > 1000000) throw Exception('Choose a smaller photo');
    return base64Encode(encoded);
  }

  Future<void> save(bool next) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      if (next) {
        final required = step == 0
            ? [
                'name',
                'document_number',
                'nationality',
                'birth_date',
                'expiry_date',
                'document_image',
              ]
            : ['sim_identifier', 'plan_id', 'msisdn'];
        final missingFields = required
            .where((k) => (data[k] ?? '').toString().trim().isEmpty)
            .toSet();
        if (step == 1 &&
            (data['signature'] as List? ?? []).expand((s) => s as List).length <
                8) {
          missingFields.add('signature');
        }
        if (missingFields.isNotEmpty) {
          await showMissing(missingFields);
          return;
        }
        if (step == 0) {
          final birth = DateTime.tryParse(data['birth_date']),
              expiry = DateTime.tryParse(data['expiry_date']);
          if (birth == null ||
              expiry == null ||
              !birth.isBefore(DateTime.now()) ||
              expiry.isBefore(
                DateTime.now().subtract(const Duration(days: 1)),
              )) {
            throw Exception('Check document dates');
          }
        }
      }
      data['step'] = next ? step + 1 : step;
      await cache();
      final service = ref.read(serviceProvider);
      if (service.online) {
        final r = await service.dio.put(
          '/kyc-captures/draft',
          data: {'version': version, 'data': data},
        );
        version = r.data['version'];
        await cache();
      }
      if (!mounted) return;
      if (next) {
        if (step == 1) {
          widget.onReady(data);
        } else {
          setState(() => step = 1);
        }
      }
    } catch (e) {
      error = e.toString().replaceFirst('Exception: ', '');
    } finally {
      if (mounted) {
        setState(() {
          busy = false;
          reading = false;
        });
      }
    }
  }

  Future<void> scanSim() async {
    final service = ref.read(serviceProvider);
    final code = service.isPreview
        ? 'SIM-SAMPLE-1001'
        : await Navigator.push<String>(
            context,
            MaterialPageRoute(builder: (_) => const SimBarcodeScreen()),
          );
    if (mounted && code != null) {
      revision++;
      set('sim_identifier', code);
    }
  }

  Widget field(
    String key,
    String label, {
    bool date = false,
    TextInputType? keyboardType,
  }) => Padding(
    key: fieldAnchors.putIfAbsent(key, GlobalKey.new),
    padding: const EdgeInsets.only(bottom: 10),
    child: TextFormField(
      key: ValueKey('$key-$revision-${date ? data[key] : ''}'),
      focusNode: fieldFocus.putIfAbsent(key, FocusNode.new),
      initialValue: data[key] ?? '',
      readOnly: date,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        labelText: label,
        errorText: missing.contains(key) ? 'Required' : null,
        suffixIcon: date ? const Icon(Icons.calendar_month) : null,
      ),
      onTap: !date
          ? null
          : () async {
              final d = await showDatePicker(
                context: context,
                initialDate:
                    DateTime.tryParse(data[key] ?? '') ?? DateTime(2000),
                firstDate: DateTime(1900),
                lastDate: DateTime(2100),
              );
              if (d != null) set(key, d.toIso8601String().substring(0, 10));
            },
      onChanged: (v) => set(key, v),
    ),
  );

  Widget _planCard(Json plan) {
    final selected = data['plan_id'] == plan['id'];
    final promotion = (plan['promotion'] ?? '').toString();
    return Material(
      color: selected ? const Color(0xffe9dcff) : const Color(0xffedf5ff),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => setState(() {
          data['plan_id'] = plan['id'];
          data['plan_name'] = plan['name'];
          missing.remove('plan_id');
          error = null;
        }),
        child: AnimatedContainer(
          duration: motionDuration(context),
          constraints: const BoxConstraints(minHeight: 112),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            border: Border.all(
              color: selected ? RelayPalette.plum : const Color(0xffc9dff9),
              width: selected ? 2 : 1,
            ),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${plan['name']}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 14,
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Icon(
                    selected ? Icons.check_circle : Icons.circle_outlined,
                    size: 20,
                    color: RelayPalette.plum,
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                'AED ${plan['monthly_cost']}${plan['name'] == 'Tourist Prepaid' ? '' : ' / month'}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  color: Color(0xff6940a3),
                ),
              ),
              if (promotion.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(
                  promotion,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    color: Color(0xff526277),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  List<List<Offset>> get signatureStrokes => (data['signature'] as List? ?? [])
      .map(
        (s) => (s as List)
            .map(
              (p) => Offset((p[0] as num).toDouble(), (p[1] as num).toDouble()),
            )
            .toList(),
      )
      .toList();

  Future<void> captureSignature() async {
    var strokes = signatureStrokes;
    final result = await showModalBottomSheet<List<List<Offset>>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, update) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Customer signature',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Close signature',
                      onPressed: () => Navigator.pop(sheetContext),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                SignaturePad(
                  height: 220,
                  value: strokes,
                  onChanged: (value) => update(() => strokes = value),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: strokes.isEmpty
                            ? null
                            : () => update(() => strokes = []),
                        icon: const Icon(Icons.refresh, size: 18),
                        label: const Text('Reset'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: strokes.expand((s) => s).length < 2
                            ? null
                            : () => Navigator.pop(sheetContext, strokes),
                        icon: const Icon(Icons.check, size: 18),
                        label: const Text('Confirm'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
    if (mounted && result != null) {
      set(
        'signature',
        result.map((s) => s.map((p) => [p.dx, p.dy]).toList()).toList(),
      );
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('New transaction'),
      actions: [
        TextButton(
          onPressed: busy ? null : widget.onHistory,
          child: const Text('History'),
        ),
      ],
    ),
    bottomNavigationBar: SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: const BoxDecoration(
          color: Colors.white,
          boxShadow: [
            BoxShadow(
              color: Color(0x147541B0),
              blurRadius: 20,
              offset: Offset(0, -4),
            ),
          ],
        ),
        child: Row(
          children: [
            if (step > 0)
              IconButton(
                tooltip: 'Back',
                onPressed: busy ? null : () => setState(() => step = 0),
                icon: const Icon(Icons.arrow_back_rounded),
              ),
            TextButton(
              onPressed: busy ? null : () => save(false),
              child: const Text('Save draft'),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton.icon(
                onPressed: busy ? null : () => save(true),
                icon: busy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.arrow_forward_rounded),
                label: Text(busy ? 'Saving…' : 'Continue'),
              ),
            ),
          ],
        ),
      ),
    ),
    body: EnterSurface(
      key: ValueKey(step),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        children: [
          Row(
            children: [
              for (int i = 0; i < 3; i++)
                Expanded(
                  child: AnimatedContainer(
                    duration: motionDuration(context),
                    margin: const EdgeInsets.all(3),
                    padding: const EdgeInsets.symmetric(vertical: 9),
                    decoration: BoxDecoration(
                      gradient: i == step ? RelayPalette.hero : null,
                      color: i == step
                          ? null
                          : [
                              const Color(0xffece2ff),
                              const Color(0xffe0efff),
                              const Color(0xffd9f5eb),
                            ][i],
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      '${i + 1}. ${['Identity', 'SIM & plan', 'Payment'][i]}',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: i == step
                            ? Colors.white
                            : const Color(0xff583186),
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          if (error != null)
            Text(error!, style: const TextStyle(color: Colors.red)),
          if (step == 0) ...[
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'National ID', label: Text('Emirates ID')),
                ButtonSegment(value: 'Passport', label: Text('Passport')),
              ],
              selected: {data['document_type'] ?? 'National ID'},
              onSelectionChanged: (v) => set('document_type', v.first),
            ),
            const SizedBox(height: 10),
            if (data['document_image'] == null && !reading && !scannerPaused)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: IntakeCamera(
                  key: scannerKey,
                  embedded: true,
                  document: data['document_type'] == 'Passport'
                      ? 'Passport'
                      : 'Emirates ID',
                  onAutoDetect: autoRead,
                  onResult: (result) =>
                      photo('document_image', false, captured: result),
                ),
              )
            else
              ScanSurface(
                image: data['document_image'],
                reading: reading,
                illustration: ref.read(serviceProvider).isPreview,
                document: data['document_type'] == 'Passport'
                    ? 'Passport'
                    : 'Emirates ID',
              ),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: busy
                        ? null
                        : () {
                            if (scannerKey.currentState != null) {
                              scannerKey.currentState!.expand();
                            } else {
                              setState(() => data.remove('document_image'));
                            }
                          },
                    icon: const Icon(Icons.document_scanner),
                    label: const Text('Scan document', maxLines: 1),
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      minimumSize: const Size.fromHeight(48),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: busy
                        ? null
                        : () => photo('document_image', true),
                    icon: const Icon(
                      Icons.add_photo_alternate_outlined,
                      size: 18,
                    ),
                    label: const Text('Upload photo', maxLines: 1),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      minimumSize: const Size.fromHeight(48),
                      backgroundColor: const Color(0xffffedf5),
                      foregroundColor: const Color(0xff912a58),
                      side: const BorderSide(color: Color(0xffd890b4)),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(13),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            field('name', 'Full name'),
            field('document_number', 'Document number'),
            field('nationality', 'Nationality'),
            LayoutBuilder(
              builder: (context, constraints) => constraints.maxWidth < 320
                  ? Column(
                      children: [
                        field('birth_date', 'Date of birth', date: true),
                        field('expiry_date', 'Expiry date', date: true),
                      ],
                    )
                  : Row(
                      children: [
                        Expanded(
                          child: field(
                            'birth_date',
                            'Date of birth',
                            date: true,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: field(
                            'expiry_date',
                            'Expiry date',
                            date: true,
                          ),
                        ),
                      ],
                    ),
            ),
            OutlinedButton.icon(
              onPressed: busy ? null : () => photo('selfie_image', false),
              icon: const Icon(Icons.face),
              label: Text(
                data['selfie_image'] == null
                    ? 'Selfie · optional'
                    : 'Selfie saved',
              ),
            ),
          ] else ...[
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'PHYSICAL', label: Text('Physical SIM')),
                ButtonSegment(value: 'ESIM', label: Text('eSIM')),
              ],
              selected: {data['sim_type'] ?? 'PHYSICAL'},
              onSelectionChanged: (v) => set('sim_type', v.first),
            ),
            const SizedBox(height: 10),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: field(
                    'sim_identifier',
                    data['sim_type'] == 'ESIM'
                        ? 'eSIM identifier'
                        : 'SIM serial / ICCID',
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(bottom: 16, left: 8),
                  child: SizedBox(
                    width: 52,
                    height: 56,
                    child: IconButton.filledTonal(
                      tooltip: 'Scan SIM barcode',
                      onPressed: busy ? null : scanSim,
                      icon: const Icon(Icons.qr_code_scanner),
                    ),
                  ),
                ),
              ],
            ),
            field('msisdn', 'Phone number', keyboardType: TextInputType.phone),
            const Text(
              'Subscriber plan',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            LayoutBuilder(
              builder: (context, constraints) {
                final columns = constraints.maxWidth < 320 ? 1 : 2;
                final width =
                    (constraints.maxWidth - (columns - 1) * 8) / columns;
                return Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final p in plans)
                      SizedBox(width: width, child: _planCard(p)),
                  ],
                );
              },
            ),
            const SizedBox(height: 12),
            const Text(
              'Customer signature',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            if (missing.contains('signature'))
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text(
                  'Required',
                  style: TextStyle(color: Colors.red, fontSize: 12),
                ),
              ),
            OutlinedButton.icon(
              onPressed: captureSignature,
              icon: Icon(
                signatureStrokes.expand((s) => s).length >= 2
                    ? Icons.check_circle
                    : Icons.draw_outlined,
              ),
              label: Text(
                signatureStrokes.expand((s) => s).length >= 2
                    ? 'Signature saved · Edit'
                    : 'Add customer signature',
              ),
            ),
          ],
          const SizedBox(height: 12),
        ],
      ),
    ),
  );
}
