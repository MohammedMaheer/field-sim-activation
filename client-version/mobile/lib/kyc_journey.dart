import 'package:flutter/material.dart';
import 'experience.dart';

int captureStage(String? status) {
  if (['EXTRACTED', 'VALIDATED', 'REJECTED'].contains(status)) return 1;
  if (['SUBMITTED', 'VERIFIED'].contains(status)) return 2;
  return 0;
}

class KycJourneyGuide extends StatelessWidget {
  final String? status;
  const KycJourneyGuide({super.key, this.status});
  @override
  Widget build(BuildContext context) {
    final step = captureStage(status);
    const titles = ['Upload receipt', 'Review details', 'Submit & track'];
    final messages = [
      'Photograph or upload the Etisalat activation receipt. OCR extracts its details on the VPS.',
      status == 'REJECTED'
          ? 'Review the backend feedback, correct the details and validate before resubmitting.'
          : 'Check the extracted details against the original receipt, make corrections and validate the rows.',
      status == 'VERIFIED'
          ? 'Backend verification is complete. The result is synchronized with your transaction history.'
          : 'The original receipt and validated rows are submitted. Track the backend team’s verification here.',
    ];
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
            Text(messages[step], style: const TextStyle(height: 1.5)),
            if (status == null) ...[
              const SizedBox(height: 10),
              const Text(
                'Activation happens in Etisalat. Relay records the receipt and tracks backend review; it does not activate a SIM.',
                style: TextStyle(
                  fontSize: 13,
                  height: 1.5,
                  color: Color(0xFF59677C),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
