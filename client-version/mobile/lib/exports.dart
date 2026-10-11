import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';
import 'services.dart';
import 'typography.dart';

Future<ExportDocument> fetchExportDocument(
  RelayService service, {
  required String endpoint,
  required String format,
  required String filenameStem,
  Map<String, dynamic> query = const {},
}) async {
  final response = await service.dio.get<List<int>>(
    endpoint,
    queryParameters: service.branchQuery({...query, 'format': format}),
    options: Options(responseType: ResponseType.bytes),
  );
  return ExportDocument.fromResponse(
    response,
    format: format,
    fallbackFilename: '$filenameStem.$format',
  );
}

String exportMimeType(String format) => switch (format.toLowerCase()) {
  'pdf' => 'application/pdf',
  'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'csv' => 'text/csv',
  'png' => 'image/png',
  'jpg' || 'jpeg' => 'image/jpeg',
  _ => 'application/octet-stream',
};

/// Use the server's report identity while never accepting paths as filenames.
String exportFileName(Headers headers, String fallback) {
  final disposition = headers.value('content-disposition') ?? '';
  final encoded = RegExp(
    r"filename\*\s*=\s*(?:UTF-8'')?([^;]+)",
    caseSensitive: false,
  ).firstMatch(disposition);
  final plain = RegExp(
    r'filename\s*=\s*(?:"([^"]*)"|([^;]*))',
    caseSensitive: false,
  ).firstMatch(disposition);
  String? candidate;
  if (encoded != null) {
    try {
      candidate = Uri.decodeComponent(
        encoded.group(1)!.trim().replaceAll('"', ''),
      );
    } on FormatException {
      candidate = null;
    }
  }
  candidate ??= plain?.group(1) ?? plain?.group(2);
  if (candidate == null || candidate.contains(RegExp(r'[\r\n\x00]'))) {
    return fallback;
  }
  final name = candidate.replaceAll('\\', '/').split('/').last.trim();
  final sanitized = name.replaceAll(RegExp(r'[^A-Za-z0-9._ -]'), '-');
  final extension = fallback.split('.').last.toLowerCase();
  if (sanitized.isEmpty ||
      sanitized.startsWith('.') ||
      !sanitized.toLowerCase().endsWith('.$extension')) {
    return fallback;
  }
  return sanitized.length <= 160
      ? sanitized
      : '${sanitized.substring(0, 150)}.$extension';
}

Uint8List validatedExportBytes(dynamic value, String format) {
  if (value is! List<int> || value.isEmpty) {
    throw const FormatException('The export was empty. Please try again.');
  }
  final bytes = Uint8List.fromList(value);
  final prefix = utf8.decode(bytes.take(80).toList(), allowMalformed: true);
  final kind = format.toLowerCase();
  if ((kind == 'pdf' && !prefix.startsWith('%PDF-')) ||
      (kind == 'xlsx' &&
          (bytes.length < 4 ||
              bytes[0] != 0x50 ||
              bytes[1] != 0x4b ||
              bytes[2] != 0x03 ||
              bytes[3] != 0x04)) ||
      prefix.trimLeft().toLowerCase().startsWith('<!doctype html') ||
      prefix.trimLeft().toLowerCase().startsWith('<html')) {
    throw const FormatException(
      'The export could not be prepared. Please try again.',
    );
  }
  return bytes;
}

String exportError(Object error) {
  if (error is FormatException) return error.message.toString();
  if (error is DioException) {
    dynamic data = error.response?.data;
    if (data is List<int>) {
      try {
        data = jsonDecode(utf8.decode(data));
      } on FormatException {
        data = null;
      }
    }
    if (data is Map && data['detail'] is String) return data['detail'];
    if (error.response == null) {
      return 'Connection unavailable. Try exporting again.';
    }
  }
  return 'Could not export this file. Please try again.';
}

class ExportDocument {
  const ExportDocument({
    required this.bytes,
    required this.filename,
    required this.mimeType,
  });

  final Uint8List bytes;
  final String filename, mimeType;

  factory ExportDocument.fromResponse(
    Response<dynamic> response, {
    required String format,
    required String fallbackFilename,
  }) => ExportDocument(
    bytes: validatedExportBytes(response.data, format),
    filename: exportFileName(response.headers, fallbackFilename),
    mimeType: exportMimeType(format),
  );

