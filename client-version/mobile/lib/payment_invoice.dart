import 'package:flutter/material.dart';

Map<String, dynamic> paymentInvoice(Map<String, dynamic> row) {
  final intake = row['intake'] as Map? ?? {};
  final date = DateTime.tryParse(
    row['created_at']?.toString() ?? '',
  )?.toLocal();
  final dateText = date == null
      ? null
      : '${date.day.toString().padLeft(2, '0')} ${const ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.month - 1]} ${date.year}, ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  final id = row['id'].toString();
  final invoiceId = id.startsWith('capture-')
      ? id.substring((id.length - 12).clamp(0, id.length))
      : id.substring(0, id.length.clamp(0, 8));

  final plan = row['plan_snapshot'] as Map? ?? {};
  final fields = [
    for (final item in row['rows'] as List? ?? [])
      ...item['fields'] as List? ?? [],
  ];
  String? find(List<String> labels) {
    for (final field in fields) {
      if (labels.contains(
            (field['label'] ?? '').toString().trim().toLowerCase(),
          ) &&
          (field['value'] ?? '').toString().trim().isNotEmpty) {
        return field['value'].toString();
      }
    }
    return null;
  }

  Map<String, String> field(String label, dynamic value) {
    var text = (value ?? '').toString().trim();
    if (text.isNotEmpty &&
        RegExp(
          r'document number|passport|identity|subscriber.*id|customer.*id|emirates.*id|national.*id|^id(?:\s|$)',
          caseSensitive: false,
        ).hasMatch(label)) {
      text = '**** ${text.length > 4 ? text.substring(text.length - 4) : text}';
    }
    return {'label': label, 'value': text.isEmpty ? 'Not recorded' : text};
  }

  final status = row['status'] == 'VERIFIED'
      ? 'Verified'
      : row['status'] == 'REJECTED'
      ? 'Correction required'
      : 'Pending verification';
  return {
    'heading': row['status'] == 'REJECTED'
        ? 'Correction required'
        : 'Payment successful',
    'status': status,
    'sections': [
      {
        'title': 'Invoice',
        'fields': [
          field('Invoice number', 'PAY-${invoiceId.toUpperCase()}'),
          field('Date', dateText),
          field('Review', status),
          field(
            'Activation',
            row['activation']?['status'] ?? 'Awaiting backend team',
          ),
        ],
      },
      {
        'title': 'Customer',
        'fields': [
          for (final key in {
            'name': 'Customer name',
            'document_type': 'Document type',
            'document_number': 'Document number',
            'nationality': 'Nationality',
            'birth_date': 'Date of birth',
            'expiry_date': 'Document expiry',
            'msisdn': 'Phone number',
          }.entries)
            field(key.value, intake[key.key]),
        ],
      },
      {
        'title': 'SIM & plan',
        'fields': [
          field(
            'SIM type',
            intake['sim_type'] == 'ESIM' ? 'eSIM' : 'Physical SIM',
          ),
          field('SIM serial', intake['sim_identifier']),
          field('Plan', intake['plan_name']),
          field(
            'Plan price',
            plan['monthly_cost'] == null
                ? null
                : 'AED ${(plan['monthly_cost'] as num).toStringAsFixed(2)}',
          ),
          field('Plan benefits', plan['promotion']),
        ],
      },
      {
        'title': 'Payment',
        'fields': [
          field(
            'Payment reference',
            find(['payment reference', 'transaction reference', 'reference']) ??
                row['payment_reference'],
          ),
          field(
            'Total paid',
            find([
              'total paid',
              'amount paid',
              'total amount',
              'transaction amount',
            ]),
          ),
          field('Payment method', find(['payment method', 'method'])),
          field('VAT', find(['vat', 'vat amount', 'tax'])),
        ],
      },
      {
        'title': 'Records',
        'fields': [
          field(
            'Identity document',
            (intake['document_image'] ?? '').isNotEmpty ? 'Captured' : null,
          ),
          field(
            'Selfie',
            (intake['selfie_image'] ?? '').isNotEmpty ? 'Captured' : null,
          ),
          field(
            'Customer signature',
            (intake['signature'] as List? ?? []).isNotEmpty ? 'Captured' : null,
          ),
          field('Payment confirmation', 'Uploaded'),
          field('Verified by', row['review']?['reviewer']),
          field('Activation reference', row['activation']?['reference']),
        ],
      },
      if (fields.isNotEmpty)
        {
          'title': 'Confirmation details',
          'fields': [for (final f in fields) field(f['label'], f['value'])],
        },
    ],
  };
}

class PaymentInvoiceSections extends StatefulWidget {
  const PaymentInvoiceSections({super.key, required this.invoice});
  final Map invoice;

  @override
  State<PaymentInvoiceSections> createState() => _PaymentInvoiceSectionsState();
}

class _PaymentInvoiceSectionsState extends State<PaymentInvoiceSections> {
  bool expanded = false;

  Widget section(Map section) => Padding(
    padding: const EdgeInsets.only(top: 6),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          section['title'],
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w800,
            color: Color(0xff762765),
          ),
        ),
        const SizedBox(height: 3),
        for (final field in section['fields'])
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  flex: 4,
                  child: Text(
                    field['label'],
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(0xff596675),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 5,
                  child: Text(
                    field['value'],
                    textAlign: TextAlign.right,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: field['value'] == 'Not recorded'
                          ? const Color(0xff6a7180)
                          : const Color(0xff25283d),
                    ),
                  ),
                ),
              ],
            ),
          ),
        const Divider(height: 8),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final sections = (widget.invoice['sections'] as List).cast<Map>();
    const primary = <String, List<String>>{
      'Invoice': ['Invoice number', 'Date'],
      'Customer': ['Customer name', 'Document number', 'Phone number'],
      'SIM & plan': ['SIM type', 'SIM serial', 'Plan', 'Plan price'],
      'Payment': ['Payment reference', 'Total paid'],
    };
    final main = <Map>[];
    final otherFields = <dynamic>[];
    final extra = <Map>[];
    for (final item in sections) {
      final labels = primary[item['title']];
      if (labels == null) {
        extra.add(item);
      } else {
        final fields = (item['fields'] as List);
        main.add({
          ...item,
          'fields': fields.where((f) => labels.contains(f['label'])).toList(),
        });
        otherFields.addAll(
          fields.where(
            (f) => !labels.contains(f['label']) && f['label'] != 'Review',
          ),
        );
      }
    }
    if (otherFields.isNotEmpty) {
      extra.insert(0, {'title': 'More invoice details', 'fields': otherFields});
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final item in main) section(item),
        if (extra.isNotEmpty) ...[
          OutlinedButton.icon(
            onPressed: () => setState(() => expanded = !expanded),
            icon: Icon(expanded ? Icons.expand_less : Icons.expand_more),
            label: Text(
              expanded ? 'Hide supporting details' : 'Show supporting details',
            ),
          ),
          if (expanded)
            for (final item in extra) section(item),
        ],
      ],
    );
  }
}
