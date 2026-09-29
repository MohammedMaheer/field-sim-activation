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
  Json performance = {};
  bool loading = true;
  String error = '';
  bool saving = false;

  @override
  void initState() { super.initState(); load(); }

  Future<void> load() async {
    setState(() { loading = true; error = ''; });
    try {
      final service = ref.read(serviceProvider);
      final results = await Future.wait([
        service.dio.get('/sales-management/sales'),
        service.dio.get('/sales-management/feedback'),
        service.dio.get('/sales-management/performance'),
      ]);
      if (!mounted) return;
      setState(() {
        sales = (results[0].data as List).map((v) => Map<String, dynamic>.from(v)).toList();
        feedback = (results[1].data as List).map((v) => Map<String, dynamic>.from(v)).toList();
        performance = Map<String, dynamic>.from(results[2].data);
      });
    } catch (_) {
      if (mounted) setState(() => error = 'Could not load sales. Check your connection and retry.');
    } finally { if (mounted) setState(() => loading = false); }
  }

  Future<void> addFeedback() async {
    final user = ref.read(serviceProvider).user;
    final agentId = user?['agent_id'];
    if (agentId == null) return;
    final product = TextEditingController();
    final comment = TextEditingController();
    final reason = TextEditingController();
    final customer = TextEditingController();
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
        'product_suggested': product.text.trim(), 'rejection_reason': reason.text.trim(),
        'feedback': comment.text.trim(),
      });
      await load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Feedback saved')));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not save feedback. Please retry.')));
    } finally { if (mounted) setState(() => saving = false); }
  }

  @override
  Widget build(BuildContext context) {
    final isAgent = ref.watch(serviceProvider).user?['agent_id'] != null;
    return Scaffold(
      appBar: AppBar(title: const Text('Sales management'), actions: [IconButton(onPressed: load, icon: const Icon(Icons.refresh), tooltip: 'Refresh'), IconButton(onPressed: () => ref.read(serviceProvider).logout(), icon: const Icon(Icons.logout), tooltip: 'Sign out')]),
      floatingActionButton: tab == 1 && isAgent ? FloatingActionButton.extended(onPressed: saving ? null : addFeedback, icon: const Icon(Icons.add), label: const Text('Add feedback')) : null,
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
        Padding(padding: const EdgeInsets.symmetric(horizontal: 14), child: SegmentedButton<int>(segments: const [ButtonSegment(value: 0, label: Text('Sales')), ButtonSegment(value: 1, label: Text('Feedback'))], selected: {tab}, onSelectionChanged: (value) => setState(() => tab = value.first))),
        Expanded(child: RefreshIndicator(onRefresh: load, child: ListView.builder(
          padding: const EdgeInsets.all(14),
          itemCount: tab == 0 ? sales.length : feedback.length,
          itemBuilder: (context, index) {
            final row = tab == 0 ? sales[index] : feedback[index];
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
