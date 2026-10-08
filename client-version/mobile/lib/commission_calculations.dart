import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'services.dart';
import 'typography.dart';

String commissionPeriod(DateTime instant) => instant
    .toUtc()
    .add(const Duration(hours: 4))
    .toIso8601String()
    .substring(0, 7);
String commissionAmount(Json row) => row['amount'] == null
    ? 'Awaiting configuration'
    : 'AED ${(double.tryParse('${row['amount']}') ?? 0).toStringAsFixed(2)}';
String commissionLabel(dynamic value) =>
    '$value'.replaceAll('_', ' ').toLowerCase();

String _rateLabel(dynamic value) => switch ('$value') {
  'NEW' => 'New postpaid',
  'MNP' => 'MNP',
  'P2P' => 'P2P',
  'HW' => 'Home Wireless',
  'ELIFE' => 'eLife',
  'SLAB_1' => 'Slab 1',
  'SLAB_2' => 'Slab 2',
  'SLAB_3' => 'Slab 3',
  'GATE_1' => 'Gate 1',
  'GATE_2' => 'Gate 2',
  '2P_299' => '2P · AED 299',
  '3P_389' => '3P · AED 389',
  '3P_NEO_399' => '3P Neo · AED 399',
  '3P_429' => '3P · AED 429',
  '3P_515' => '3P · AED 515',
  '3P_639' => '3P · AED 639',
  _ => commissionLabel(value),
};

/// Uses the shared backend calculation; no estimated payouts on the device.
class CommissionCalculations extends ConsumerStatefulWidget {
  const CommissionCalculations({super.key, required this.history});
  final Widget history;
  @override
  ConsumerState<CommissionCalculations> createState() => _CommissionState();
}

class _CommissionState extends ConsumerState<CommissionCalculations> {
  String period = commissionPeriod(DateTime.now());
  List<Json> rows = [], policies = [];
  String error = '';
  bool loading = true, fetching = false;
  Timer? poll;
  @override
  void initState() {
    super.initState();
    load();
    poll = Timer.periodic(
      const Duration(seconds: 20),
      (_) => load(quiet: true),
    );
  }

  @override
  void dispose() {
    poll?.cancel();
    super.dispose();
  }

  Future<void> load({bool quiet = false}) async {
    if (fetching) return;
    fetching = true;
    final requested = period;
    if (!quiet) {
      setState(() {
        loading = true;
        error = '';
      });
    }
    try {
      final api = ref.read(serviceProvider).dio;
      final result = await Future.wait([
        api.get('/commissions/summary', queryParameters: {'period': requested}),
        api.get('/commissions/policies'),
      ]);
      if (mounted && requested == period) {
        setState(() {
          rows = (result[0].data['rows'] as List)
              .map((v) => Json.from(v))
              .toList();
          policies = (result[1].data as List).map((v) => Json.from(v)).toList();
          error = '';
        });
      }
    } catch (e) {
      if (mounted && !quiet) setState(() => error = friendlyError(e));
    } finally {
      fetching = false;
      if (mounted && !quiet) setState(() => loading = false);
    }
  }

  void shiftMonth(int offset) {
    if (fetching) return;
    final values = period.split('-').map(int.parse).toList();
    final date = DateTime(values[0], values[1] + offset);
    setState(
      () => period = '${date.year}-${date.month.toString().padLeft(2, '0')}',
    );
    load();
  }

