import 'sr_verification.dart';
import 'branch_filter.dart';
import 'sales_presentation.dart';
import 'product_targets.dart';
import 'workspace_menu.dart';
import 'notifications.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'services.dart';
import 'typography.dart';

// Reporting periods use the same Dubai business time as the API and web panel.
String salesReportingPeriod(DateTime instant) => instant
    .toUtc()
    .add(const Duration(hours: 4))
    .toIso8601String()
    .substring(0, 7);

class SalesManagementScreen extends ConsumerStatefulWidget {
  const SalesManagementScreen({super.key, this.selectedId});
  final String? selectedId;
  @override
  ConsumerState<SalesManagementScreen> createState() =>
      _SalesManagementScreenState();
}

class _SalesManagementScreenState extends ConsumerState<SalesManagementScreen> {
  int tab = 0;
  List<Json> sales = [];
  List<Json> feedback = [];
  List<Json> targets = [];
  List<Json> agents = [];
  Json performance = {};
  bool loading = true;
  String error = '';
  bool saving = false;
  bool fetching = false;
  bool reloadPending = false;
  Timer? poll;

  @override
  void initState() {
    super.initState();
    load().then((_) {
      if (mounted && widget.selectedId != null) {
        saleDetails({'id': widget.selectedId});
      }
    });
    poll = Timer.periodic(const Duration(seconds: 20), (_) {
      if (!saving) load(quiet: true);
    });
  }

  @override
  void dispose() {
    poll?.cancel();
    super.dispose();
  }

  Future<void> load({bool quiet = false}) async {
    if (fetching) {
      reloadPending = true;
      return;
    }
    fetching = true;
    if (!quiet) {
      setState(() {
        loading = true;
        error = '';
      });
    }
    try {
      final service = ref.read(serviceProvider);
      final period = salesReportingPeriod(DateTime.now());
      final requestedBranch = service.branchId;
      final results = await Future.wait([
        service.dio.get(
          '/sales-management/sales',
          queryParameters: service.branchQuery({'period': period}),
        ),
        service.dio.get('/sales-management/feedback'),
        service.dio.get(
          '/sales-management/performance',
          queryParameters: service.branchQuery({'period': period}),
        ),
        service.dio.get(
          '/sales-management/targets',
          queryParameters: service.branchQuery({'period': period}),
        ),
        service.dio.get('/resources/agents'),
      ]);
      if (!mounted || service.branchId != requestedBranch) return;
      setState(() {
        sales = (results[0].data as List)
            .map((v) => Map<String, dynamic>.from(v))
            .toList();
        feedback = (results[1].data as List)
            .map((v) => Map<String, dynamic>.from(v))
            .toList();
        performance = Map<String, dynamic>.from(results[2].data);
        targets = (results[3].data as List)
            .map((v) => Map<String, dynamic>.from(v))
            .toList();
        agents = (results[4].data as List)
            .map((v) => Map<String, dynamic>.from(v))
            .toList();
      });
    } catch (_) {
      if (mounted && !quiet) {
        setState(
          () =>
              error = 'Could not load sales. Check your connection and retry.',
        );
      }
    } finally {
      fetching = false;
      if (mounted && !quiet) setState(() => loading = false);
      if (mounted && reloadPending) {
        reloadPending = false;
        unawaited(load());
      }
    }
  }

