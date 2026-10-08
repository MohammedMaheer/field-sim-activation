import 'package:flutter/material.dart';
import 'typography.dart';
import 'sr_verification.dart';

Map<String, dynamic> paymentInvoice(Map<String, dynamic> row) {
  final intake = row['intake'] as Map? ?? {};
  final saleMode = intake['capture_mode'] == 'SCREENSHOT_SALE';
  final orderMode = [
    'SCREENSHOT_ORDER',
    'SCREENSHOT_SALE',
  ].contains(intake['capture_mode']);
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
      : orderMode
      ? 'Pending backend confirmation'
      : 'Pending verification';
  return {
    'heading': row['status'] == 'REJECTED'
        ? 'Correction required'
        : saleMode
        ? row['status'] == 'VERIFIED'
              ? 'Sale verified'
              : 'Sale submitted'
        : orderMode
        ? 'Payment recorded'
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
            orderMode
                ? (row['status'] == 'VERIFIED'
                      ? 'Confirmed by backend'
                      : 'Recorded by agent')
                : row['activation']?['status'] ?? 'Awaiting backend team',
          ),
        ],
      },
      {
        'title': 'Customer',
        'fields': [
          for (final key in {
            'name': 'Customer name',
            'arabic_name': 'Arabic name',
            'issue_date': 'Issue date',
            'gender': 'Gender',
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
            (intake['sim_identifier'] ?? '').toString().isEmpty
                ? null
                : intake['sim_type'] == 'ESIM'
                ? 'eSIM'
                : 'Physical SIM',
          ),
          field('SIM serial', intake['sim_identifier']),
          field('Plan', intake['plan_name']),
          field('Package', intake['package_name']),
          field('Request ID', intake['order_reference']),
          field('Monthly charge', intake['monthly_cost']),
          field('Prepayment on order', intake['prepayment']),
          if (orderMode) ...[
            field('Order type', intake['order_type']),
            field('Router fulfilment', intake['router_fulfilment']),
            field('Account number', intake['account_number']),
            field('Router serial', intake['router_serial']),
            field(
              'Advance transaction number',
              intake['advance_transaction_number'],
            ),
            field('SR number', intake['sr_number']),
            field('Alternate contact number', intake['alternate_number']),
          ],
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
        'title': saleMode ? 'Sale' : 'Payment',
        'fields': [
          if (saleMode) ...[
            field('SR number', intake['sr_number']),
            field(
              'SR verification',
              srVerificationLabel(row['sr_verification']?['status']),
            ),
            field('Backend verification', status),
            field(
              'Payment receipt',
              row['payment_record_status'] == 'RECORDED'
                  ? 'Recorded'
                  : 'Not recorded',
            ),
          ] else if (orderMode) ...[
            field('Request ID', intake['order_reference']),
            field('Agent payment record', 'Uploaded'),
            field('Backend confirmation', status),
          ] else ...[
            field(
              'Payment reference',
              find([
                    'payment reference',
                    'transaction reference',
                    'reference',
                  ]) ??
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
        ],
      },
      {
        'title': 'Records',
        'fields': [
          field(
            intake['capture_mode'] == 'SCREENSHOT_ORDER'
                ? 'Customer details screen'
                : 'Identity document',
            (intake['document_image'] ?? '').isNotEmpty ? 'Captured' : null,
          ),
          field(
            'Order details screen',
            (intake['order_image'] ?? '').isNotEmpty ? 'Captured' : null,
          ),
          field(
            'Selfie',
            (intake['selfie_image'] ?? '').isNotEmpty ? 'Captured' : null,
          ),
          if (intake['capture_mode'] != 'SCREENSHOT_ORDER')
            field(
              'Customer signature',
              (intake['signature'] as List? ?? []).isNotEmpty
                  ? 'Captured'
                  : null,
            ),
          if (!saleMode) field('Payment confirmation', 'Uploaded'),
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

  String displayValue(Map field) {
    final value = field['value'] as String;
    if ([
      'Request ID',
      'Invoice number',
      'Payment reference',
      'SIM serial',
    ].contains(field['label'])) {
      return value.replaceAllMapped(
        RegExp(r'[-_/]'),
        (match) => '${match[0]}\u200b',
      );
    }
    return value;
  }

  TextStyle valueStyle(Map field) {
    final numeric =
        field['value'] != 'Not recorded' &&
        RegExp(
          r'number|serial|reference|^request id$|phone|charge|prepayment|price|total paid|vat|date|expiry',
          caseSensitive: false,
        ).hasMatch(field['label'] as String);
    return (numeric ? RelayTypography.numeric : RelayTypography.bodyStrong)
        .copyWith(
          fontSize: 13,
          color: field['value'] == 'Not recorded'
              ? const Color(0xff6a7180)
              : const Color(0xff25283d),
        );
  }

  Widget section(Map section) => Container(
    margin: const EdgeInsets.only(top: 9),
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    decoration: BoxDecoration(
      color: const Color(0xfffafbfe),
      border: Border.all(color: const Color(0xffdce2ed)),
      borderRadius: BorderRadius.circular(9),
    ),
    child: LayoutBuilder(
      builder: (context, constraints) {
        final textScale = MediaQuery.textScalerOf(context).scale(13) / 13;
        final stacked = constraints.maxWidth / textScale < 205;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              section['title'],
              style: RelayTypography.section.copyWith(
                fontSize: 15,
                color: Color(0xff762765),
              ),
            ),
            const SizedBox(height: 5),
            for (final field in section['fields'])
              Container(
                padding: const EdgeInsets.symmetric(vertical: 7),
                decoration: const BoxDecoration(
                  border: Border(bottom: BorderSide(color: Color(0xffe7ebf2))),
                ),
                child: stacked
                    ? Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            field['label'],
                            style: RelayTypography.label.copyWith(
                              color: const Color(0xff596675),
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            displayValue(field),
                            semanticsLabel: field['value'],
                            style: valueStyle(field),
                          ),
                        ],
                      )
                    : Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            flex: 4,
                            child: Text(
                              field['label'],
                              style: RelayTypography.label.copyWith(
                                color: Color(0xff596675),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            flex: 6,
                            child: Text(
                              displayValue(field),
                              semanticsLabel: field['value'],
                              textAlign: TextAlign.right,
                              style: valueStyle(field),
                            ),
                          ),
                        ],
                      ),
              ),
          ],
        );
      },
    ),
  );

  @override
  Widget build(BuildContext context) {
    final sections = (widget.invoice['sections'] as List).cast<Map>();
    const primary = <String, List<String>>{
      'Invoice': ['Invoice number', 'Date'],
      'Customer': ['Customer name', 'Document number', 'Phone number'],
      'SIM & plan': [
        'Request ID',
        'Plan',
        'Monthly charge',
        'Prepayment on order',
      ],
      'Payment': [
        'Payment reference',
        'Total paid',
        'Agent payment record',
        'Backend confirmation',
      ],
      'Sale': [
        'SR number',
        'SR verification',
        'Backend verification',
        'Payment receipt',
      ],
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
          const SizedBox(height: 10),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              textStyle: RelayTypography.bodyStrong,
            ),
            onPressed: () => setState(() => expanded = !expanded),
            icon: Icon(expanded ? Icons.expand_less : Icons.expand_more),
            label: Text(
              expanded ? 'Hide supporting details' : 'Show supporting details',
              textAlign: TextAlign.center,
            ),
          ),
          if (expanded)
            for (final item in extra) section(item),
        ],
      ],
    );
  }
}
