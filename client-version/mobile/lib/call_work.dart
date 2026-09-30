import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'services.dart';

class CallWorkScreen extends ConsumerStatefulWidget {
  const CallWorkScreen({super.key});
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
  @override
  void initState() { super.initState(); load(); poll = Timer.periodic(const Duration(seconds: 15), (_) => load(silent: true)); }

  @override
  void dispose() { poll?.cancel(); super.dispose(); }

  Future<void> load({bool silent = false}) async {
    if (fetching || !mounted) return;
    fetching = true;
    if (!silent) setState(() { loading = true; error = ''; });
    try {
      final service = ref.read(serviceProvider);
      final results = await Future.wait([
        service.dio.get('/sales-management/call-tasks'),
        service.dio.get('/sales-management/call-tasks/summary'),
      ]);
      if (mounted) {
        setState(() {
          error = '';
          tasks = (results[0].data as List).map((value) => Map<String, dynamic>.from(value)).toList();
          summary = Map<String, dynamic>.from(results[1].data);
        });
      }
    } catch (_) { if (mounted && !silent) setState(() => error = 'Could not load calls. Try again.'); }
    finally { fetching = false; if (mounted) setState(() => loading = false); }
  }

  Future<void> record(Json task) async {
    String outcome = '';
    final remark = TextEditingController();
    final form = GlobalKey<FormState>();
    final submitted = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, showDragHandle: true,
      builder: (context) => Padding(
        padding: EdgeInsets.fromLTRB(20, 8, 20, MediaQuery.viewInsetsOf(context).bottom + 20),
        child: SingleChildScrollView(child: Form(key: form, child: Column(
          mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('${task['customer_name']}', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 6),
            Text(task['stage'] == 'TELE_VERIFICATION' ? 'Tele-verification' : 'Welcome call'),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(decoration: const InputDecoration(labelText: 'Outcome'),
              items: const ['PASSED', 'REACHED', 'NO_ANSWER', 'RETRY', 'FAILED'].map((value) => DropdownMenuItem(value: value, child: Text(value.replaceAll('_', ' ')))).toList(),
              onChanged: (value) => outcome = value ?? '', validator: (value) => value == null ? 'Choose an outcome' : null),
            TextFormField(controller: remark, decoration: const InputDecoration(labelText: 'Call remark'),
              maxLines: 3, validator: (value) => (value ?? '').trim().length < 3 ? 'Enter a remark' : null),
            const SizedBox(height: 18),
            FilledButton(onPressed: () { if (form.currentState!.validate()) Navigator.pop(context, true); }, child: const Text('Save outcome')),
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          ],
        ))),
      ),
    );
    if (submitted != true || !mounted) { remark.dispose(); return; }
    try {
      await ref.read(serviceProvider).dio.post('/sales-management/sales/${task['sale_id']}/calls', data: {
        'stage': task['stage'], 'outcome': outcome, 'remark': remark.text.trim(),
      });
      await load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Outcome saved')));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not save outcome. Try again.')));
    }
    remark.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final visible = tasks.where((task) => filter == 'All' ||
      (filter == 'Ready' && ['PENDING', 'FAILED'].contains(task['status'])) ||
      (filter == 'Waiting' && task['status'] == 'BLOCKED') ||
      (filter == 'Done' && ['COMPLETED', 'SKIPPED', 'CANCELLED'].contains(task['status']))).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Call work queue'), actions: [
        IconButton(onPressed: load, tooltip: 'Refresh', icon: const Icon(Icons.refresh)),
        IconButton(onPressed: () => ref.read(serviceProvider).logout(), tooltip: 'Sign out', icon: const Icon(Icons.logout)),
      ]),
      body: loading ? const Center(child: CircularProgressIndicator()) : error.isNotEmpty
        ? Center(child: TextButton(onPressed: load, child: Text(error)))
        : RefreshIndicator(onRefresh: load, child: ListView(padding: const EdgeInsets.all(15), children: [
            Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18), gradient: const LinearGradient(colors: [Color(0xFF7033BC), Color(0xFFAE2874)])),
              child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                const Text('Ready to contact', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                Text('${summary['actionable'] ?? 0}', style: const TextStyle(color: Colors.white, fontSize: 27, fontWeight: FontWeight.w900)),
              ])),
            const SizedBox(height: 14),
            SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: ['Ready','Waiting','Done','All'].map((value) => Padding(
              padding: const EdgeInsets.only(right: 6), child: ChoiceChip(label: Text(value), selected: filter == value,
                onSelected: (_) => setState(() => filter = value)))).toList())),
            const SizedBox(height: 12),
            if (visible.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('No calls in this view'))),
            ...visible.map((task) => Card(child: Padding(padding: const EdgeInsets.all(13), child: Column(
              crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${task['customer_name']}', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(task['stage'] == 'TELE_VERIFICATION' ? 'Tele-verification' : 'Welcome call'),
                Text('${task['plan_name']} · ${task['request_id']}', style: const TextStyle(color: Color(0xFF626C82))),
                Text('${task['branch']} · ${task['agent']}', style: const TextStyle(color: Color(0xFF626C82))),
                SelectableText('Phone: ${task['msisdn'] ?? task['alternate_number'] ?? 'Not recorded'}'),
                Text('Last outcome: ${task['last_outcome'] ?? 'Not started'}', style: const TextStyle(color: Color(0xFF626C82))),
                const SizedBox(height: 8),
                Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  Chip(label: Text('${task['status']}'.toLowerCase())),
                  if (['PENDING','FAILED'].contains(task['status'])) FilledButton.tonalIcon(
                    style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                    onPressed: () => record(task), icon: const Icon(Icons.call, size: 17), label: const Text('Record call')),
                ]),
              ])))),
          ])),
    );
  }
}
