import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'services.dart';
import 'branch_filter.dart';
import 'exports.dart';

const assetCategories = {
  'GRABBA_DEVICE': 'Grabba device',
  'ROUTER': 'Router',
  'STAMP': 'Stamp',
  'ID_CARD': 'Staff ID card',
  'UNIFORM': 'Uniform',
  'OTHER': 'Other',
};
String assetLabel(Object? value) {
  final code = value?.toString() ?? '';
  if (code.isEmpty) return 'Not recorded';
  return assetCategories[code] ??
      code
          .toLowerCase()
          .split('_')
          .map(
            (word) => word.isEmpty
                ? ''
                : '${word[0].toUpperCase()}${word.substring(1)}',
          )
          .join(' ');
}

class FieldAssetsScreen extends ConsumerStatefulWidget {
  const FieldAssetsScreen({super.key});
  @override
  ConsumerState<FieldAssetsScreen> createState() => _FieldAssetsScreenState();
}

class _FieldAssetsScreenState extends ConsumerState<FieldAssetsScreen> {
  List<Json> stock = [];
  List<Json> requests = [];
  List<Json> lowStock = [];
  bool loading = true;
  String error = '';
  Timer? poll;
  bool fetching = false;
  bool reloadPending = false;
  String section = 'stock';
  bool requestOpen = false;
  @override
  void initState() {
    super.initState();
    load();
    poll = Timer.periodic(
      const Duration(seconds: 20),
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
    if (fetching) {
      if (!silent) {
        reloadPending = true;
        setState(() {
          loading = true;
          error = '';
        });
      }
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
      final s = ref.read(serviceProvider);
      final requestedBranch = s.branchId;
      final results = await Future.wait([
        s.dio.get('/field-assets'),
        s.dio.get('/field-assets/requests/list'),
        s.dio.get('/field-assets/report/summary'),
      ]);
      if (mounted && s.branchId == requestedBranch) {
        setState(() {
          error = '';
          stock = (results[0].data as List)
              .map((v) => Map<String, dynamic>.from(v))
              .toList();
          requests = (results[1].data as List)
              .map((v) => Map<String, dynamic>.from(v))
              .toList();
          lowStock = (results[2].data as List)
              .map((v) => Map<String, dynamic>.from(v))
              .where((row) => row['low_stock'] == true)
              .toList();
        });
      }
    } catch (_) {
      if (mounted && !silent) {
        setState(() => error = 'Could not load assets. Try again.');
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

  Future<void> requestAsset() async {
    final service = ref.read(serviceProvider);
    final agentId = service.user?['agent_id'];
    if (agentId == null || requestOpen) return;
    setState(() => requestOpen = true);
    String category = 'GRABBA_DEVICE',
        urgency = 'NORMAL',
        quantity = '1',
        reason = '';
    bool sending = false;
    String? submitError;
    final form = GlobalKey<FormState>();
    try {
      final created = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        isDismissible: false,
        enableDrag: false,
        builder: (sheetContext) => StatefulBuilder(
          builder: (sheetContext, update) => PopScope(
            canPop: !sending,
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                20,
                12,
                20,
                MediaQuery.viewInsetsOf(sheetContext).bottom + 20,
              ),
              child: SingleChildScrollView(
                child: Form(
                  key: form,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Request stock',
                              style: Theme.of(
                                sheetContext,
                              ).textTheme.titleLarge,
                            ),
                          ),
                          IconButton(
                            tooltip: 'Close request',
                            onPressed: sending
                                ? null
                                : () => Navigator.pop(sheetContext, false),
                            icon: const Icon(Icons.close),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: category,
                        decoration: const InputDecoration(
                          labelText: 'Asset type',
                        ),
                        items: assetCategories.entries
                            .map(
                              (entry) => DropdownMenuItem(
                                value: entry.key,
                                child: Text(entry.value),
                              ),
                            )
                            .toList(),
                        onChanged: sending
                            ? null
                            : (value) => category = value ?? category,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        initialValue: quantity,
                        enabled: !sending,
                        onChanged: (value) => quantity = value,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: 'Quantity',
                        ),
                        validator: (v) {
                          final number = int.tryParse(v ?? '');
                          return number == null || number < 1 || number > 10000
                              ? 'Enter a whole number from 1 to 10,000'
                              : null;
                        },
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: urgency,
                        decoration: const InputDecoration(labelText: 'Urgency'),
                        items: const [
                          DropdownMenuItem(
                            value: 'NORMAL',
                            child: Text('Normal'),
                          ),
                          DropdownMenuItem(
                            value: 'URGENT',
                            child: Text('Urgent'),
                          ),
                        ],
                        onChanged: sending
                            ? null
                            : (value) => urgency = value ?? 'NORMAL',
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        initialValue: reason,
                        enabled: !sending,
                        maxLength: 300,
                        minLines: 1,
                        maxLines: 3,
                        onChanged: (value) => reason = value,
                        decoration: const InputDecoration(labelText: 'Reason'),
                        validator: (v) => (v ?? '').trim().length < 5
                            ? 'Add a reason of at least 5 characters'
                            : null,
                      ),
                      if (submitError != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Semantics(
                            liveRegion: true,
                            child: Text(
                              submitError!,
                              style: TextStyle(
                                color: Theme.of(sheetContext).colorScheme.error,
                              ),
                            ),
                          ),
                        ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          TextButton(
                            onPressed: sending
                                ? null
                                : () => Navigator.pop(sheetContext, false),
                            child: const Text('Cancel'),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: FilledButton(
                              onPressed: sending
                                  ? null
                                  : () async {
                                      if (sending ||
                                          !form.currentState!.validate()) {
                                        return;
                                      }
                                      update(() {
                                        sending = true;
                                        submitError = null;
                                      });
                                      try {
                                        await service.dio.post(
                                          '/field-assets/requests',
                                          data: {
                                            'agent_id': agentId,
                                            'category': category,
                                            'quantity': int.parse(quantity),
                                            'urgency': urgency,
                                            'reason': reason.trim(),
                                          },
                                        );
                                        if (sheetContext.mounted) {
                                          Navigator.pop(sheetContext, true);
                                        }
                                      } catch (failure) {
                                        if (sheetContext.mounted) {
                                          update(() {
                                            sending = false;
                                            submitError =
                                                failure is DioException &&
                                                    failure.response == null
                                                ? 'Could not confirm the request. Your entries are kept here. Check your connection before trying again.'
                                                : friendlyError(failure);
                                          });
                                        }
                                      }
                                    },
                              child: Text(
                                sending ? 'Sending…' : 'Submit request',
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      if (created != true || !mounted) return;
      await load();
      if (mounted) {
        setState(() => section = 'requests');
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Stock request sent')));
      }
    } finally {
      if (mounted) setState(() => requestOpen = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<String?>(
      serviceProvider.select((service) => service.branchId),
      (_, _) => load(),
    );
    final currentUser = ref.watch(serviceProvider).user;
    final grants = (currentUser?['permissions'] as List? ?? []).cast<String>();
    final canRequest =
        currentUser?['agent_id'] != null &&
        currentUser?['role'] == 'Field Agent' &&
        grants.contains('read') &&
        grants.contains('inventory.self');
    return Scaffold(
      appBar: AppBar(
        title: const Text('Assets & supplies'),
        actions: [IconButton(onPressed: load, icon: const Icon(Icons.refresh))],
      ),
      floatingActionButton: canRequest
          ? FloatingActionButton.extended(
              onPressed: requestOpen ? null : requestAsset,
              icon: const Icon(Icons.add),
              label: const Text('Request stock'),
            )
          : null,
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error.isNotEmpty
          ? Center(
              child: TextButton(onPressed: load, child: Text(error)),
            )
          : RefreshIndicator(
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  const BranchFilter(),
                  const SizedBox(height: 16),
                  SegmentedButton<String>(
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(
                        value: 'stock',
                        label: Text('Assets'),
                        icon: Icon(Icons.inventory_2_outlined),
                      ),
                      ButtonSegment(
                        value: 'requests',
                        label: Text('Requests'),
                        icon: Icon(Icons.assignment_outlined),
                      ),
                    ],
                    selected: {section},
                    onSelectionChanged: (value) =>
                        setState(() => section = value.first),
                  ),
                  const SizedBox(height: 16),
                  if (lowStock.isNotEmpty)
                    Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      color: const Color(0xFFFFEBE9),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(
                          '${lowStock.length} stock level${lowStock.length == 1 ? ' is' : 's are'} below minimum',
                          style: const TextStyle(
                            color: Color(0xFF9A2D4A),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                  if (section == 'stock') ...[
                    Text(
                      'Branch assets',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 8),
                    const ExportActions(
                      endpoint: '/field-assets/report/export',
                      filenameStem: 'qanawat-branch-assets',
                      label: 'Export branch assets',
                      query: {'kind': 'stock'},
                    ),
                    const SizedBox(height: 8),
                    if (stock.isEmpty)
                      const Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('No assets recorded for this branch.'),
                      ),
                    ...stock.map(
                      (a) => Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          leading: const Icon(
                            Icons.inventory_2_outlined,
                            color: Color(0xFF8136B3),
                          ),
                          title: Text(
                            '${a['label']}',
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          subtitle: Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${a['branch'] ?? 'Not recorded'} · ${a['serial'] ?? 'Not recorded'}',
                                ),
                                Text(
                                  'Quantity: ${a['quantity'] ?? 'Not recorded'} · ${assetLabel(a['status'])}',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                Text(
                                  a['agent'] == null ||
                                          a['agent'] == 'Unassigned'
                                      ? 'Branch stock'
                                      : 'Assigned to ${a['agent']}',
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                  if (section == 'requests') ...[
                    Text(
                      'Requests',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 8),
                    const ExportActions(
                      endpoint: '/field-assets/report/export',
                      filenameStem: 'qanawat-stock-requests',
                      label: 'Export stock requests',
                      query: {'kind': 'requests'},
                    ),
                    const SizedBox(height: 8),
                    if (requests.isEmpty)
                      const Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('No requests yet'),
                      ),
                    ...requests.map(
                      (r) => Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          title: Text(
                            '${assetLabel(r['category'])} · ${r['quantity']} ${r['quantity'] == 1 ? 'item' : 'items'}',
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          subtitle: Text(
                            '${r['reason']}\n${assetLabel(r['urgency'])} · ${assetLabel(r['status'])}${r['response'] == null ? '' : '\n${r['response']} · ${r['responded_by']}'}',
                          ),
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 60),
                ],
              ),
            ),
    );
  }
}
