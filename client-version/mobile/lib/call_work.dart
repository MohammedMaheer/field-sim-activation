import 'notifications.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'services.dart';
import 'role_access.dart';
import 'branch_filter.dart';
import 'typography.dart';

bool canRecordCall(Json task, Json? user) {
  if (!['PENDING', 'FAILED'].contains(task['status'])) return false;
  final permissions = (user?['permissions'] as List? ?? []).cast<String>();
  final required = task['stage'] == 'TELE_VERIFICATION'
      ? 'call.tele.write'
      : 'call.welcome.write';
  return permissions.contains(required) ||
      ([
            'Administrator',
            'Operations Manager',
            'Compliance Officer',
          ].contains(user?['role']) &&
          permissions.contains('compliance.write'));
}

class CallWorkScreen extends ConsumerStatefulWidget {
  const CallWorkScreen({super.key, this.selectedId});
  final String? selectedId;
  @override
  ConsumerState<CallWorkScreen> createState() => _CallWorkScreenState();
}

class _CallWorkScreenState extends ConsumerState<CallWorkScreen> {
  List<Json> tasks = [];
  Json summary = {};
  bool loading = true;
  String error = '';
  String filter = 'Ready';
  Timer? poll;
  bool fetching = false;
  bool reloadPending = false;
  @override
  void initState() {
    super.initState();
    load().then((_) {
      if (mounted && widget.selectedId != null) {
        final matches = tasks.where((row) => row['id'] == widget.selectedId);
        if (matches.isNotEmpty) {
          if (canRecordCall(matches.first, ref.read(serviceProvider).user)) {
            record(matches.first);
          } else {
            setState(() => filter = 'All');
          }
        }
      }
    });
    poll = Timer.periodic(
      const Duration(seconds: 15),
      (_) => load(silent: true),
    );
  }

  @override
  void dispose() {
    poll?.cancel();
    super.dispose();
  }

  Future<void> load({bool silent = false}) async {
    if (!mounted) return;
    if (!canVisitMobilePage('/call-work', ref.read(serviceProvider).user)) {
      setState(() {
        loading = false;
        tasks = [];
        summary = {};
        error = 'Calling access is not available for your role';
      });
      return;
    }
    if (fetching) {
      reloadPending = true;
      return;
    }
    fetching = true;
    if (!silent) {
      setState(() {
        loading = true;
        error = '';
      });
    }
    try {
      final service = ref.read(serviceProvider);
      final requestedBranch = service.branchId;
      final results = await Future.wait([
        service.dio.get(
          '/sales-management/call-tasks',
          queryParameters: service.branchQuery(),
        ),
        service.dio.get(
          '/sales-management/call-tasks/summary',
          queryParameters: service.branchQuery(),
        ),
      ]);
      if (mounted && service.branchId == requestedBranch) {
        setState(() {
          error = '';
          tasks = (results[0].data as List)
              .map((value) => Map<String, dynamic>.from(value))
              .toList();
          summary = Map<String, dynamic>.from(results[1].data);
        });
      }
    } catch (_) {
      if (mounted && !silent) {
        setState(() => error = 'Could not load calls. Try again.');
      }
    } finally {
      fetching = false;
      if (mounted) setState(() => loading = false);
      if (mounted && reloadPending) {
        reloadPending = false;
        unawaited(load());
      }
    }
  }

