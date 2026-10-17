import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'role_access.dart';
import 'services.dart';

class WorkspaceMenu extends ConsumerWidget {
  const WorkspaceMenu({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return IconButton(
      tooltip: 'Workspace pages',
      icon: const Icon(Icons.apps_outlined),
      onPressed: () async {
        final selected = await showModalBottomSheet<String>(
          context: context,
          isScrollControlled: true,
          useSafeArea: true,
          showDragHandle: true,
          builder: (sheetContext) => Consumer(
            builder: (context, ref, _) {
              final user = ref.watch(serviceProvider).user;
              return SafeArea(
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.sizeOf(context).height * .82,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 0, 8, 8),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                'Workspace',
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                            ),
                            IconButton(
                              tooltip: 'Close workspace pages',
                              onPressed: () => Navigator.pop(sheetContext),
                              icon: const Icon(Icons.close),
                            ),
                          ],
                        ),
                      ),
                      Flexible(
                        child: ListView(
                          shrinkWrap: true,
                          padding: const EdgeInsets.only(bottom: 12),
                          children: [
                            for (final group in [
                              'Sales & customers',
                              'Work & stock',
                              'Reports & help',
                            ])
                              if (workspacePages.any(
                                (page) =>
                                    page.group == group &&
                                    canVisitMobilePage(page.path, user),
                              )) ...[
                                Padding(
                                  padding: const EdgeInsets.fromLTRB(
                                    20,
                                    12,
                                    20,
                                    4,
                                  ),
                                  child: Semantics(
                                    header: true,
                                    child: Text(
                                      group,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                        fontSize: 14,
                                        color: Color(0xFF713259),
                                      ),
                                    ),
                                  ),
                                ),
                                for (final page in workspacePages.where(
                                  (page) =>
                                      page.group == group &&
                                      canVisitMobilePage(page.path, user),
                                ))
                                  Tooltip(
                                    message: page.description,
                                    child: ListTile(
                                      leading: Icon(
                                        page.icon,
                                        color: const Color(0xFF713259),
                                      ),
                                      title: Text(
                                        page.title,
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                      trailing: const Icon(Icons.chevron_right),
                                      onTap: () => Navigator.pop(
                                        sheetContext,
                                        page.path,
                                      ),
                                    ),
                                  ),
                              ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        );
        if (context.mounted &&
            selected != null &&
            canVisitMobilePage(selected, ref.read(serviceProvider).user)) {
          context.push(selected);
        }
      },
    );
  }
}

class WorkspaceDestination {
  final String group, path, title, description;
  final IconData icon;
  const WorkspaceDestination(
    this.group,
    this.path,
    this.title,
    this.description,
    this.icon,
  );
}

const workspacePages = [
  WorkspaceDestination(
    'Sales & customers',
    '/sales-management',
    'Sales management',
    'Sales, targets and follow-ups',
    Icons.point_of_sale_outlined,
  ),
  WorkspaceDestination(
    'Sales & customers',
    '/transactions',
    'Submitted transactions',
    'Capture history and backend updates',
    Icons.receipt_long_outlined,
  ),
  WorkspaceDestination(
    'Sales & customers',
    '/records',
    'Past activations',
    'Earlier activation records',
    Icons.history_outlined,
  ),
  WorkspaceDestination(
    'Sales & customers',
    '/customers',
    'Customers',
    'Customer and order details',
    Icons.people_outline,
  ),
  WorkspaceDestination(
    'Sales & customers',
    '/drafts',
    'Saved drafts',
    'Continue an unfinished capture',
    Icons.drafts_outlined,
  ),
  WorkspaceDestination(
    'Sales & customers',
    '/call-work',
    'Call work queue',
    'Tele-verification and welcome calls',
    Icons.phone_outlined,
  ),
  WorkspaceDestination(
    'Work & stock',
    '/work-location',
    'Work location',
    'Start or end work tracking',
    Icons.location_on_outlined,
  ),
  WorkspaceDestination(
    'Work & stock',
    '/stock',
    'Branch SIM inventory',
    'SIM stock and activation progress',
    Icons.sim_card_outlined,
  ),
  WorkspaceDestination(
    'Work & stock',
    '/assets',
    'Assets & supplies',
    'Assigned items and stock requests',
    Icons.inventory_2_outlined,
  ),
  WorkspaceDestination(
    'Reports & help',
    '/reports',
    'Reports',
    'Choose dates and download reports',
    Icons.bar_chart_outlined,
  ),
  WorkspaceDestination(
    'Reports & help',
    '/incentives',
    'Incentives',
    'Approved amounts and estimates',
    Icons.payments_outlined,
  ),
  WorkspaceDestination(
    'Reports & help',
    '/support',
    'Support',
    'Send a request and see replies',
    Icons.help_outline,
  ),
];