  Widget summary() => RefreshIndicator(
    onRefresh: load,
    child: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            IconButton(
              onPressed: fetching ? null : () => shiftMonth(-1),
              tooltip: 'Previous month',
              icon: const Icon(Icons.chevron_left),
            ),
            Expanded(
              child: Text(
                period,
                textAlign: TextAlign.center,
                style: RelayTypography.section,
              ),
            ),
            IconButton(
              onPressed: fetching ? null : () => shiftMonth(1),
              tooltip: 'Next month',
              icon: const Icon(Icons.chevron_right),
            ),
          ],
        ),
        if (loading) const LinearProgressIndicator(),
        if (error.isNotEmpty) ...[
          Text(error),
          TextButton(onPressed: load, child: const Text('Retry')),
        ],
        if (!loading && error.isEmpty && rows.isEmpty)
          const Padding(
            padding: EdgeInsets.all(24),
            child: Text('No incentive profiles in your scope'),
          ),
        for (final row in rows)
          Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${row['name']}', style: RelayTypography.section),
                  const SizedBox(height: 4),
                  Text(
                    '${row['role']} · ${row['policy_name']}',
                    style: RelayTypography.caption,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    commissionAmount(row),
                    style: RelayTypography.section.copyWith(
                      color: row['amount'] == null
                          ? const Color(0xFF885400)
                          : const Color(0xFF087D69),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 12,
                    runSpacing: 6,
                    children: [
                      Text('${row['net_sales']} net sales'),
                      Text('${row['cancelled']} cancelled'),
                      Text('${row['in_progress']} in progress'),
                    ],
                  ),
                  if ((row['missing_inputs'] as List? ?? []).isNotEmpty)
                    ExpansionTile(
                      tilePadding: EdgeInsets.zero,
                      title: const Text('Required configuration'),
                      children: [
                        for (final value in row['missing_inputs'])
                          Align(
                            alignment: Alignment.centerLeft,
                            child: Padding(
                              padding: const EdgeInsets.only(bottom: 6),
                              child: Text(commissionLabel(value)),
                            ),
                          ),
                      ],
                    ),
                  for (final item in row['components'] as List? ?? [])
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: Text('${item['name']}'),
                      subtitle: Text(
                        item['reason']?.toString().isNotEmpty == true
                            ? '${item['reason']}'
                            : commissionLabel(item['status']),
                      ),
                      trailing: Text(
                        item['amount'] == null
                            ? 'Pending'
                            : 'AED ${item['amount']}',
                      ),
                    ),
                ],
              ),
            ),
          ),
      ],
    ),
  );

  Widget rates() => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      for (final policy in policies)
        Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: ExpansionTile(
            title: Text('${policy['name']}', style: RelayTypography.section),
            subtitle: Text(
              'Effective ${policy['valid_from']}${policy['valid_until'] == null ? '' : ' to ${policy['valid_until']}'}',
            ),
            childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
            children: [
              if (policy['rules']['monthly_rates'] != null) ...[
                rateHeading('Monthly rates'),
                const Text('Achievement · AED per sale'),
                const SizedBox(height: 8),
                ...rateRows(
                  policy['rules']['monthly_rates'],
                  '',
                  policy['rules']['bands'] as List? ?? [],
                ),
              ],
              if (policy['rules']['elife_rates'] != null) ...[
                rateHeading('eLife rates'),
                const Text('Achievement · AED per sale'),
                const SizedBox(height: 8),
                ...rateRows(
                  policy['rules']['elife_rates'],
                  '',
                  policy['rules']['bands'] as List? ?? [],
                ),
              ],
              if (policy['rules']['gate_rates'] is Map) ...[
                rateHeading('Gate rates'),
                for (final gate
                    in (policy['rules']['gate_rates'] as Map).entries)
                  gateRates(_rateLabel(gate.key), gate.value as Map),
              ],
              for (final note in policy['rules']['notes'] as List? ?? [])
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text('$note'),
                ),
            ],
          ),
        ),
    ],
  );

  Widget rateHeading(String title) => Padding(
    padding: const EdgeInsets.only(top: 12, bottom: 6),
    child: Align(
      alignment: Alignment.centerLeft,
      child: Text(title, style: RelayTypography.section),
    ),
  );

  Widget rateBox(String title, Widget child) => Container(
    width: double.infinity,
    margin: const EdgeInsets.only(bottom: 8),
    padding: const EdgeInsets.all(10),
    decoration: BoxDecoration(
      color: const Color(0xFFFAF8FF),
      border: Border.all(color: const Color(0xFFDDD3EF)),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: RelayTypography.bodyStrong),
        const SizedBox(height: 8),
        child,
      ],
    ),
  );

  Widget gateRates(String title, Map rates) => rateBox(
    title,
    Column(
      children: [
        ratePair(
          'Target',
          rates['target'] == null
              ? 'Configured per kiosk'
              : '${rates['target']} sales',
        ),
        for (final product in ['MNP', 'NEW', 'P2P'])
          if (rates[product] != null)
            ratePair(_rateLabel(product), 'AED ${rates[product]}'),
        if (rates['slab3_mrc_percent'] != null)
          ratePair(
            'Slab 3 bonus',
            '${rates['slab3_mrc_percent']}% of monthly charge',
          ),
      ],
    ),
  );

  Widget ratePair(String label, String value) => Container(
    padding: const EdgeInsets.symmetric(vertical: 7),
    decoration: const BoxDecoration(
      border: Border(bottom: BorderSide(color: Color(0xFFE9E2F2))),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: Text(label)),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: RelayTypography.bodyStrong,
          ),
        ),
      ],
    ),
  );

  List<Widget> rateRows(dynamic value, String label, List bands) {
    if (value == null) return [];
    if (value is Map) {
      return [
        for (final key in value.keys)
          ...rateRows(
            value[key],
            [if (label.isNotEmpty) label, _rateLabel(key)].join(' · '),
            bands,
          ),
      ];
    }
    final values = value is List ? value : [value];
    return [
      rateBox(
        label.isEmpty ? 'Per sale' : label,
        LayoutBuilder(
          builder: (context, constraints) {
            final scale = MediaQuery.textScalerOf(context).scale(14) / 14;
            final columns = constraints.maxWidth >= 240 && scale <= 1.3 ? 2 : 1;
            final width = (constraints.maxWidth - (columns - 1) * 8) / columns;
            return Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                for (var index = 0; index < values.length; index++)
                  SizedBox(
                    width: width,
                    child: ratePair(
                      index < bands.length ? '${bands[index]}%' : 'Rate',
                      'AED ${values[index]}',
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    ];
  }

  @override
  Widget build(BuildContext context) => DefaultTabController(
    length: 3,
    child: Column(
      children: [
        const TabBar(
          tabs: [
            Tab(text: 'Calculated'),
            Tab(text: 'Rate tables'),
            Tab(text: 'History'),
          ],
        ),
        Expanded(
          child: TabBarView(children: [summary(), rates(), widget.history]),
        ),
      ],
    ),
  );
}
