import 'package:flutter/material.dart';

const journeyStages = [
  [
    'Emirates ID & OCR',
    'Complete identity verification in Etisalat. Enter or scan the Emirates ID and review its extracted identity fields and required checks.',
  ],
  [
    'Customer information',
    'Complete customer information in Etisalat and check that it matches the identity document.',
  ],
  [
    'Plan information',
    'Confirm the chosen plan, SIM or eSIM, mobile number and applicable terms in the source system.',
  ],
  [
    'Order & customer details',
    'Complete the order, remaining customer information and required consent in Etisalat. Keep the transaction or receipt screen ready.',
  ],
  [
    'Capture, OCR & handoff',
    'Capture or upload the completed screen below. Review the extracted rows, validate them and send the image and Excel data for backend review.',
  ],
  [
    'Verification & live status',
    'The backend team checks the original image and rows. Open capture history to follow the synchronized decision.',
  ],
];

class KycJourneyGuide extends StatefulWidget {
  final VoidCallback onCapture;
  final VoidCallback? onHistory;
  const KycJourneyGuide({super.key, required this.onCapture, this.onHistory});
  @override
  State<KycJourneyGuide> createState() => _JourneyState();
}

class _JourneyState extends State<KycJourneyGuide> {
  int step = 0;
  @override
  Widget build(BuildContext context) => Card(
    color: const Color(0xFFF3EDFC),
    child: Padding(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'YOUR VERIFICATION JOURNEY',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.1,
              color: Color(0xFF8352B9),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: List.generate(
              6,
              (i) => Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(right: 5),
                  child: Semantics(
                    label: 'Stage ${i + 1}: ${journeyStages[i][0]}',
                    child: InkWell(
                      onTap: () => setState(() => step = i),
                      borderRadius: BorderRadius.circular(9),
                      child: Container(
                        height: 42,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: i == step
                              ? const Color(0xFF8050BD)
                              : Colors.white,
                          borderRadius: BorderRadius.circular(9),
                        ),
                        child: Text(
                          '${i + 1}',
                          style: TextStyle(
                            color: i == step
                                ? Colors.white
                                : const Color(0xFF9472B5),
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 17),
          Text(
            journeyStages[step][0],
            style: const TextStyle(
              fontFamily: 'Manrope',
              fontSize: 19,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 7),
          Text(
            step < 4
                ? 'Complete in Etisalat · ${step + 1} of 6'
                : 'Continue in Relay · ${step + 1} of 6',
            style: const TextStyle(
              color: Color(0xFF8050BD),
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 9),
          Text(
            journeyStages[step][1],
            style: const TextStyle(
              fontSize: 13,
              height: 1.5,
              color: Color(0xFF62718A),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              if (step > 0) ...[
                IconButton(
                  tooltip: 'Previous stage',
                  onPressed: () => setState(() => step--),
                  icon: const Icon(Icons.arrow_back),
                ),
                const SizedBox(width: 8),
              ],
              Expanded(
                child: FilledButton.icon(
                  onPressed: step < 4
                      ? () => setState(() => step++)
                      : step == 5
                      ? (widget.onHistory ?? widget.onCapture)
                      : widget.onCapture,
                  icon: Icon(
                    step < 4
                        ? Icons.arrow_forward
                        : Icons.document_scanner_outlined,
                  ),
                  label: Text(
                    step < 4
                        ? 'Next stage'
                        : step == 5
                        ? 'View history'
                        : 'Go to capture',
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    ),
  );
}
