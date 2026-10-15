import 'package:dio/dio.dart';
import 'package:uuid/uuid.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'services.dart';
import 'experience.dart';

String savedDraftsKey(RelayService service) =>
    'saved-capture-drafts-${service.user?['id']}';

/// Called only after the server has recorded an outcome for this transaction.
/// A different active draft must survive a delayed response or an idempotent retry.
Future<void> removeClosedCaptureDrafts(
  RelayService service,
  Json intake,
) async {
  final transaction = intake['transaction_id'];
  if (transaction == null || transaction.toString().isEmpty) return;
  final account = service.user?['id'];
  for (final key in ['intake-$account', 'kyc-draft-$account']) {
    final cached = await service.store.get(key);
    final cachedIntake = cached?['data'] ?? cached?['intake'];
    if (cachedIntake is Map && cachedIntake['transaction_id'] == transaction) {
      await service.store.remove(key);
    }
  }
  final key = 'saved-capture-drafts-$account';
  final saved = await service.store.get(key);
  if (saved == null) return;
  final rows = List<dynamic>.from(saved['rows'] ?? []);
  rows.removeWhere((row) {
    if (row is! Map || row['data'] is! Map) return false;
    final details = row['data'] as Map;
    return details['transaction_id'] == transaction ||
        ((details['transaction_id'] ?? '').toString().isEmpty &&
            (intake['saved_draft_id'] ?? '').toString().isNotEmpty &&
            row['id'] == intake['saved_draft_id']);
  });
  await service.store.put(key, {'rows': rows});
}

Future<Json> saveSavedDraft(RelayService service, Json data) async {
  final local =
      await service.store.get(savedDraftsKey(service)) ?? {'rows': <dynamic>[]};
  Json row;
  try {
    final result = await service.dio.post(
      '/kyc-captures/saved-drafts',
      data: {'data': data},
    );
    row = Map<String, dynamic>.from(result.data);
  } on DioException catch (e) {
    if (e.response != null) rethrow;
    final id = data['saved_draft_id'] ?? const Uuid().v4();
    row = {
      'id': id,
      'data': {...data, 'saved_draft_id': id},
      'pending': true,
    };
  }
  final rows = List<dynamic>.from(local['rows'] ?? []);
  rows.removeWhere(
    (r) =>
        r['id'] == row['id'] ||
        r['data']?['transaction_id'] == data['transaction_id'],
  );
  rows.insert(0, row);
  await service.store.put(savedDraftsKey(service), {'rows': rows});
  return row;
}

Future<void> discardSavedDraft(RelayService service, Json row) async {
  if (row['pending'] != true) {
    await service.dio.delete('/kyc-captures/saved-drafts/${row['id']}');
  }
  final local =
      await service.store.get(savedDraftsKey(service)) ?? {'rows': <dynamic>[]};
  final rows = List<dynamic>.from(local['rows']);
  rows.removeWhere((r) => r['id'] == row['id']);
  await service.store.put(savedDraftsKey(service), {'rows': rows});
}

Future<List<Json>> loadSavedDrafts(RelayService service) async {
  final local =
      await service.store.get(savedDraftsKey(service)) ?? {'rows': <dynamic>[]};
  final pending = (local['rows'] as List)
      .where((r) => r['pending'] == true)
      .toList();
  try {
    for (final row in pending) {
      await saveSavedDraft(service, Map<String, dynamic>.from(row['data']));
    }
    final result = await service.dio.get('/kyc-captures/saved-drafts');
    final rows = (result.data as List)
        .map((r) => Map<String, dynamic>.from(r))
        .toList();
    await service.store.put(savedDraftsKey(service), {'rows': rows});
    return rows;
  } on DioException catch (e) {
    if (e.response != null) rethrow;
    return (local['rows'] as List)
        .map((r) => Map<String, dynamic>.from(r))
        .toList();
  }
}

class SavedDraftsScreen extends ConsumerStatefulWidget {
  const SavedDraftsScreen({super.key});
  @override
  ConsumerState<SavedDraftsScreen> createState() => _SavedDraftsState();
}

class _SavedDraftsState extends ConsumerState<SavedDraftsScreen> {
  List<Json>? drafts;
  String? error;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final result = await loadSavedDrafts(ref.read(serviceProvider));
      if (mounted) {
        setState(() {
          drafts = result;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = friendlyError(e));
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: context.canPop(),
    onPopInvokedWithResult: (didPop, result) {
      if (!didPop) context.go('/');
    },
    child: Scaffold(
      appBar: AppBar(
        title: const Text('Drafts'),
        leading: const WorkspaceBackButton(),
        actions: [
          IconButton(
            tooltip: 'New transaction',
            icon: const Icon(Icons.add),
            onPressed: () => context.push('/screenshot-capture'),
          ),
        ],
      ),
      body: error != null
          ? Center(
              child: TextButton(onPressed: load, child: Text(error!)),
            )
          : drafts == null
          ? const Center(child: CircularProgressIndicator())
          : drafts!.isEmpty
          ? const Center(child: Text('No saved drafts'))
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: drafts!.length,
              itemBuilder: (context, i) {
                final row = drafts![i],
                    data = Map<String, dynamic>.from(row['data']);
                return Card(
                  child: ListTile(
                    leading: const Icon(
                      Icons.edit_document,
                      color: Color(0xff8036c2),
                    ),
                    title: Text(
                      (data['name'] ?? '').toString().isEmpty
                          ? 'New customer'
                          : data['name'],
                    ),
                    subtitle: Text('Step ${(data['step'] ?? 0) + 1} of 3'),
                    onTap: () =>
                        context.push('/screenshot-capture', extra: data),
                    trailing: IconButton(
                      tooltip: 'Discard draft',
                      icon: const Icon(Icons.delete_outline),
                      onPressed: () async {
                        final confirmed = await showDialog<bool>(
                          context: context,
                          builder: (c) => AlertDialog(
                            title: const Text('Discard draft?'),
                            actions: [
                              TextButton(
                                onPressed: () => Navigator.pop(c, false),
                                child: const Text('Keep'),
                              ),
                              FilledButton(
                                onPressed: () => Navigator.pop(c, true),
                                child: const Text('Discard'),
                              ),
                            ],
                          ),
                        );
                        if (confirmed != true) return;
                        try {
                          await discardSavedDraft(
                            ref.read(serviceProvider),
                            row,
                          );
                          await load();
                        } catch (e) {
                          if (mounted) setState(() => error = friendlyError(e));
                        }
                      },
                    ),
                  ),
                );
              },
            ),
    ),
  );
}