  Future<void> record(Json task) async {
    if (!canRecordCall(task, ref.read(serviceProvider).user)) return;
    String outcome = '';
    String remark = '';
    final form = GlobalKey<FormState>();
    final submitted = await showModalBottomSheet<bool>(
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
                Text(
                  '${task['customer_name']}',
                  style: RelayTypography.section,
                ),
                const SizedBox(height: 6),
                Text(
                  task['stage'] == 'TELE_VERIFICATION'
                      ? 'Tele-verification'
                      : 'Welcome call',
                  style: RelayTypography.body,
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  isExpanded: true,
                  style: RelayTypography.body,
                  decoration: const InputDecoration(labelText: 'Outcome'),
                  items:
                      const [
                            'PASSED',
                            'REACHED',
                            'NO_ANSWER',
                            'RETRY',
                            'FAILED',
                          ]
                          .map(
                            (value) => DropdownMenuItem(
                              value: value,
                              child: Text(value.replaceAll('_', ' ')),
                            ),
                          )
                          .toList(),
                  onChanged: (value) => outcome = value ?? '',
                  validator: (value) =>
                      value == null ? 'Choose an outcome' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  initialValue: remark,
                  onChanged: (value) => remark = value,
                  decoration: const InputDecoration(labelText: 'Call remark'),
                  maxLines: 3,
                  validator: (value) =>
                      (value ?? '').trim().length < 3 ? 'Enter a remark' : null,
                ),
                const SizedBox(height: 18),
                FilledButton(
                  onPressed: () {
                    if (form.currentState!.validate()) {
                      Navigator.pop(context, true);
                    }
                  },
                  child: const Text('Save outcome'),
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
    );
    if (submitted != true || !mounted) return;
    try {
      await ref
          .read(serviceProvider)
          .dio
          .post(
            '/sales-management/sales/${task['sale_id']}/calls',
            data: {
              'stage': task['stage'],
              'outcome': outcome,
              'remark': remark.trim(),
            },
          );
      await load();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Outcome saved')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not save outcome. Try again.')),
        );
      }
    }
  }

  Future<void> deferTele(Json task) async {
    final reason = TextEditingController();
    final form = GlobalKey<FormState>();
    final proceed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
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
                  const Text(
                    'Postpone tele-verification',
                    style: RelayTypography.section,
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: reason,
                    decoration: const InputDecoration(
                      labelText: 'Technical reason',
                    ),
                    minLines: 2,
                    maxLines: 3,
                    maxLength: 300,
                    validator: (value) => (value ?? '').trim().length < 5
                        ? 'Enter a technical reason'
                        : null,
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: () {
                      if (form.currentState!.validate()) {
                        Navigator.pop(context, true);
                      }
                    },
                    child: const Text('Postpone to next day'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    final text = reason.text.trim();
    reason.dispose();
    if (proceed != true || !mounted) return;
    try {
      await ref
          .read(serviceProvider)
          .dio
          .post(
            '/sales-management/sales/${task['sale_id']}/calls/defer-tele',
            data: {'reason': text},
          );
      await load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(friendlyError(e))));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!canVisitMobilePage('/call-work', ref.watch(serviceProvider).user)) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Call work queue'),
          actions: [
            IconButton(
              onPressed: () => ref.read(serviceProvider).logout(),
              tooltip: 'Sign out',
              icon: const Icon(Icons.logout),
            ),
          ],
        ),
        body: const Center(
          child: Text('Calling access is not available for your role'),
        ),
      );
    }
    ref.listen<String?>(
      serviceProvider.select((service) => service.branchId),
      (_, _) => load(),
    );
    final textScale = MediaQuery.textScalerOf(context).scale(14) / 14;
    final compact = MediaQuery.sizeOf(context).width < 360 || textScale > 1.2;
    final visible = tasks
        .where(
          (task) =>
              filter == 'All' ||
              (filter == 'Ready' &&
                  ['PENDING', 'FAILED'].contains(task['status'])) ||
              (filter == 'Waiting' && task['status'] == 'BLOCKED') ||
              (filter == 'Done' &&
                  [
                    'COMPLETED',
                    'SKIPPED',
                    'CANCELLED',
                  ].contains(task['status'])),
        )
        .toList();
    if (widget.selectedId != null) {
      final selected = visible.indexWhere(
        (task) => task['id'] == widget.selectedId,
      );
      if (selected > 0) visible.insert(0, visible.removeAt(selected));
    }
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: textScale > 1.2 ? 52 * textScale : 64,
        title: const Text('Call work queue'),
        actions: [
          const NotificationBell(),
          if (compact)
            PopupMenuButton<String>(
              tooltip: 'Call actions',
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
              tooltip: 'Refresh',
              icon: const Icon(Icons.refresh),
            ),
            IconButton(
              onPressed: () => ref.read(serviceProvider).logout(),
              tooltip: 'Sign out',
              icon: const Icon(Icons.logout),
            ),
          ],
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error.isNotEmpty
          ? Center(
              child: TextButton(onPressed: load, child: Text(error)),
            )
          : RefreshIndicator(
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.all(15),
                children: [
                  const BranchFilter(),
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(18),
                      gradient: const LinearGradient(
                        colors: [Color(0xFF7033BC), Color(0xFFAE2874)],
                      ),
                    ),
                    child: LayoutBuilder(
                      builder: (context, constraints) {
                        final heading = Text(
                          'Ready to contact',
                          style: RelayTypography.bodyStrong.copyWith(
                            color: Colors.white,
                          ),
                        );
                        final count = Text(
                          '${summary['actionable'] ?? 0}',
                          style: RelayTypography.numeric.copyWith(
                            color: Colors.white,
                            fontSize: 27,
                            fontWeight: FontWeight.w700,
                          ),
                        );
                        if (constraints.maxWidth < 280 || textScale > 1.2) {
                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              heading,
                              const SizedBox(height: 8),
                              count,
                            ],
                          );
                        }
                        return Row(
                          children: [
                            Expanded(child: heading),
                            const SizedBox(width: 16),
                            count,
                          ],
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: ['Ready', 'Waiting', 'Done', 'All']
                        .map(
                          (value) => ChoiceChip(
                            label: Text(value, style: RelayTypography.label),
                            selected: filter == value,
                            onSelected: (_) => setState(() => filter = value),
                          ),
                        )
                        .toList(),
                  ),
                  const SizedBox(height: 12),
                  if (visible.isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(24),
                      child: Center(
                        child: Text(
                          'No calls in this view',
                          style: RelayTypography.body,
                        ),
                      ),
                    ),
                  ...visible.map(
                    (task) => Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${task['customer_name']}',
                              style: RelayTypography.bodyStrong,
                            ),
                            const SizedBox(height: 8),
                            Text(
                              task['stage'] == 'TELE_VERIFICATION'
                                  ? 'Tele-verification'
                                  : 'Welcome call',
                              style: RelayTypography.body,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '${task['plan_name']} · ${task['request_id']}',
                              style: RelayTypography.caption,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '${task['branch']} · ${task['agent']}',
                              style: RelayTypography.caption,
                            ),
                            const SizedBox(height: 8),
                            SelectableText(
                              'Phone: ${task['msisdn'] ?? task['alternate_number'] ?? 'Not recorded'}',
                              style: RelayTypography.bodyStrong,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'Last outcome: ${task['last_outcome'] ?? 'Not started'}',
                              style: RelayTypography.caption,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'Due ${task['due_date'] ?? 'Not recorded'}${task['overdue'] == true ? ' · Overdue' : ''}${task['deferred'] == true ? ' · Postponed' : ''}',
                              style: RelayTypography.caption.copyWith(
                                color: task['overdue'] == true
                                    ? const Color(0xffb42b46)
                                    : const Color(0xff596675),
                              ),
                            ),
                            if ((task['sequence_warning'] ?? '')
                                .toString()
                                .isNotEmpty)
                              Text(
                                '${task['sequence_warning']}',
                                style: RelayTypography.caption,
                              ),
                            const SizedBox(height: 12),
                            Wrap(
                              alignment: WrapAlignment.spaceBetween,
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                Chip(
                                  label: Text(
                                    '${task['status']}'.toLowerCase(),
                                    style: RelayTypography.label,
                                  ),
                                ),
                                if (canRecordCall(
                                  task,
                                  ref.watch(serviceProvider).user,
                                ))
                                  FilledButton.tonalIcon(
                                    style: FilledButton.styleFrom(
                                      minimumSize: const Size(0, 48),
                                    ),
                                    onPressed: () => record(task),
                                    icon: const Icon(Icons.call, size: 17),
                                    label: const Text('Record call'),
                                  ),
                                if (task['stage'] == 'TELE_VERIFICATION' &&
                                    task['deferred'] != true &&
                                    canRecordCall(
                                      task,
                                      ref.watch(serviceProvider).user,
                                    ))
                                  TextButton(
                                    onPressed: () => deferTele(task),
                                    child: const Text('Postpone to next day'),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}
