import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'services.dart';
import 'branch_filter.dart';
import 'sales_presentation.dart';
import 'exports.dart';
import 'typography.dart';

class FinalIncentiveHistory extends ConsumerStatefulWidget {
  const FinalIncentiveHistory({super.key});
  @override
  ConsumerState<FinalIncentiveHistory> createState() => _FinalIncentiveState();
}

class _FinalIncentiveState extends ConsumerState<FinalIncentiveHistory> {
  late String from, to;
  List<Json> rows = [];
  bool busy = true;
  String? error;
  int generation = 0;
  bool refreshing = false;
  String get query => Uri(
    queryParameters: {
      'from_date': from,
      'to_date': to,
      'branch_id': ref.read(serviceProvider).branchId ?? '',
    },
  ).query;
  @override
  void initState() {
    super.initState();
    to = DateTime.now()
        .toUtc()
        .add(const Duration(hours: 4))
        .toIso8601String()
        .substring(0, 10);
    from = '${to.substring(0, 7)}-01';
    Future.microtask(load);
  }

  Future<void> load({bool background = false}) async {
    if (!mounted) return;
    if (background && refreshing) return;
    refreshing = true;
    final current = ++generation,
        service = ref.read(serviceProvider),
        userId = ref.read(serviceProvider).user?['id'];
    if (from.compareTo(to) > 0) {
      setState(() {
        error = 'From date must be before To date.';
        busy = false;
        rows = [];
      });
      refreshing = false;
      return;
    }
    setState(() {
      busy = !background;
      error = null;
      if (!background) rows = [];
    });
    try {
      final response = await service.dio.get('/incentives/final?$query');
      if (mounted && current == generation && service.user?['id'] == userId) {
        setState(
          () => rows = (response.data as List)
              .map((row) => Json.from(row))
              .toList(),
        );
      }
    } catch (failure) {
      if (mounted && current == generation) {
        setState(() => error = friendlyError(failure));
      }
    } finally {
      if (mounted && current == generation) {
        refreshing = false;
        setState(() => busy = false);
      }
    }
  }

  Future<void> choose(bool first) async {
    final selected = await showDatePicker(
      context: context,
      initialDate: DateTime.parse(first ? from : to),
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (selected != null && mounted) {
      setState(() {
        if (first) {
          from = selected.toIso8601String().substring(0, 10);
        } else {
          to = selected.toIso8601String().substring(0, 10);
        }
      });
      await load();
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<String?>(
      serviceProvider.select((s) => s.branchId),
      (_, _) => load(),
    );
    ref.listen<int>(
      serviceProvider.select((s) => s.syncRevision),
      (_, _) => load(background: true),
    );
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const BranchFilter(),
        const SizedBox(height: 12),
        const Text('Final commission amounts', style: RelayTypography.section),
        const SizedBox(height: 6),
        const Text(
          'Approved imported amounts. Calculated estimates are separate.',
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 12,
          runSpacing: 8,
          children: [
            OutlinedButton(
              onPressed: () => choose(true),
              child: Text('From $from'),
            ),
            OutlinedButton(
              onPressed: () => choose(false),
              child: Text('To $to'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        ExportActions(
          endpoint: '/incentives/final/export?$query',
          filenameStem: 'qanawat-final-incentives',
          label: 'Export final amounts',
        ),
        const SizedBox(height: 12),
        if (busy)
          const Center(child: CircularProgressIndicator())
        else ...[
          if (error != null) ...[
            Text(error!, style: const TextStyle(color: Colors.red)),
            TextButton(onPressed: load, child: const Text('Retry')),
          ],
          Text(
            'AED ${rows.fold<double>(0, (sum, row) => sum + (double.tryParse('${row['amount']}') ?? 0)).toStringAsFixed(2)}',
            style: RelayTypography.title,
          ),
          const SizedBox(height: 10),
          if (rows.isEmpty && error == null)
            const Text('No final amounts recorded for these filters.'),
          for (final row in rows)
            Card(
              key: ValueKey(row['id']),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${row['name']} · AED ${row['amount']}',
                      style: RelayTypography.bodyStrong,
                    ),
                    const SizedBox(height: 5),
                    Text(
                      '${row['earned_on']} · ${salesRoleLabel(row['role'])}',
                    ),
                    Text(
                      '${row['branch']} · Team leader: ${row['team_leader']}',
                    ),
                    Text('Reference: ${row['reference']}'),
                    if ('${row['note']}'.isNotEmpty) Text('${row['note']}'),
                  ],
                ),
              ),
            ),
        ],
      ],
    );
  }
}
