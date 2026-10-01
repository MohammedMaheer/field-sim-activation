import 'role_access.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'services.dart';

final notificationsProvider = FutureProvider.autoDispose<Json>((ref) async {
  final userId = ref.watch(serviceProvider.select((s) => s.user?['id']));
  final service = ref.read(serviceProvider);
  final timer = Timer(const Duration(seconds: 20), ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  if (userId == null) return {'items': [], 'unread': 0};
  return Map<String, dynamic>.from((await service.dio.get('/notifications')).data);
});

class NotificationBell extends ConsumerWidget {
  const NotificationBell({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(notificationsProvider).valueOrNull?['unread'] as int? ?? 0;
    return IconButton(tooltip: 'Notifications', onPressed: () => context.push('/notifications'),
      icon: Badge(isLabelVisible: count > 0, label: Text(count > 99 ? '99+' : '$count'), child: const Icon(Icons.notifications_outlined)));
  }
}

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});
  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsState();
}

class _NotificationsState extends ConsumerState<NotificationsScreen> {
  String category = 'All', search = '', error = '';
  bool unread = false, busy = false;
  static const icons = {'Transactions': Icons.receipt_long, 'Calls': Icons.call_outlined, 'Stock': Icons.inventory_2_outlined, 'Support': Icons.support_agent, 'Workspace': Icons.notifications_outlined};
  static const tones = {'Transactions': Color(0xFF7739AC), 'Calls': Color(0xFF176CAC), 'Stock': Color(0xFF08765F), 'Support': Color(0xFFA94C0C), 'Workspace': Color(0xFF7739AC)};
  Future<void> mark(List<Json> rows, bool read, [String? path]) async {
    if (path != null && (!path.startsWith('/') || path.startsWith('//') || !canVisitMobilePage(Uri.parse(path).path, ref.read(serviceProvider).user))) {
      setState(() => error = 'This page is not available for your role');
      return;
    }
    setState(() {busy = true; error = '';});
    try {
      await ref.read(serviceProvider).dio.post('/notifications/read', data: {'ids': rows.map((r) => r['id']).toList(), 'read': read});
      ref.invalidate(notificationsProvider);
      if (mounted && path != null) await context.push(path);
    } catch (_) {
      if (mounted) setState(() => error = 'Could not update notifications. Please retry.');
    } finally {if (mounted) setState(() => busy = false);}
  }
  @override
  Widget build(BuildContext context) {
    final data = ref.watch(notificationsProvider);
    return Scaffold(appBar: AppBar(title: const Text('Notifications')), body: data.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, st) => Center(child: TextButton(onPressed: () => ref.invalidate(notificationsProvider), child: const Text('Could not load notifications. Retry'))),
      data: (value) {
        final categories = (value['categories'] as List? ?? []).cast<String>();
        final rows = (value['items'] as List).map((r) => Map<String, dynamic>.from(r)).where((r) => categories.contains(r['category']) && r['mobile_path'] is String && (r['mobile_path'] as String).startsWith('/') && !(r['mobile_path'] as String).startsWith('//') && canVisitMobilePage(Uri.parse(r['mobile_path']).path, ref.read(serviceProvider).user)).toList();
        final visible = rows.where((r) => (category == 'All' || category == r['category']) && (!unread || r['read'] != true) && '${r['title']} ${r['message']}'.toLowerCase().contains(search.toLowerCase())).toList();
        return RefreshIndicator(onRefresh: () async {ref.invalidate(notificationsProvider); await ref.read(notificationsProvider.future);}, child: ListView(padding: const EdgeInsets.all(16), children: [
          Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), gradient: const LinearGradient(colors: [Color(0xFFF3D9F1), Color(0xFFDAF6EF)])), child: Row(children: [Expanded(child: Text('${value['unread']} unread', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800))), TextButton(onPressed: busy || !visible.any((r) => r['read'] != true) ? null : () => mark(visible.where((r) => r['read'] != true).toList(), true), child: const Text('Read shown'))])),
          const SizedBox(height: 12),
          SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: ['All', ...categories].map((c) => Padding(padding: const EdgeInsets.only(right: 6), child: ChoiceChip(label: Text(c), selected: category == c, onSelected: (_) => setState(() => category = c)))).toList())),
          const SizedBox(height: 10),
          TextField(decoration: const InputDecoration(hintText: 'Search notifications', prefixIcon: Icon(Icons.search)), onChanged: (s) => setState(() => search = s)),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Unread only'), value: unread, onChanged: (v) => setState(() => unread = v)),
          if (error.isNotEmpty) Text(error, style: const TextStyle(color: Colors.red)),
          if (visible.isEmpty) const Padding(padding: EdgeInsets.all(32), child: Column(children: [Icon(Icons.notifications_none, size: 40), SizedBox(height: 12), Text('You’re all caught up')])),
          for (final row in visible) Card(color: row['read'] == true ? Colors.white : const Color(0xFFF7EEFF), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            ListTile(contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6), leading: CircleAvatar(backgroundColor: (tones[row['category']] ?? Colors.purple).withValues(alpha: .12), child: Icon(icons[row['category']] ?? Icons.notifications, color: tones[row['category']])), title: Text('${row['title']}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)), subtitle: Text('${row['category']}${row['attention'] == true ? ' · Needs attention' : ''}\n${row['message']}\n${DateTime.tryParse('${row['created_at']}Z')?.toLocal().toString().substring(0,16) ?? ''}', style: const TextStyle(fontSize: 12)), trailing: const Icon(Icons.chevron_right), onTap: busy ? null : () => mark([row], true, row['mobile_path'] as String)),
            Align(alignment: Alignment.centerRight, child: TextButton(onPressed: busy ? null : () => mark([row], row['read'] != true), child: Text(row['read'] == true ? 'Mark unread' : 'Mark read'))),
          ])),
        ]));
      },
    ));
  }
}