  ShareParams shareParams({Rect? origin}) => ShareParams(
    title: filename,
    files: [XFile.fromData(bytes, name: filename, mimeType: mimeType)],
    fileNameOverrides: [filename],
    sharePositionOrigin: origin,
    downloadFallbackEnabled: true,
    mailToFallbackEnabled: false,
  );

  Future<ShareResult> share(BuildContext context) {
    final box = context.findRenderObject();
    final origin = box is RenderBox && box.hasSize
        ? box.localToGlobal(Offset.zero) & box.size
        : null;
    return SharePlus.instance.share(shareParams(origin: origin));
  }
}

/// A single compact export button, with format choices in its menu.
class ExportActions extends ConsumerStatefulWidget {
  const ExportActions({
    super.key,
    required this.endpoint,
    required this.filenameStem,
    this.label = 'Export',
    this.query = const {},
    this.enabled = true,
  });

  final String endpoint, filenameStem, label;
  final Map<String, dynamic> query;
  final bool enabled;

  @override
  ConsumerState<ExportActions> createState() => _ExportActionsState();
}

class _ExportActionsState extends ConsumerState<ExportActions> {
  bool busy = false;
  String? error, notice, activeFormat;
  int revision = 0;

  @override
  void didUpdateWidget(ExportActions oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.endpoint != widget.endpoint ||
        jsonEncode(oldWidget.query) != jsonEncode(widget.query)) {
      revision++;
      error = notice = null;
    }
  }

  Future<void> export(String format) async {
    if (busy || !widget.enabled) return;
    final request = ++revision;
    setState(() {
      busy = true;
      activeFormat = format;
      error = notice = null;
    });
    try {
      final document = await fetchExportDocument(
        ref.read(serviceProvider),
        endpoint: widget.endpoint,
        format: format,
        filenameStem: widget.filenameStem,
        query: widget.query,
      );
      if (!mounted || request != revision) return;
      final result = await document.share(context);
      if (mounted &&
          request == revision &&
          result.status != ShareResultStatus.dismissed) {
        setState(() => notice = '${document.filename} ready');
      }
    } catch (e) {
      if (mounted && request == revision) {
        setState(() => error = exportError(e));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<String?>(
      serviceProvider.select((service) => service.branchId),
      (_, _) => setState(() {
        revision++;
        error = notice = null;
      }),
    );
    final user = ref.watch(serviceProvider).user;
    final ownExport = const ['/sales-management/export', '/commissions/export', '/incentives/export'].contains(widget.endpoint);
    final requiredGrant = ownExport && user?['role'] == 'Field Agent' ? 'read' : 'report.read';
    if (!(user?['permissions'] as List? ?? []).contains(requiredGrant)) {
      return const SizedBox.shrink();
    }
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        PopupMenuButton<String>(
          tooltip: widget.label,
          enabled: !busy && widget.enabled,
          onSelected: export,
          itemBuilder: (_) => [
            for (final option in const [
              ('xlsx', 'Excel', Icons.table_view_outlined),
              ('pdf', 'PDF', Icons.picture_as_pdf_outlined),
              ('csv', 'CSV', Icons.download_outlined),
            ])
              PopupMenuItem(
                value: option.$1,
                child: Row(
                  children: [
                    Icon(option.$3, size: 18),
                    const SizedBox(width: 10),
                    Text(option.$2),
                  ],
                ),
              ),
          ],
          child: Container(
            constraints: const BoxConstraints(minHeight: 44),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              border: Border.all(color: theme.colorScheme.outlineVariant),
              borderRadius: BorderRadius.circular(12),
              color: theme.colorScheme.surface,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (busy)
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                else
                  Icon(
                    Icons.download_outlined,
                    size: 18,
                    color: theme.colorScheme.primary,
                  ),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    busy
                        ? 'Preparing ${activeFormat == 'xlsx' ? 'Excel' : activeFormat?.toUpperCase()}…'
                        : widget.label,
                    style: RelayTypography.bodyStrong.copyWith(
                      color: theme.colorScheme.primary,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                const Icon(Icons.expand_more, size: 18),
              ],
            ),
          ),
        ),
        if (error != null) ...[
          const SizedBox(height: 8),
          Text(
            error!,
            style: RelayTypography.caption.copyWith(
              color: theme.colorScheme.error,
            ),
          ),
          TextButton(
            onPressed: busy ? null : () => export(activeFormat!),
            child: const Text('Retry export'),
          ),
        ],
        if (notice != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Semantics(
              liveRegion: true,
              child: Text(notice!, style: RelayTypography.caption),
            ),
          ),
      ],
    );
  }
}
