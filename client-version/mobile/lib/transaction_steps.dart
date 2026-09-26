import 'package:flutter/material.dart';

/// The reference has three stages; actions within a stage are not extra steps.
class TransactionSteps extends StatelessWidget {
  final int step;
  const TransactionSteps({super.key, required this.step})
    : assert(step >= 1 && step <= 3);

  static const titles = [
    'Identity & eKYC',
    'SIM & Plan Allocation',
    'Activation & Receipt',
  ];
  static const icons = [
    Icons.badge_outlined,
    Icons.sim_card_outlined,
    Icons.receipt_long_outlined,
  ];

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      if (constraints.maxWidth / MediaQuery.textScalerOf(context).scale(1) <
          250) {
        return Column(
          children: List.generate(3, (i) {
            final active = step == i + 1;
            final completed = step > i + 1;
            return Semantics(
              selected: active,
              label: 'Step ${i + 1} of 3${completed ? ", completed" : ""}',
              child: Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: active ? const Color(0xFF713BB6) : Colors.white,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: [
                    Icon(
                      completed ? Icons.check_circle_outline : icons[i],
                      color: active ? Colors.white : const Color(0xFF087461),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        '${i + 1}. ${titles[i]}',
                        style: TextStyle(
                          color: active
                              ? Colors.white
                              : const Color(0xFF51356F),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          }),
        );
      }
      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: List.generate(3, (i) {
          final current = step == i + 1;
          final complete = step > i + 1;
          final color = current
              ? Colors.white
              : complete
              ? const Color(0xFF087461)
              : const Color(0xFF62418A);
          return Expanded(
            child: Semantics(
              label:
                  'Step ${i + 1} of 3: ${titles[i]}${complete ? ", completed" : ""}',
              selected: current,
              child: ExcludeSemantics(
                child: Padding(
                  padding: EdgeInsets.only(right: i < 2 ? 6 : 0),
                  child: Column(
                    children: [
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        decoration: BoxDecoration(
                          color: current
                              ? const Color(0xFF713BB6)
                              : complete
                              ? const Color(0xFFD9F2E6)
                              : Colors.white,
                          border: Border.all(color: const Color(0xFFC9BCDB)),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(
                          complete ? Icons.check_circle_outline : icons[i],
                          color: color,
                          size: 24,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        '${i + 1}. ${titles[i]}',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 12,
                          height: 1.35,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF51356F),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        }),
      );
    },
  );
}
