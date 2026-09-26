import 'package:flutter/material.dart';

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
    const titles = ['Capture transaction', 'Review details', 'Submit & track'];
    final messages = [
      'Take or upload the completed transaction screenshot. OCR extracts its details on the server.',
      status == 'REJECTED'
          ? 'Review the backend feedback, correct the details and validate before resubmitting.'
          : 'Check the extracted details against the original screenshot, make corrections and validate the rows.',
      status == 'VERIFIED'
          ? 'Backend verification is complete. The result is synchronized with your transaction history.'
          : 'The original screenshot and validated rows are submitted. Track the backend team’s verification here.',
    ];
    return Card(
      color: const Color(0xFFF1E8FF),
      child: Padding(
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
                    child: Container(
                      margin: EdgeInsets.only(right: i < 2 ? 6 : 0),
                      height: 5,
                      decoration: BoxDecoration(
                        color: i <= step
                            ? const Color(0xFF7541BF)
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
                'Before capture: complete identity, customer, plan and order details in Etisalat.',
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
