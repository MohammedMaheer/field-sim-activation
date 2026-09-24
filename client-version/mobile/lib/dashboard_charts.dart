import 'package:flutter/material.dart';
import 'services.dart';

const chartViolet = Color(0xFF8550D5), chartTeal = Color(0xFF0C9A8A);

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
            const Text(
              'Your week in view',
              style: TextStyle(
                fontFamily: 'Manrope',
                fontWeight: FontWeight.w800,
                fontSize: 18,
              ),
            ),
            const SizedBox(height: 5),
            const Text(
              'KYC captures and completed sales',
              style: TextStyle(fontSize: 12, color: Color(0xFF69758E)),
            ),
            const SizedBox(height: 22),
            Row(
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
                                    ((r['captures'] as num? ?? 0) / maxValue) *
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
                              style: const TextStyle(
                                fontSize: 10,
                                color: Color(0xFF69758E),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  )
                  .toList(),
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
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 17),
            Row(
              children: [
                Text(
                  '$verified',
                  style: const TextStyle(
                    fontFamily: 'Manrope',
                    fontWeight: FontWeight.w800,
                    fontSize: 29,
                    color: chartTeal,
                  ),
                ),
                Text(
                  ' / $total verified',
                  style: const TextStyle(
                    fontSize: 13,
                    color: Color(0xFF567770),
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
              style: const TextStyle(fontSize: 12, color: Color(0xFF567770)),
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
      Text(
        label,
        style: const TextStyle(fontSize: 11, color: Color(0xFF69758E)),
      ),
    ],
  );
}
