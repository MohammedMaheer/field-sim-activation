import 'experience.dart';
import 'package:flutter/material.dart';
import 'services.dart';
import 'typography.dart';

const chartViolet = RelayPalette.plum, chartTeal = RelayPalette.teal;

class WeeklyActivityCard extends StatelessWidget {
  final Json data;
  const WeeklyActivityCard(this.data, {super.key});
  @override
  Widget build(BuildContext context) {
    final trend = (data['trend'] as List? ?? []).cast<Json>();
    final maxValue = trend.fold<double>(
      1,
      (v, r) => [
        v,
        (r['captures'] as num? ?? 0).toDouble(),
        (r['activations'] as num? ?? 0).toDouble(),
      ].reduce((a, b) => a > b ? a : b),
    );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Your week in view', style: RelayTypography.section),
            const SizedBox(height: 5),
            const Text(
              'KYC captures and completed sales',
              style: RelayTypography.caption,
            ),
            const SizedBox(height: 22),
            LayoutBuilder(
              builder: (context, constraints) {
                final scale = MediaQuery.textScalerOf(context).scale(12) / 12;
                final minimumWidth = trend.length * 36 * scale;
                final chart = Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: trend
                      .map(
                        (r) => Expanded(
                          child: Semantics(
                            label:
                                '${r['date']}: ${r['captures'] ?? 0} captures, ${r['activations']} sales',
                            child: Column(
                              children: [
                                SizedBox(
                                  height: 105,
                                  child: Row(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      _bar(
                                        ((r['captures'] as num? ?? 0) /
                                                maxValue) *
                                            100,
                                        chartViolet,
                                      ),
                                      const SizedBox(width: 4),
                                      _bar(
                                        ((r['activations'] as num? ?? 0) /
                                                maxValue) *
                                            100,
                                        chartTeal,
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(height: 9),
                                Text(
                                  '${r['day']}',
                                  textAlign: TextAlign.center,
                                  style: RelayTypography.caption,
                                ),
                              ],
                            ),
                          ),
                        ),
                      )
                      .toList(),
                );
                if (constraints.maxWidth < minimumWidth) {
                  return SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: SizedBox(width: minimumWidth, child: chart),
                  );
                }
                return chart;
              },
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 16,
              runSpacing: 8,
              children: const [
                _Legend('Captures', chartViolet),
                _Legend('Sales', chartTeal),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _bar(double height, Color color) => Container(
    width: 10,
    height: height.clamp(2, 100),
    decoration: BoxDecoration(
      color: height == 0 ? const Color(0xFFE3E7F0) : color,
      borderRadius: BorderRadius.circular(4),
    ),
  );
}

class VerificationCard extends StatelessWidget {
  final Json data;
  const VerificationCard(this.data, {super.key});
  @override
  Widget build(BuildContext context) {
    final rows = (data['capture_statuses'] as List? ?? []).cast<Json>();
    final verified = rows
        .where((r) => r['name'] == 'VERIFIED')
        .fold<int>(0, (v, r) => v + (r['value'] as num).toInt());
    final total = (data['capture_total'] as num? ?? 0).toInt();
    final pending = (data['kyc_pending_review'] as num? ?? 0).toInt();
    return Card(
      color: const Color(0xFFEEF9F5),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.fact_check_outlined, color: chartTeal),
                const SizedBox(width: 9),
                const Expanded(
                  child: Text(
                    'Verification progress',
                    style: RelayTypography.section,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 17),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  '$verified',
                  style: RelayTypography.numeric.copyWith(
                    fontSize: 29,
                    fontWeight: FontWeight.w700,
                    color: chartTeal,
                  ),
                ),
                Text(
                  '/ $total verified',
                  style: RelayTypography.label.copyWith(
                    color: const Color(0xFF567770),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            LinearProgressIndicator(
              value: total == 0 ? 0 : verified / total,
              minHeight: 8,
              borderRadius: BorderRadius.circular(5),
              color: chartTeal,
              backgroundColor: const Color(0xFFD3EAE2),
            ),
            const SizedBox(height: 10),
            Text(
              '$pending awaiting backend review',
              style: RelayTypography.caption.copyWith(
                color: const Color(0xFF567770),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  final String label;
  final Color color;
  const _Legend(this.label, this.color);
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: 8,
        height: 8,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(3),
        ),
      ),
      const SizedBox(width: 5),
      Text(label, style: RelayTypography.caption),
    ],
  );
}
