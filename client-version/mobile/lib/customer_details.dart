import 'package:flutter/material.dart';
import 'services.dart';
import 'sales_presentation.dart';
import 'typography.dart';

Future<void> showCustomerDetails(BuildContext context, Json rawCustomer) {
  final customer = {...rawCustomer, ...Json.from(rawCustomer['details'] ?? {})};
  customer['phone_number'] = customer['msisdn'] ?? customer['mobile'];
  final history = (customer['sales'] ?? customer['history'] ?? []) as List;
  if (history.isNotEmpty) customer['leader'] ??= history.first['leader'];
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .8,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 0, 18, 22),
          children: [
            Text(
              recordedValue(customer['name']),
              style: RelayTypography.section,
            ),
            const SizedBox(height: 12),
            for (final field in const {
              'phone_number': 'Phone number',
              'arabic_name': 'Arabic name',
              'alternate_number': 'Alternate number',
              'document': 'Document',
              'document_type': 'Document type',
              'nationality': 'Nationality',
              'date_of_birth': 'Date of birth',
              'issue_date': 'Issue date',
              'expiry_date': 'Expiry date',
              'sex': 'Sex',
              'agent': 'Sales agent',
              'branch': 'Branch',
              'leader': 'Team leader',
              'sr_number': 'SR number',
              'request_id': 'Request ID',
              'account_number': 'Account number',
            }.entries)
              _field(field.value, recordedValue(customer[field.key])),
            const SizedBox(height: 18),
            const Text('Sales history', style: RelayTypography.section),
            for (final sale
                in (customer['sales'] ?? customer['history'] ?? []) as List)
              Card(
                margin: const EdgeInsets.only(top: 10),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        activationLabel(Json.from(sale)),
                        style: RelayTypography.bodyStrong,
                      ),
                      for (final field in const {
                        'created_at': 'Recorded',
                        'order_type': 'Order type',
                        'plan_name': 'Plan',
                        'request_id': 'Request ID',
                        'sr_number': 'SR number',
                        'account_number': 'Account number',
                        'msisdn': 'Phone number',
                        'sim_serial': 'SIM serial',
                        'router_fulfilment': 'Router fulfilment',
                        'router_serial': 'Router serial',
                        'monthly_cost': 'Monthly charge',
                        'prepayment': 'Order prepayment',
                        'payment_record_status': 'Payment receipt',
                      }.entries)
                        _field(
                          field.value,
                          field.key == 'order_type'
                              ? productLabel(sale[field.key])
                              : recordedValue(sale[field.key]),
                        ),
                    ],
                  ),
                ),
              ),
            if (((customer['sales'] ?? customer['history'] ?? []) as List)
                .isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 14),
                child: Text('No sales recorded'),
              ),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close'),
            ),
          ],
        ),
      ),
    ),
  );
}

Widget _field(String label, String value) => Container(
  padding: const EdgeInsets.symmetric(vertical: 9),
  decoration: const BoxDecoration(
    border: Border(bottom: BorderSide(color: Color(0xffe0d9ed))),
  ),
  child: Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Expanded(flex: 2, child: Text(label, style: RelayTypography.caption)),
      const SizedBox(width: 14),
      Expanded(flex: 3, child: Text(value, style: RelayTypography.bodyStrong)),
    ],
  ),
);
