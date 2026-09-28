import 'package:flutter/material.dart';
import 'experience.dart';

int captureStage(String? status) => 2;

class KycJourneyGuide extends StatelessWidget {
  final String? status;
  const KycJourneyGuide({super.key, this.status});
  @override
  Widget build(BuildContext context) {
    final step = captureStage(status);
    const titles = ['Identity', 'SIM & plan', 'Receipt'];
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Container(
        decoration: const BoxDecoration(gradient: RelayPalette.soft),
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'YOUR TRANSACTION · STEP ${step + 1} OF 3',
              style: const TextStyle(
                fontWeight: FontWeight.w800,
                color: Color(0xFF6940A3),
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: List.generate(
                3,
                (i) => Expanded(
                  child: Semantics(
                    label: titles[i],
                    selected: i == step,
                    child: AnimatedContainer(
                      duration: motionDuration(context),
                      curve: Curves.easeOutCubic,
                      margin: EdgeInsets.only(right: i < 2 ? 6 : 0),
                      height: 5,
                      decoration: BoxDecoration(
                        color: i <= step
                            ? RelayPalette.plum
                            : const Color(0xFFDED6EB),
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              titles[step],
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: Color(0xFF512479),
              ),
            ),
            const SizedBox(height: 8),

          ],
        ),
      ),
    );
  }
}
