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
  bool loading = true;
  String error = '';
  @override
  void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { loading = true; error = ''; });
    try {
      final s = ref.read(serviceProvider);
      final results = await Future.wait([s.dio.get('/field-assets'), s.dio.get('/field-assets/requests/list')]);
      if (mounted) {
        setState(() {
          stock = (results[0].data as List).map((v) => Map<String,dynamic>.from(v)).toList();
          requests = (results[1].data as List).map((v) => Map<String,dynamic>.from(v)).toList();
        });
      }
    } catch (_) { if (mounted) setState(() => error = 'Could not load assets. Try again.'); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> requestAsset() async {
    final agentId = ref.read(serviceProvider).user?['agent_id'];
    if (agentId == null) return;
    String category = 'GRABBA_DEVICE';
    final quantity = TextEditingController(text: '1');
    final reason = TextEditingController();
    final form = GlobalKey<FormState>();
    final confirmed = await showModalBottomSheet<bool>(context: context, isScrollControlled: true,
      showDragHandle: true, builder: (context) => Padding(padding: EdgeInsets.fromLTRB(20,8,20,MediaQuery.viewInsetsOf(context).bottom+20),
        child: Form(key: form, child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Request stock', style: Theme.of(context).textTheme.titleLarge),
          DropdownButtonFormField<String>(initialValue: category, decoration: const InputDecoration(labelText:'Asset type'),
            items: const [DropdownMenuItem(value:'GRABBA_DEVICE',child:Text('Grabba device')),DropdownMenuItem(value:'ROUTER',child:Text('Router')),DropdownMenuItem(value:'STAMP',child:Text('Stamp')),DropdownMenuItem(value:'ID_CARD',child:Text('Staff ID card')),DropdownMenuItem(value:'UNIFORM',child:Text('Uniform')),DropdownMenuItem(value:'OTHER',child:Text('Other'))],
            onChanged: (value) => category = value ?? category),
          TextFormField(controller:quantity, keyboardType:TextInputType.number, decoration:const InputDecoration(labelText:'Quantity'),validator:(v)=> (int.tryParse(v??'')??0)<1?'Enter a quantity':null),
          TextFormField(controller:reason, decoration:const InputDecoration(labelText:'Reason'),validator:(v)=>(v??'').trim().length<5?'Enter a reason':null),
          const SizedBox(height:16), FilledButton(onPressed:(){if(form.currentState!.validate())Navigator.pop(context,true);},child:const Text('Submit request')),
        ]))));
    if (confirmed != true || !mounted) return;
    try {
      await ref.read(serviceProvider).dio.post('/field-assets/requests',data:{'agent_id':agentId,'category':category,'quantity':int.parse(quantity.text),'reason':reason.text.trim()});
      await load();
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Stock request sent')));
    } catch (_) { if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Could not send request'))); }
  }
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Assets & supplies'),actions:[IconButton(onPressed:load,icon:const Icon(Icons.refresh))]),
    floatingActionButton: ref.watch(serviceProvider).user?['agent_id'] != null ? FloatingActionButton.extended(onPressed:requestAsset,icon:const Icon(Icons.add),label:const Text('Request stock')) : null,
    body: loading ? const Center(child:CircularProgressIndicator()) : error.isNotEmpty ? Center(child:TextButton(onPressed:load,child:Text(error))) : RefreshIndicator(onRefresh:load,child:ListView(padding:const EdgeInsets.all(16),children:[
      Text('Assigned assets',style:Theme.of(context).textTheme.titleLarge),
      if(stock.isEmpty)const Padding(padding:EdgeInsets.all(16),child:Text('No assets assigned')),
      ...stock.map((a)=>Card(child:ListTile(leading:const Icon(Icons.inventory_2_outlined,color:Color(0xFF8136B3)),title:Text('${a['label']}'),subtitle:Text('${a['branch']} · ${a['serial']}'),trailing:Text('${a['status']}')))),
      const SizedBox(height:18),Text('Requests',style:Theme.of(context).textTheme.titleLarge),
      if(requests.isEmpty)const Padding(padding:EdgeInsets.all(16),child:Text('No requests yet')),
      ...requests.map((r)=>Card(child:ListTile(title:Text('${r['category']} · ${r['quantity']}'),subtitle:Text('${r['reason']}'),trailing:Text('${r['status']}')))),
      const SizedBox(height:60),
    ])),
  );
}
