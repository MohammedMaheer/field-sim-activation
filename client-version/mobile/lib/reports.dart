import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';
import 'branch_filter.dart';
import 'services.dart';
import 'sales_presentation.dart';
import 'typography.dart';

DateTime reportToday([DateTime? instant]) {
  final day = (instant ?? DateTime.now()).toUtc().add(const Duration(hours: 4));
  return DateTime(day.year, day.month, day.day);
}

String reportDate(DateTime day) => day.toIso8601String().substring(0, 10);

class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});
  @override
  ConsumerState<ReportsScreen> createState() => _ReportsState();
}

class _ReportsState extends ConsumerState<ReportsScreen> {
  DateTime from = reportToday(), to = reportToday();
  String report = 'daily';
  String? error;
  bool loading = true, exporting = false;
  List<Json> sales = [];
  int request = 0;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    final currentRequest = ++request;
    setState(() {
      loading = true;
      error = null;
      sales = [];
    });
    try {
      final service = ref.read(serviceProvider);
      final result = await service.dio.get(
        '/sales-management/sales',
        queryParameters: service.branchQuery({
          'from_date': reportDate(from),
          'to_date': reportDate(to),
        }),
      );
      if (mounted && request == currentRequest) {
        setState(() {
          sales = (result.data as List).map((row) => Json.from(row)).toList();
          loading = false;
        });
      }
    } catch (e) {
      if (mounted && request == currentRequest) {
        setState(() {
          error = friendlyError(e);
          loading = false;
        });
      }
    }
  }

  Future<void> chooseDate(bool isFrom) async {
    final chosen = await showDatePicker(
      context: context,
      initialDate: isFrom ? from : to,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (chosen == null || !mounted) return;
    setState(() {
      if (isFrom) {
        from = chosen;
        if (from.isAfter(to)) to = from;
      } else {
        to = chosen;
        if (to.isBefore(from)) from = to;
      }
    });
    await load();
  }

  Future<void> export(String format) async {
    setState(() {
      exporting = true;
      error = null;
    });
    try {
      final service = ref.read(serviceProvider);
      final useExcel = format == 'xlsx';
      final result = await service.dio.get<List<int>>(
        useExcel ? '/sales-management/export' : '/reports/$report',
        queryParameters: service.branchQuery({
          'format': format,
          if (useExcel) ...{
            'from_date': reportDate(from),
            'to_date': reportDate(to),
          } else ...{
            'start': reportDate(from),
            'end': reportDate(to),
          },
        }),
        options: Options(responseType: ResponseType.bytes),
      );
      if (!mounted) return;
      final filename =
          'relay-$report-${reportDate(from)}-${reportDate(to)}.$format';
      await SharePlus.instance.share(
        ShareParams(
          files: [
            XFile.fromData(
              Uint8List.fromList(result.data!),
              name: filename,
              mimeType: format == 'pdf'
                  ? 'application/pdf'
                  : useExcel
                  ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                  : 'text/csv',
            ),
          ],
          fileNameOverrides: [filename],
        ),
      );
    } catch (e) {
      if (mounted) setState(() => error = friendlyError(e));
    } finally {
      if (mounted) setState(() => exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<String?>(
      serviceProvider.select((service) => service.branchId),
      (_, _) => load(),
    );
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const BranchFilter(),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => chooseDate(true),
                  icon: const Icon(Icons.calendar_today_outlined, size: 18),
                  label: Text(
                    'From\n${reportDate(from)}',
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => chooseDate(false),
                  icon: const Icon(Icons.calendar_today_outlined, size: 18),
                  label: Text(
                    'To\n${reportDate(to)}',
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: report,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Report'),
            items: const [
              DropdownMenuItem(value: 'daily', child: Text('Sales')),
              DropdownMenuItem(value: 'agent', child: Text('Sales agents')),
              DropdownMenuItem(value: 'team', child: Text('Team leaders')),
              DropdownMenuItem(value: 'branch', child: Text('Branches')),
              DropdownMenuItem(
                value: 'inventory',
                child: Text('SIM inventory'),
              ),
            ],
            onChanged: exporting
                ? null
                : (value) => setState(() => report = value!),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final format in [
                'csv',
                if (report == 'daily') 'xlsx',
                'pdf',
              ])
                OutlinedButton.icon(
                  onPressed: exporting || loading ? null : () => export(format),
                  icon: const Icon(Icons.download_outlined, size: 18),
                  label: Text(
                    format == 'xlsx' ? 'Excel' : format.toUpperCase(),
                  ),
                ),
            ],
          ),
          if (loading || exporting)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: LinearProgressIndicator(),
            ),
          if (error != null) ...[
            Text(error!, style: const TextStyle(color: Colors.red)),
            TextButton(onPressed: load, child: const Text('Retry')),
          ],
          if (!loading) ...[
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  children: [
                    _summary('Recorded sales', sales.length),
                    _summary(
                      'Net confirmed sales',
                      sales.where((row) => row['status'] == 'CLOSED').length,
                    ),
                    _summary(
                      'Cancelled sales',
                      sales.where((row) => row['status'] == 'CANCELLED').length,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            const Text('Sales by product', style: RelayTypography.section),
            for (final product in [
              'NEW',
              'MNP',
              'P2P',
              'HW',
              'ELIFE',
              'WASEL',
              'VISITOR',
            ])
              _summary(
                productLabel(product),
                sales
                    .where(
                      (row) =>
                          row['order_type'] == product &&
                          row['status'] == 'CLOSED',
                    )
                    .length,
              ),
          ],
        ],
      ),
    );
  }

  Widget _summary(String label, int value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Row(
      children: [
        Expanded(child: Text(label)),
        const SizedBox(width: 16),
        Text('$value', style: RelayTypography.bodyStrong),
      ],
    ),
  );
}
