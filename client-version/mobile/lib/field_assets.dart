import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'services.dart';

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
  @override
  void initState() { super.initState(); load(); poll = Timer.periodic(const Duration(seconds: 20), (_) => load(silent: true)); }
  @override
  void dispose() { poll?.cancel(); super.dispose(); }
  Future<void> load({bool silent = false}) async {
    if (fetching || !mounted) return;
    fetching = true;
    if (!silent) setState(() { loading = true; error = ''; });
    try {
      final s = ref.read(serviceProvider);
      final results = await Future.wait([s.dio.get('/field-assets'), s.dio.get('/field-assets/requests/list'), s.dio.get('/field-assets/report/summary')]);
      if (mounted) {
        setState(() {
          error = '';
          stock = (results[0].data as List).map((v) => Map<String,dynamic>.from(v)).toList();
          requests = (results[1].data as List).map((v) => Map<String,dynamic>.from(v)).toList();
          lowStock = (results[2].data as List).map((v) => Map<String,dynamic>.from(v)).where((row) => row['low_stock'] == true).toList();
        });
      }
    } catch (_) { if (mounted && !silent) setState(() => error = 'Could not load assets. Try again.'); }
    finally { fetching = false; if (mounted) setState(() => loading = false); }
  }
  Future<void> requestAsset() async {
    final agentId = ref.read(serviceProvider).user?['agent_id'];
    if (agentId == null) return;
    String category = 'GRABBA_DEVICE';
    String urgency = 'NORMAL';
    String quantity = '1';
    String reason = '';
    final form = GlobalKey<FormState>();
    final confirmed = await showModalBottomSheet<bool>(context: context, isScrollControlled: true,
      showDragHandle: true, builder: (context) => Padding(padding: EdgeInsets.fromLTRB(20,8,20,MediaQuery.viewInsetsOf(context).bottom+20),
        child: SingleChildScrollView(child: Form(key: form, child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Request stock', style: Theme.of(context).textTheme.titleLarge),
          DropdownButtonFormField<String>(initialValue: category, decoration: const InputDecoration(labelText:'Asset type'),
            items: const [DropdownMenuItem(value:'GRABBA_DEVICE',child:Text('Grabba device')),DropdownMenuItem(value:'ROUTER',child:Text('Router')),DropdownMenuItem(value:'STAMP',child:Text('Stamp')),DropdownMenuItem(value:'ID_CARD',child:Text('Staff ID card')),DropdownMenuItem(value:'UNIFORM',child:Text('Uniform')),DropdownMenuItem(value:'OTHER',child:Text('Other'))],
            onChanged: (value) => category = value ?? category),
          TextFormField(initialValue:quantity, onChanged:(value)=>quantity=value, keyboardType:TextInputType.number, decoration:const InputDecoration(labelText:'Quantity'),validator:(v)=> (int.tryParse(v??'')??0)<1?'Enter a quantity':null),
          DropdownButtonFormField<String>(initialValue: urgency, decoration: const InputDecoration(labelText:'Urgency'),
            items: const [DropdownMenuItem(value:'NORMAL',child:Text('Normal')),DropdownMenuItem(value:'URGENT',child:Text('Urgent'))],
            onChanged: (value) => urgency = value ?? 'NORMAL'),
          TextFormField(initialValue:reason, onChanged:(value)=>reason=value, decoration:const InputDecoration(labelText:'Reason'),validator:(v)=>(v??'').trim().length<5?'Enter a reason':null),
          const SizedBox(height:16), FilledButton(onPressed:(){if(form.currentState!.validate())Navigator.pop(context,true);},child:const Text('Submit request')),
        ])))));
    if (confirmed != true || !mounted) return;
    try {
      await ref.read(serviceProvider).dio.post('/field-assets/requests',data:{'agent_id':agentId,'category':category,'quantity':int.parse(quantity),'urgency':urgency,'reason':reason.trim()});
      await load();
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Stock request sent')));
    } catch (_) { if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Could not send request'))); }
  }
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Assets & supplies'),actions:[IconButton(onPressed:load,icon:const Icon(Icons.refresh))]),
    floatingActionButton: ref.watch(serviceProvider).user?['agent_id'] != null ? FloatingActionButton.extended(onPressed:requestAsset,icon:const Icon(Icons.add),label:const Text('Request stock')) : null,
    body: loading ? const Center(child:CircularProgressIndicator()) : error.isNotEmpty ? Center(child:TextButton(onPressed:load,child:Text(error))) : RefreshIndicator(onRefresh:load,child:ListView(padding:const EdgeInsets.all(16),children:[
      if(lowStock.isNotEmpty) Card(color:const Color(0xFFFFEBE9),child:Padding(padding:const EdgeInsets.all(12),child:Text('${lowStock.length} stock level${lowStock.length==1?' is':'s are'} below minimum',style:const TextStyle(color:Color(0xFF9A2D4A),fontWeight:FontWeight.w700)))),
      Text('Branch assets',style:Theme.of(context).textTheme.titleLarge),
      if(stock.isEmpty)const Padding(padding:EdgeInsets.all(16),child:Text('No assets assigned')),
      ...stock.map((a)=>Card(child:ListTile(leading:const Icon(Icons.inventory_2_outlined,color:Color(0xFF8136B3)),title:Text('${a['label']}'),subtitle:Text('${a['branch']} · ${a['serial']}'),trailing:Text('${a['status']}')))),
      const SizedBox(height:18),Text('Requests',style:Theme.of(context).textTheme.titleLarge),
      if(requests.isEmpty)const Padding(padding:EdgeInsets.all(16),child:Text('No requests yet')),
      ...requests.map((r)=>Card(child:ListTile(title:Text('${r['category']} · ${r['quantity']}'),subtitle:Text('${r['reason']} · ${r['urgency']}${r['response'] == null ? '' : '\n${r['response']} · ${r['responded_by']}'}'),trailing:Text('${r['status']}')))),
      const SizedBox(height:60),
    ])),
  );
}
