import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'role_access.dart';
import 'services.dart';

class WorkspaceMenu extends ConsumerWidget {
  const WorkspaceMenu({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(serviceProvider).user;
    final pages = <String, String>{
      '/sales-management': 'Sales records & targets',
      '/records': 'Historical activations',
      '/transactions': 'Backend transaction history',
      '/call-work': 'Calling queues',
      '/stock': 'Branch SIM inventory',
      '/customers': 'Customers',
      '/reports': 'Reports',
      '/incentives': 'Incentives',
      '/assets': 'Assets & supplies',
      '/support': 'Support',
      '/drafts': 'Saved drafts',
    };
    return PopupMenuButton<String>(
      tooltip: 'Workspace pages',
      icon: const Icon(Icons.apps_outlined),
      onSelected: (path) => context.push(path),
      itemBuilder: (_) => [
        for (final entry in pages.entries)
          if (canVisitMobilePage(entry.key, user))
            PopupMenuItem(value: entry.key, child: Text(entry.value)),
      ],
    );
  }
}