  Future<void> addFeedback() async {
    final user = ref.read(serviceProvider).user;
    final agentId = user?['agent_id'];
    if (agentId == null) return;
    final product = TextEditingController();
    final comment = TextEditingController();
    final reason = TextEditingController();
    final customer = TextEditingController();
    final contact = TextEditingController();
    final form = GlobalKey<FormState>();
    final save = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => Padding(
        padding: EdgeInsets.fromLTRB(
          20,
          8,
          20,
          MediaQuery.viewInsetsOf(context).bottom + 20,
        ),
        child: SingleChildScrollView(
          child: Form(
            key: form,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('No-sale feedback', style: RelayTypography.section),
                const SizedBox(height: 16),
                TextFormField(
                  controller: customer,
                  decoration: const InputDecoration(labelText: 'Customer name'),
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: contact,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(
                    labelText: 'Contact number',
                  ),
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: product,
                  decoration: const InputDecoration(
                    labelText: 'Product suggested',
                  ),
                  validator: (v) =>
                      (v ?? '').trim().length < 2 ? 'Enter a product' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: reason,
                  decoration: const InputDecoration(labelText: 'Reason'),
                  validator: (v) =>
                      (v ?? '').trim().length < 3 ? 'Enter a reason' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: comment,
                  decoration: const InputDecoration(
                    labelText: 'Customer feedback',
                  ),
                  maxLines: 3,
                  validator: (v) =>
                      (v ?? '').trim().length < 3 ? 'Enter feedback' : null,
                ),
                const SizedBox(height: 18),
                FilledButton(
                  onPressed: () {
                    if (form.currentState!.validate()) {
                      Navigator.pop(context, true);
                    }
                  },
                  child: const Text('Save feedback'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    if (save != true || !mounted) return;
    setState(() => saving = true);
    try {
      await ref
          .read(serviceProvider)
          .dio
          .post(
            '/sales-management/feedback',
            data: {
              'agent_id': agentId,
              'customer_name': customer.text.trim(),
              'contact_number': contact.text.trim(),
              'product_suggested': product.text.trim(),
              'rejection_reason': reason.text.trim(),
              'feedback': comment.text.trim(),
            },
          );
      await load();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Feedback saved')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not save feedback. Please retry.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> saleDetails(Json row) async {
    try {
      final response = await ref
          .read(serviceProvider)
          .dio
          .get('/sales-management/sales/${row['id']}');
      final detail = Map<String, dynamic>.from(response.data);
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (context) => SafeArea(
          child: SizedBox(
            height: MediaQuery.sizeOf(context).height * .78,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 0, 18, 20),
              children: [
                Text(
                  '${detail['customer_name']}',
                  style: RelayTypography.section,
                ),
                const SizedBox(height: 12),
                for (final entry in const {
                  'status': 'Sale status',
                  'agent': 'Sales agent',
                  'leader': 'Team leader',
                  'sales_manager': 'Sales Manager',
                  'branch': 'Branch',
                  'assignment_effective_at': 'Assignment effective',
                  'order_type': 'Order type',
                  'plan_name': 'Plan',
                  'document': 'Document',
                  'nationality': 'Nationality',
                  'request_id': 'Request ID',
                  'account_number': 'Account number',
                  'msisdn': 'Phone number',
                  'sim_serial': 'SIM serial',
                  'router_fulfilment': 'Router fulfilment',
                  'router_serial': 'Router serial',
                  'advance_transaction_number': 'Advance transaction number',
                  'sr_number': 'SR number',
                  'alternate_number': 'Alternate number',
                }.entries)
                  _detailField(
                    entry.value,
                    entry.key == 'status'
                        ? activationLabel(detail)
                        : (detail[entry.key] ?? '').toString().isEmpty
                        ? 'Not recorded'
                        : '${detail[entry.key]}',
                  ),
                _detailField(
                  'SR verification',
                  srVerificationLabel(detail['sr_verification']?['status']),
                ),
                _detailField(
                  'Payment receipt',
                  detail['payment_record_status'] == 'RECORDED'
                      ? 'Recorded'
                      : 'Not recorded',
                ),
                const SizedBox(height: 12),
                for (final call in detail['calls'] as List)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Text(
                      '${call['stage'] == 'TELE_VERIFICATION' ? 'Tele-verification' : 'Welcome call'} · ${call['status']}',
                      style: RelayTypography.body,
                    ),
                  ),
                for (final attempt in detail['attempts'] as List)
                  Card(
                    margin: const EdgeInsets.only(bottom: 10),
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${attempt['outcome']} · ${attempt['actor']}',
                            style: RelayTypography.bodyStrong,
                          ),
                          const SizedBox(height: 6),
                          Text(
                            '${attempt['remark']}',
                            style: RelayTypography.body,
                          ),
                        ],
                      ),
                    ),
                  ),
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Close'),
                ),
              ],
            ),
          ),
        ),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not load sale details. Please retry.'),
          ),
        );
      }
    }
  }

  Future<void> setTarget() async {
    String? agentId;
    String product = 'ALL';
    final daily = TextEditingController(text: '0'),
        monthly = TextEditingController(text: '0');
    final form = GlobalKey<FormState>();
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => StatefulBuilder(
        builder: (context, change) => Padding(
          padding: EdgeInsets.fromLTRB(
            18,
            0,
            18,
            MediaQuery.viewInsetsOf(context).bottom + 18,
          ),
          child: SingleChildScrollView(
            child: Form(
              key: form,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('Set target', style: RelayTypography.section),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    decoration: const InputDecoration(labelText: 'Sales agent'),
                    isExpanded: true,
                    items: [
                      for (final agent in agents.where(
                        (agent) => agent['employment_status'] == 'ACTIVE',
                      ))
                        DropdownMenuItem(
                          value: '${agent['id']}',
                          child: Text('${agent['name']}'),
                        ),
                    ],
                    onChanged: (value) => agentId = value,
                    validator: (value) =>
                        value == null ? 'Choose sales agent' : null,
                  ),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<String>(
                    initialValue: product,
                    decoration: const InputDecoration(labelText: 'Product'),
                    items: [
                      for (final value in [
                        'ALL',
                        'NEW',
                        'MNP',
                        'P2P',
                        'HW',
                        'ELIFE',
                        'WASEL',
                        'VISITOR',
                      ])
                        DropdownMenuItem(
                          value: value,
                          child: Text(productLabel(value)),
                        ),
                    ],
                    onChanged: (value) => product = value!,
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: daily,
                    decoration: const InputDecoration(
                      labelText: 'Daily target',
                    ),
                    keyboardType: TextInputType.number,
                    validator: (value) =>
                        int.tryParse(value ?? '') == null ||
                            int.parse(value!) < 0 ||
                            int.parse(value) > 1000
                        ? 'Enter 0–1000'
                        : null,
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: monthly,
                    decoration: const InputDecoration(
                      labelText: 'Monthly target',
                    ),
                    keyboardType: TextInputType.number,
                    validator: (value) =>
                        int.tryParse(value ?? '') == null ||
                            int.parse(value!) < 0 ||
                            int.parse(value) > 10000
                        ? 'Enter 0–10000'
                        : null,
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: () {
                      if (form.currentState!.validate()) {
                        Navigator.pop(context, true);
                      }
                    },
                    child: const Text('Save target'),
                  ),
                  TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: const Text('Cancel'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    if (saved == true) {
      try {
        await ref
            .read(serviceProvider)
            .dio
            .put(
              '/sales-management/targets',
              data: {
                'agent_id': agentId,
                'order_type': product,
                'period':
                    performance['period'] ??
                    salesReportingPeriod(DateTime.now()),
                'daily_target': int.parse(daily.text),
                'monthly_target': int.parse(monthly.text),
              },
            );
        await load();
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Could not save target. Please retry.'),
            ),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<String?>(serviceProvider.select((service) => service.branchId), (
      _,
      _,
    ) {
      load();
    });
    final isAgent = ref.watch(serviceProvider).user?['agent_id'] != null;
    final canSet = [
      'Administrator',
      'Operations Manager',
      'Team Leader',
    ].contains(ref.watch(serviceProvider).user?['role']);
    final textScale = MediaQuery.textScalerOf(context).scale(14) / 14;
    final compact = MediaQuery.sizeOf(context).width < 360 || textScale > 1.2;
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: textScale > 1.2 ? 52 * textScale : 64,
        title: const Text('Sales management'),
        actions: [
          const NotificationBell(),
          const WorkspaceMenu(),
          if (compact)
            PopupMenuButton<String>(
              tooltip: 'Sales actions',
              onSelected: (action) {
                if (action == 'refresh') {
                  load();
                } else if (action == 'logout') {
                  ref.read(serviceProvider).logout();
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'refresh', child: Text('Refresh')),
                PopupMenuItem(value: 'logout', child: Text('Sign out')),
              ],
            )
          else ...[
            IconButton(
              onPressed: load,
              icon: const Icon(Icons.refresh),
              tooltip: 'Refresh',
            ),
            IconButton(
              onPressed: () => ref.read(serviceProvider).logout(),
              icon: const Icon(Icons.logout),
              tooltip: 'Sign out',
            ),
          ],
        ],
      ),
      floatingActionButton: tab == 1 && isAgent
          ? FloatingActionButton.extended(
              onPressed: saving ? null : addFeedback,
              icon: const Icon(Icons.add),
              label: const Text('Add feedback'),
            )
          : tab == 2 && canSet
          ? FloatingActionButton.extended(
              onPressed: setTarget,
              icon: const Icon(Icons.flag_outlined),
              label: const Text('Set target'),
            )
          : null,
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error.isNotEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      error,
                      style: RelayTypography.body,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    TextButton(onPressed: load, child: const Text('Retry')),
                  ],
                ),
              ),
            )
          : Column(
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(14, 12, 14, 0),
                  child: BranchFilter(),
                ),
                Container(
                  margin: const EdgeInsets.all(14),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF7428B4), Color(0xFFB02D87)],
                    ),
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final metrics = [
                        _metric('Recorded', '${performance['recorded'] ?? 0}'),
                        _metric('Closed', '${performance['closed'] ?? 0}'),
                        _metric(
                          'Remaining',
                          '${performance['remaining'] ?? 0}',
                        ),
                      ];
                      if (constraints.maxWidth / textScale < 300) {
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            for (var i = 0; i < metrics.length; i++) ...[
                              if (i > 0) const SizedBox(height: 12),
                              _metricRow(
                                ['Recorded', 'Closed', 'Remaining'][i],
                                [
                                  '${performance['recorded'] ?? 0}',
                                  '${performance['closed'] ?? 0}',
                                  '${performance['remaining'] ?? 0}',
                                ][i],
                              ),
                            ],
                          ],
                        );
                      }
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          for (var i = 0; i < metrics.length; i++) ...[
                            if (i > 0) const SizedBox(width: 12),
                            Expanded(child: metrics[i]),
                          ],
                        ],
                      );
                    },
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
                  child: Wrap(
                    spacing: 12,
                    runSpacing: 6,
                    children: [
                      Text(
                        'Current run rate: ${performance['crr'] == null ? '—' : (performance['crr'] as num).toStringAsFixed(2)}',
                        style: RelayTypography.caption,
                      ),
                      Text(
                        'Daily required rate: ${performance['drr'] == null ? '—' : (performance['drr'] as num).toStringAsFixed(2)}',
                        style: RelayTypography.caption,
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  child: compact
                      ? Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            for (var i = 0; i < 3; i++)
                              ChoiceChip(
                                label: Text(
                                  ['Sales', 'Feedback', 'Targets'][i],
                                  style: RelayTypography.label,
                                ),
                                selected: tab == i,
                                onSelected: (_) => setState(() => tab = i),
                              ),
                          ],
                        )
                      : SegmentedButton<int>(
                          segments: const [
                            ButtonSegment(value: 0, label: Text('Sales')),
                            ButtonSegment(value: 1, label: Text('Feedback')),
                            ButtonSegment(value: 2, label: Text('Targets')),
                          ],
                          selected: {tab},
                          onSelectionChanged: (value) =>
                              setState(() => tab = value.first),
                        ),
                ),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: load,
                    child: ListView.builder(
                      padding: const EdgeInsets.fromLTRB(14, 14, 14, 90),
                      itemCount: tab == 2
                          ? targets.length + 1
                          : (tab == 0
                                    ? sales.length
                                    : tab == 1
                                    ? feedback.length
                                    : targets.length) ==
                                0
                          ? 1
                          : tab == 0
                          ? sales.length
                          : tab == 1
                          ? feedback.length
                          : targets.length,
                      itemBuilder: (context, index) {
                        if (tab == 2) {
                          if (index == 0) {
                            return ProductTargets(performance: performance);
                          }
                          index -= 1;
                        }
                        if ((tab == 0
                                ? sales
                                : tab == 1
                                ? feedback
                                : targets)
                            .isEmpty) {
                          return Padding(
                            padding: const EdgeInsets.all(20),
                            child: Text(
                              tab == 0
                                  ? 'No sales recorded yet'
                                  : tab == 1
                                  ? 'No feedback recorded yet'
                                  : 'No targets set for this month',
                              style: RelayTypography.body,
                              textAlign: TextAlign.center,
                            ),
                          );
                        }
                        final row = tab == 0
                            ? sales[index]
                            : tab == 1
                            ? feedback[index]
                            : targets[index];
                        if (tab == 2) {
                          return Card(
                            margin: const EdgeInsets.only(bottom: 12),
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '${row['agent']}',
                                    style: RelayTypography.bodyStrong,
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    '${row['period']} · ${productLabel(row['order_type'])}',
                                    style: RelayTypography.caption,
                                  ),
                                  const SizedBox(height: 12),
                                  Wrap(
                                    spacing: 20,
                                    runSpacing: 8,
                                    children: [
                                      Text(
                                        '${row['daily_target']} / day',
                                        style: RelayTypography.bodyStrong,
                                      ),
                                      Text(
                                        '${row['monthly_target']} / month',
                                        style: RelayTypography.bodyStrong,
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        }
                        if (tab == 0) {
                          return Card(
                            margin: const EdgeInsets.only(bottom: 12),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(16),
                              onTap: () => saleDetails(row),
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Expanded(
                                          child: Text(
                                            '${row['customer_name']}',
                                            style: RelayTypography.bodyStrong,
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        const Icon(Icons.chevron_right),
                                      ],
                                    ),
                                    const SizedBox(height: 8),
                                    Text(
                                      '${row['plan_name']} · ${productLabel(row['order_type'])}',
                                      style: RelayTypography.body,
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      '${row['request_id']} · ${activationLabel(row)}',
                                      style: RelayTypography.caption,
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      srVerificationLabel(
                                        row['sr_verification']?['status'],
                                      ),
                                      style: RelayTypography.caption.copyWith(
                                        color:
                                            row['sr_verification']?['status'] ==
                                                'MISMATCH'
                                            ? const Color(0xffad2449)
                                            : const Color(0xff795509),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          );
                        }
                        return Card(
                          margin: const EdgeInsets.only(bottom: 9),
                          child: Padding(
                            padding: const EdgeInsets.all(13),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  (row['customer_name'] as String?)
                                              ?.isNotEmpty ==
                                          true
                                      ? row['customer_name']
                                      : 'Customer not recorded',
                                  style: RelayTypography.bodyStrong,
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  tab == 0
                                      ? '${row['plan_name']} · ${row['order_type']}'
                                      : '${row['product_suggested']} · ${row['rejection_reason']}',
                                  style: RelayTypography.body,
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  tab == 0
                                      ? '${row['request_id']} · ${row['status']}'
                                      : '${row['feedback']}',
                                  style: RelayTypography.body.copyWith(
                                    color: const Color(0xFF60677C),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _metric(String label, String value) => Column(
    children: [
      Text(
        label,
        style: RelayTypography.label.copyWith(color: Colors.white),
        textAlign: TextAlign.center,
      ),
      const SizedBox(height: 6),
      Text(
        value,
        style: RelayTypography.numeric.copyWith(
          fontSize: 26,
          fontWeight: FontWeight.w700,
          color: Colors.white,
        ),
        textAlign: TextAlign.center,
      ),
    ],
  );

  Widget _metricRow(String label, String value) => Row(
    crossAxisAlignment: CrossAxisAlignment.center,
    children: [
      Expanded(
        flex: 3,
        child: Text(
          label,
          style: RelayTypography.label.copyWith(color: Colors.white),
        ),
      ),
      const SizedBox(width: 16),
      Expanded(
        flex: 2,
        child: Text(
          value,
          style: RelayTypography.numeric.copyWith(
            fontSize: 24,
            fontWeight: FontWeight.w700,
            color: Colors.white,
          ),
          textAlign: TextAlign.right,
        ),
      ),
    ],
  );

  Widget _detailField(String label, String value) => Container(
    padding: const EdgeInsets.symmetric(vertical: 12),
    decoration: const BoxDecoration(
      border: Border(bottom: BorderSide(color: Color(0xFFE0D9ED))),
    ),
    child: LayoutBuilder(
      builder: (context, constraints) {
        final labelText = Text(
          label,
          style: RelayTypography.label.copyWith(color: const Color(0xFF657089)),
        );
        final valueText = Text(value, style: RelayTypography.bodyStrong);
        if (constraints.maxWidth < 360 ||
            MediaQuery.textScalerOf(context).scale(14) / 14 > 1.2) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [labelText, const SizedBox(height: 6), valueText],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(flex: 2, child: labelText),
            const SizedBox(width: 20),
            Expanded(flex: 3, child: valueText),
          ],
        );
      },
    ),
  );
}
