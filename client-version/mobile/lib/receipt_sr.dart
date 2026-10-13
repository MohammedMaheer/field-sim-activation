import 'services.dart';
import 'package:flutter/material.dart';
import 'typography.dart';

/// Only an explicitly labelled SR returned with an image-bound backend check
/// can replace the order's SR. A request ID is never a substitute.
Json receiptSrFields(Json response, {String fallbackSr = ''}) {
  final fields = response['fields'];
  final sr = fields is Map ? (fields['sr_number'] ?? '').toString().trim() : '';
  final proof = (response['sr_check'] ?? '').toString().trim();
  return sr.isNotEmpty &&
          proof.isNotEmpty &&
          !receiptSrConflict(response, fallbackSr)
      ? {'sr_number': sr, 'receipt_sr_check': proof}
      : {'sr_number': fallbackSr, 'receipt_sr_check': ''};
}

bool receiptSrConflict(Json response, String orderSr) {
  final fields = response['fields'];
  final receipt = fields is Map
      ? (fields['sr_number'] ?? '').toString().trim()
      : '';
  String normalized(String value) =>
      value.replaceAll(RegExp(r'[^\w]'), '').toLowerCase();
  return orderSr.trim().isNotEmpty &&
      receipt.isNotEmpty &&
      normalized(orderSr) != normalized(receipt);
}

/// Captured SRs are displayed as evidence, rather than as an editable field.
class SrNumberSummary extends StatelessWidget {
  final String value;
  final String message;
  final bool reading;
  final bool warning;
  final VoidCallback? onRetry;
  const SrNumberSummary({
    super.key,
    required this.value,
    required this.message,
    this.reading = false,
    this.warning = false,
    this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    final hasValue = value.trim().isNotEmpty;
    final color = reading
        ? const Color(0xff176db6)
        : warning
        ? const Color(0xff9b6310)
        : hasValue
        ? const Color(0xff008568)
        : const Color(0xff626a7c);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: warning
            ? const Color(0xfffff7e8)
            : reading || hasValue
            ? const Color(0xffedf9f6)
            : const Color(0xfff7f8fc),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: .25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: reading
                ? SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: color,
                    ),
                  )
                : Icon(
                    warning
                        ? Icons.warning_amber_rounded
                        : Icons.document_scanner_outlined,
                    size: 20,
                    color: color,
                  ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('SR number', style: RelayTypography.label),
                const SizedBox(height: 3),
                Text(
                  reading
                      ? 'Reading…'
                      : hasValue
                      ? value
                      : 'Not recorded',
                  style: RelayTypography.bodyStrong.copyWith(color: color),
                ),
                const SizedBox(height: 3),
                Text(message, style: RelayTypography.caption),
                if (onRetry != null) ...[
                  const SizedBox(height: 4),
                  TextButton.icon(
                    onPressed: onRetry,
                    style: TextButton.styleFrom(
                      foregroundColor: color,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      minimumSize: const Size(0, 44),
                      visualDensity: VisualDensity.compact,
                    ),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Read SR again'),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
