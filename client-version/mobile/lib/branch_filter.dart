import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'services.dart';

final authorizedBranchesProvider = FutureProvider<List<Json>>((ref) async {
  ref.watch(
    serviceProvider.select(
      (service) => '${service.user?['id']}:${service.syncRevision}',
    ),
  );
  final result = await ref
      .read(serviceProvider)
      .dio
      .get(
        '/resources/branches',
        options: Options(extra: {'allAuthorizedBranches': true}),
      );
  return (result.data as List).map((row) => Json.from(row)).toList();
});

/// The selected branch is shared by every page in the signed-in workspace.
class BranchFilter extends ConsumerWidget {
  const BranchFilter({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final service = ref.watch(serviceProvider);
    return ref
        .watch(authorizedBranchesProvider)
        .when(
          loading: () =>
              const SizedBox(height: 4, child: LinearProgressIndicator()),
          error: (_, _) => TextButton.icon(
            onPressed: () => ref.invalidate(authorizedBranchesProvider),
            icon: const Icon(Icons.refresh),
            label: const Text('Reload branches'),
          ),
          data: (branches) {
            final selected =
                branches.any((row) => row['id'] == service.branchId)
                ? service.branchId
                : null;
            if (service.branchId != null && selected == null) {
              final expectedBranch = service.branchId;
              final expectedAccount = service.user?['id'];
              // Clear only the obsolete selection from this account. Defer the
              // notification until after build, and preserve any newer choice.
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (context.mounted &&
                    service.user?['id'] == expectedAccount &&
                    service.branchId == expectedBranch) {
                  service.selectBranch(null);
                }
              });
            }
            if (branches.isEmpty) return const SizedBox.shrink();
            return DropdownButtonFormField<String>(
              key: ValueKey('${service.user?['id']}:$selected'),
              initialValue: selected ?? '',
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Branch',
                prefixIcon: Icon(Icons.store_outlined),
              ),
              items: [
                const DropdownMenuItem(
                  value: '',
                  child: Text('All authorized branches'),
                ),
                for (final row in branches)
                  DropdownMenuItem(
                    value: '${row['id']}',
                    child: Text(
                      '${row['name']}',
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: service.selectBranch,
            );
          },
        );
  }
}
