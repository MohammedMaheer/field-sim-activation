import 'package:flutter/material.dart';
import 'services.dart';
import 'sales_presentation.dart';
import 'typography.dart';

/// Missing product targets stay visibly unconfigured rather than appearing as
/// zero or inheriting a SIM target from another product.
class ProductTargets extends StatelessWidget {
  final Json performance;
  const ProductTargets({super.key, required this.performance});
  dynamic target(String key, String product) {
    final values = performance[key];
    if (values is List) {
      for (final row in values) {
        if (row is Map && row['order_type'] == product) return row['target'];
      }
    }
    if (values is Map) return values[product];
    return null;
  }

  @override
  Widget build(BuildContext context) => Card(
    margin: const EdgeInsets.symmetric(vertical: 8),
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Product targets', style: RelayTypography.bodyStrong),
          const SizedBox(height: 12),
          const Row(
            children: [
              Expanded(
                flex: 2,
                child: Text('Product', style: RelayTypography.caption),
              ),
              Expanded(
                child: Text(
                  'Daily',
                  textAlign: TextAlign.right,
                  style: RelayTypography.caption,
                ),
              ),
              Expanded(
                child: Text(
                  'Monthly',
                  textAlign: TextAlign.right,
                  style: RelayTypography.caption,
                ),
              ),
            ],
          ),
          const Divider(height: 16),
          for (final product in [
            'NEW',
            'MNP',
            'P2P',
            'HW',
            'ELIFE',
            'WASEL',
            'VISITOR',
          ])
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    flex: 2,
                    child: Text(
                      productLabel(product),
                      style: RelayTypography.label,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${target('daily_targets_by_product', product) ?? 'Not set'}',
                      textAlign: TextAlign.right,
                      style: RelayTypography.label,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${target('monthly_targets_by_product', product) ?? 'Not set'}',
                      textAlign: TextAlign.right,
                      style: RelayTypography.label,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    ),
  );
}
