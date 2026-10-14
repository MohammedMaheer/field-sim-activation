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
  String get today => DateTime.now()
      .toUtc()
      .add(const Duration(hours: 4))
      .toIso8601String()
      .substring(0, 10);

  String readableDate(String value) {
    final date = DateTime.tryParse(value);
    return date == null
        ? recordedValue(value)
        : MaterialLocalizations.of(context).formatMediumDate(date);
  }

  Future<void> quickRange(bool month) async {
    setState(() {
      to = today;
      from = month ? '${to.substring(0, 7)}-01' : to;
    });
    await load();
  }

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
    to = today;
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
      lastDate: DateTime.parse(today),
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
    ref.listen<String?>(
      serviceProvider.select((s) => s.user?['id'] as String?),
      (_, _) => load(),
    );
    final service = ref.watch(serviceProvider);
    final ownScope = [
      'Field Agent',
      'Team Leader',
    ].contains(service.user?['role']);
    final mayImport =
        [
          'Administrator',
          'Operations Manager',
        ].contains(service.user?['role']) &&
        (service.user?['permissions'] as List? ?? []).contains(
          'incentive.write',
        );
    final amounts = rows
        .map((row) => double.tryParse('${row['amount']}'))
        .toList();
    final totalKnown = amounts.every((amount) => amount != null);
    final total = amounts.fold<double>(0, (sum, amount) => sum + (amount ?? 0));
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          const BranchFilter(),
          const SizedBox(height: 12),
          Text(
            ownScope ? 'Your final commissions' : 'Final commission amounts',
            style: RelayTypography.section,
          ),
          const SizedBox(height: 6),
          Text(
            ownScope
                ? 'Your final amounts recorded by the admin. Choose a date range to see the total and each record.'
                : 'Final amounts imported by the admin. Choose a date range to see the total and each record.',
          ),
          if (mayImport) ...[
            const SizedBox(height: 6),
            const Text(
              'Import final amounts in the web portal.',
              style: RelayTypography.caption,
            ),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ChoiceChip(
                label: const Text('Today'),
                selected: from == today && to == today,
                onSelected: (_) => quickRange(false),
              ),
              ChoiceChip(
                label: const Text('This month'),
                selected: from == '${today.substring(0, 7)}-01' && to == today,
                onSelected: (_) => quickRange(true),
              ),
            ],
          ),
          const SizedBox(height: 8),
          RelayPair(
            first: OutlinedButton.icon(
              onPressed: () => choose(true),
              icon: const Icon(Icons.calendar_today_outlined, size: 16),
              label: Text('From ${readableDate(from)}'),
            ),
            second: OutlinedButton.icon(
              onPressed: () => choose(false),
              icon: const Icon(Icons.calendar_today_outlined, size: 16),
              label: Text('To ${readableDate(to)}'),
            ),
          ),
          const SizedBox(height: 12),
          if (busy)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 28),
              child: Column(
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 12),
                  Text('Loading final commissions…'),
                ],
              ),
            )
          else ...[
            if (error != null)
              Container(
                padding: const EdgeInsets.all(12),
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF4E1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      rows.isEmpty
                          ? 'Final commissions could not be loaded.'
                          : 'Could not refresh. Showing the last loaded amounts.',
                      style: RelayTypography.bodyStrong,
                    ),
                    const SizedBox(height: 4),
                    Text(error!),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: load,
                        icon: const Icon(Icons.refresh, size: 18),
                        label: const Text('Try again'),
                      ),
                    ),
                  ],
                ),
              ),
            if (rows.isEmpty && error == null)
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8F5FC),
                  border: Border.all(color: const Color(0xFFE0D6EC)),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.receipt_long_outlined, color: Color(0xFF872450)),
                    SizedBox(height: 10),
                    Text(
                      'No final commissions in this date range',
                      style: RelayTypography.bodyStrong,
                    ),
                    SizedBox(height: 4),
                    Text(
                      'Try another date range or branch. Final amounts appear after the admin imports them.',
                    ),
                  ],
                ),
              ),
            if (rows.isNotEmpty) ...[
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFFF1E9F6),
                  border: Border.all(color: const Color(0xFFDCC9E6)),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Final commission total',
                      style: RelayTypography.bodyStrong,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      totalKnown
                          ? 'AED ${total.toStringAsFixed(2)}'
                          : 'Total unavailable',
                      style: RelayTypography.title.copyWith(
                        color: const Color(0xFF872450),
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      '${rows.length} ${rows.length == 1 ? 'record' : 'records'} · ${readableDate(from)} – ${readableDate(to)}',
                      style: RelayTypography.caption,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              ExportActions(
                endpoint: '/incentives/final/export?$query',
                filenameStem: 'qanawat-final-incentives',
                label: 'Export final commissions',
                enabled: error == null,
              ),
              const SizedBox(height: 12),
              for (final row in rows)
                Card(
                  key: ValueKey(row['id']),
                  margin: const EdgeInsets.only(bottom: 10),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          recordedValue(row['name']),
                          style: RelayTypography.bodyStrong,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          double.tryParse('${row['amount']}') == null
                              ? 'Amount unavailable'
                              : 'AED ${double.parse('${row['amount']}').toStringAsFixed(2)}',
                          style: RelayTypography.section.copyWith(
                            color: const Color(0xFF087D69),
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          '${readableDate('${row['earned_on']}')} · ${salesRoleLabel(row['role'])}',
                          style: RelayTypography.caption,
                        ),
                        const Divider(height: 18),
                        Text(recordedValue(row['branch'])),
                        Text(
                          'Team leader: ${recordedValue(row['team_leader'])}',
                        ),
                        const SizedBox(height: 5),
                        Text('Reference: ${recordedValue(row['reference'])}'),
                        if (row['note'] != null &&
                            '${row['note']}'.trim().isNotEmpty) ...[
                          const SizedBox(height: 5),
                          Text(
                            '${row['note']}',
                            style: RelayTypography.caption,
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
            ],
          ],
        ],
      ),
    );
  }
}
