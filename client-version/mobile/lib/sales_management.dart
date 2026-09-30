import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'services.dart';

class SalesManagementScreen extends ConsumerStatefulWidget {
  const SalesManagementScreen({super.key});
  @override
  ConsumerState<SalesManagementScreen> createState() => _SalesManagementScreenState();
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
  Timer? poll;

  @override
  void initState() { super.initState(); load(); poll = Timer.periodic(const Duration(seconds: 20), (_) {if (!saving) load(quiet: true);}); }

  @override
  void dispose() {poll?.cancel(); super.dispose();}

  Future<void> load({bool quiet = false}) async {
    if (fetching) return;
    fetching = true;
    if (!quiet) setState(() { loading = true; error = ''; });
    try {
      final service = ref.read(serviceProvider);
      final results = await Future.wait([
        service.dio.get('/sales-management/sales'),
        service.dio.get('/sales-management/feedback'),
        service.dio.get('/sales-management/performance'),
        service.dio.get('/sales-management/targets?period=${DateTime.now().toIso8601String().substring(0, 7)}'),
        service.dio.get('/resources/agents'),
      ]);
      if (!mounted) return;
      setState(() {
        sales = (results[0].data as List).map((v) => Map<String, dynamic>.from(v)).toList();
        feedback = (results[1].data as List).map((v) => Map<String, dynamic>.from(v)).toList();
        performance = Map<String, dynamic>.from(results[2].data);
        targets = (results[3].data as List).map((v) => Map<String, dynamic>.from(v)).toList();
        agents = (results[4].data as List).map((v) => Map<String, dynamic>.from(v)).toList();
      });
    } catch (_) {
      if (mounted && !quiet) setState(() => error = 'Could not load sales. Check your connection and retry.');
    } finally { fetching = false; if (mounted && !quiet) setState(() => loading = false); }
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
      context: context, isScrollControlled: true, showDragHandle: true,
      builder: (context) => Padding(
        padding: EdgeInsets.fromLTRB(20, 8, 20, MediaQuery.viewInsetsOf(context).bottom + 20),
        child: SingleChildScrollView(child: Form(key: form, child: Column(
          mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('No-sale feedback', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            TextFormField(controller: customer, decoration: const InputDecoration(labelText: 'Customer name')),
            TextFormField(controller: contact, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Contact number')),
            TextFormField(controller: product, decoration: const InputDecoration(labelText: 'Product suggested'), validator: (v) => (v ?? '').trim().length < 2 ? 'Enter a product' : null),
            TextFormField(controller: reason, decoration: const InputDecoration(labelText: 'Reason'), validator: (v) => (v ?? '').trim().length < 3 ? 'Enter a reason' : null),
            TextFormField(controller: comment, decoration: const InputDecoration(labelText: 'Customer feedback'), maxLines: 3, validator: (v) => (v ?? '').trim().length < 3 ? 'Enter feedback' : null),
            const SizedBox(height: 18),
            FilledButton(onPressed: () { if (form.currentState!.validate()) Navigator.pop(context, true); }, child: const Text('Save feedback')),
          ],
        ))),
      ),
    );
    if (save != true || !mounted) return;
    setState(() => saving = true);
    try {
      await ref.read(serviceProvider).dio.post('/sales-management/feedback', data: {
        'agent_id': agentId, 'customer_name': customer.text.trim(),
        'contact_number': contact.text.trim(),
        'product_suggested': product.text.trim(), 'rejection_reason': reason.text.trim(),
        'feedback': comment.text.trim(),
      });
      await load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Feedback saved')));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not save feedback. Please retry.')));
    } finally { if (mounted) setState(() => saving = false); }
  }

  Future<void> saleDetails(Json row) async {
    try {
      final response = await ref.read(serviceProvider).dio.get('/sales-management/sales/${row['id']}');
      final detail = Map<String, dynamic>.from(response.data);
      if (!mounted) return;
      await showModalBottomSheet<void>(context: context, isScrollControlled: true, showDragHandle: true, builder: (context) => SafeArea(child: SizedBox(height: MediaQuery.sizeOf(context).height * .78, child: ListView(padding: const EdgeInsets.fromLTRB(18, 0, 18, 20), children: [
        Text('${detail['customer_name']}', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        for (final entry in const {'status':'Sale status', 'agent':'Agent', 'leader':'Team leader', 'sales_manager':'Sales Manager', 'branch':'Branch', 'assignment_effective_at':'Assignment effective', 'order_type':'Order type', 'plan_name':'Plan', 'document':'Document', 'nationality':'Nationality', 'request_id':'Request ID', 'account_number':'Account number', 'msisdn':'Phone number', 'sim_serial':'SIM serial', 'router_serial':'Router serial', 'advance_transaction_number':'Advance transaction number', 'sr_number':'SR number', 'alternate_number':'Alternate number'}.entries)
          Container(padding: const EdgeInsets.symmetric(vertical: 8), decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0xFFE0D9ED)))), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: Text(entry.value, style: const TextStyle(fontSize: 12, color: Color(0xFF657089)))), Expanded(child: Text((detail[entry.key] ?? '').toString().isEmpty ? 'Not recorded' : '${detail[entry.key]}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)))])),
        const SizedBox(height: 12),
        for (final call in detail['calls'] as List) Text('${call['stage'] == 'TELE_VERIFICATION' ? 'Tele-verification' : 'Welcome call'} · ${call['status']}'),
        for (final attempt in detail['attempts'] as List) Card(child: Padding(padding: const EdgeInsets.all(10), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('${attempt['outcome']} · ${attempt['actor']}'), Text('${attempt['remark']}')]))),
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
      ]))));
    } catch (_) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not load sale details. Please retry.'))); }
  }

  Future<void> setTarget() async {
    String? agentId;
    String product = 'ALL';
    final daily = TextEditingController(text: '0'), monthly = TextEditingController(text: '0');
    final form = GlobalKey<FormState>();
    final saved = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, showDragHandle: true, builder: (context) => StatefulBuilder(builder: (context, change) => Padding(padding: EdgeInsets.fromLTRB(18, 0, 18, MediaQuery.viewInsetsOf(context).bottom + 18), child: SingleChildScrollView(child: Form(key: form, child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Set target', style: Theme.of(context).textTheme.titleLarge), const SizedBox(height: 12),
      DropdownButtonFormField<String>(decoration: const InputDecoration(labelText: 'Agent'), isExpanded: true, items: [for (final agent in agents) DropdownMenuItem(value: '${agent['id']}', child: Text('${agent['name']}'))], onChanged: (value) => agentId = value, validator: (value) => value == null ? 'Choose agent' : null),
      DropdownButtonFormField<String>(initialValue: product, decoration: const InputDecoration(labelText: 'Product'), items: [for (final value in ['ALL','NEW','MNP','P2P','HW','ELIFE','WASEL','VISITOR']) DropdownMenuItem(value: value, child: Text(value == 'ALL' ? 'All products' : value))], onChanged: (value) => product = value!),
      TextFormField(controller: daily, decoration: const InputDecoration(labelText: 'Daily target'), keyboardType: TextInputType.number, validator: (value) => int.tryParse(value ?? '') == null || int.parse(value!) < 0 || int.parse(value) > 1000 ? 'Enter 0–1000' : null),
      TextFormField(controller: monthly, decoration: const InputDecoration(labelText: 'Monthly target'), keyboardType: TextInputType.number, validator: (value) => int.tryParse(value ?? '') == null || int.parse(value!) < 0 || int.parse(value) > 10000 ? 'Enter 0–10000' : null),
      const SizedBox(height: 12), FilledButton(onPressed: () {if (form.currentState!.validate()) Navigator.pop(context, true);}, child: const Text('Save target')), TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
    ]))))));
    if (saved == true) {
      try { await ref.read(serviceProvider).dio.put('/sales-management/targets', data: {'agent_id':agentId,'order_type':product,'period':DateTime.now().toIso8601String().substring(0,7),'daily_target':int.parse(daily.text),'monthly_target':int.parse(monthly.text)}); await load(); }
      catch (_) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not save target. Please retry.'))); }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isAgent = ref.watch(serviceProvider).user?['agent_id'] != null;
    final canSet = ['Administrator', 'Operations Manager', 'Team Leader'].contains(ref.watch(serviceProvider).user?['role']);
    return Scaffold(
      appBar: AppBar(title: const Text('Sales management'), actions: [IconButton(onPressed: load, icon: const Icon(Icons.refresh), tooltip: 'Refresh'), IconButton(onPressed: () => ref.read(serviceProvider).logout(), icon: const Icon(Icons.logout), tooltip: 'Sign out')]),
      floatingActionButton: tab == 1 && isAgent ? FloatingActionButton.extended(onPressed: saving ? null : addFeedback, icon: const Icon(Icons.add), label: const Text('Add feedback')) : tab == 2 && canSet ? FloatingActionButton.extended(onPressed: setTarget, icon: const Icon(Icons.flag_outlined), label: const Text('Set target')) : null,
      body: loading ? const Center(child: CircularProgressIndicator()) : error.isNotEmpty ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Text(error), TextButton(onPressed: load, child: const Text('Retry'))])) : Column(children: [
        Container(
          margin: const EdgeInsets.all(14), padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(gradient: const LinearGradient(colors: [Color(0xFF7428B4), Color(0xFFB02D87)]), borderRadius: BorderRadius.circular(18)),
          child: Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
            _metric('Recorded', '${performance['recorded'] ?? 0}'),
            _metric('Closed', '${performance['closed'] ?? 0}'),
            _metric('Remaining', '${performance['remaining'] ?? 0}'),
          ]),
        ),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 14), child: SegmentedButton<int>(segments: const [ButtonSegment(value: 0, label: Text('Sales')), ButtonSegment(value: 1, label: Text('Feedback')), ButtonSegment(value: 2, label: Text('Targets'))], selected: {tab}, onSelectionChanged: (value) => setState(() => tab = value.first))),
        Expanded(child: RefreshIndicator(onRefresh: load, child: ListView.builder(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 90),
          itemCount: (tab == 0 ? sales.length : tab == 1 ? feedback.length : targets.length) == 0 ? 1 : tab == 0 ? sales.length : tab == 1 ? feedback.length : targets.length,
          itemBuilder: (context, index) {
            if ((tab == 0 ? sales : tab == 1 ? feedback : targets).isEmpty) return Padding(padding: const EdgeInsets.all(20), child: Text(tab == 0 ? 'No sales recorded yet' : tab == 1 ? 'No feedback recorded yet' : 'No targets set for this month', textAlign: TextAlign.center));
            final row = tab == 0 ? sales[index] : tab == 1 ? feedback[index] : targets[index];
            if (tab == 2) return Card(child: ListTile(title: Text('${row['agent']}'), subtitle: Text('${row['period']} · ${row['order_type']}'), trailing: Text('${row['daily_target']} / day\n${row['monthly_target']} / month', style: const TextStyle(fontWeight: FontWeight.w700))));
            if (tab == 0) return Card(margin: const EdgeInsets.only(bottom: 9), child: ListTile(onTap: () => saleDetails(row), title: Text('${row['customer_name']}'), subtitle: Text('${row['plan_name']} · ${row['order_type']}\n${row['request_id']} · ${row['status']}'), trailing: const Icon(Icons.chevron_right)));
            return Card(margin: const EdgeInsets.only(bottom: 9), child: Padding(
              padding: const EdgeInsets.all(13), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text((row['customer_name'] as String?)?.isNotEmpty == true ? row['customer_name'] : 'Customer not recorded', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 5),
                Text(tab == 0 ? '${row['plan_name']} · ${row['order_type']}' : '${row['product_suggested']} · ${row['rejection_reason']}'),
                const SizedBox(height: 4),
                Text(tab == 0 ? '${row['request_id']} · ${row['status']}' : '${row['feedback']}', style: const TextStyle(color: Color(0xFF60677C))),
              ]),
            ));
          },
        )))
      ]),
    );
  }

  Widget _metric(String label, String value) => Column(children: [Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)), Text(value, style: const TextStyle(color: Colors.white, fontSize: 23, fontWeight: FontWeight.w800))]);
}
