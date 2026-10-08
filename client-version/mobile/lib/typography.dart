import 'package:flutter/material.dart';
import 'experience.dart';

/// Shared app/demo type roles. Keep reading text calm and headings distinctive.
abstract final class RelayTypography {
  static const title = TextStyle(
    fontFamily: 'Manrope',
    fontSize: 20,
    fontWeight: FontWeight.w700,
    height: 1.2,
    letterSpacing: -.3,
    color: RelayPalette.ink,
  );
  static const section = TextStyle(
    fontFamily: 'Manrope',
    fontSize: 17,
    fontWeight: FontWeight.w700,
    height: 1.25,
    letterSpacing: -.15,
    color: RelayPalette.ink,
  );
  static const body = TextStyle(
    fontFamily: 'DM Sans',
    fontSize: 14,
    fontWeight: FontWeight.w400,
    height: 1.4,
    letterSpacing: 0,
    color: RelayPalette.ink,
  );
  static const bodyStrong = TextStyle(
    fontFamily: 'DM Sans',
    fontSize: 14,
    fontWeight: FontWeight.w600,
    height: 1.4,
    letterSpacing: 0,
    color: RelayPalette.ink,
  );
  static const label = TextStyle(
    fontFamily: 'DM Sans',
    fontSize: 13,
    fontWeight: FontWeight.w500,
    height: 1.25,
    letterSpacing: 0,
    color: Color(0xFF526079),
  );
  static const caption = TextStyle(
    fontFamily: 'DM Sans',
    fontSize: 12,
    fontWeight: FontWeight.w500,
    height: 1.35,
    letterSpacing: 0,
    color: Color(0xFF526079),
  );
  static const numeric = TextStyle(
    fontFamily: 'Manrope',
    fontSize: 14,
    fontWeight: FontWeight.w600,
    height: 1.35,
    letterSpacing: 0,
    color: RelayPalette.ink,
    fontFeatures: [FontFeature.tabularFigures()],
  );
  static final textTheme = TextTheme(
    displayLarge: title.copyWith(fontSize: 36, height: 1.1),
    displayMedium: title.copyWith(fontSize: 32, height: 1.1),
    displaySmall: title.copyWith(fontSize: 28, height: 1.15),
    headlineLarge: title.copyWith(fontSize: 26),
    headlineMedium: title.copyWith(fontSize: 24),
    headlineSmall: title.copyWith(fontSize: 22),
    titleLarge: title,
    titleMedium: section.copyWith(fontSize: 16),
    titleSmall: section.copyWith(fontSize: 14),
    bodyLarge: body.copyWith(fontSize: 15),
    bodyMedium: body,
    bodySmall: caption.copyWith(fontSize: 12.5),
    labelLarge: bodyStrong.copyWith(height: 1.25),
    labelMedium: label.copyWith(fontWeight: FontWeight.w600),
    labelSmall: caption,
  );
}

/// Paired controls stay compact at normal phone sizes, then stack for large text.
class RelayPair extends StatelessWidget {
  const RelayPair({
    super.key,
    required this.first,
    required this.second,
    this.minimumWidth = 280,
    this.gap = 8,
    this.rowGap = 10,
  });
  final Widget first, second;
  final double minimumWidth, gap, rowGap;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, size) {
      final scale = MediaQuery.textScalerOf(context).scale(14) / 14;
      if (size.maxWidth / scale < minimumWidth) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            first,
            SizedBox(height: rowGap),
            second,
          ],
        );
      }
      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: first),
          SizedBox(width: gap),
          Expanded(child: second),
        ],
      );
    },
  );
}

class RelayStepPills extends StatelessWidget {
  const RelayStepPills({super.key, required this.step});
  final int step;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, size) {
      final scale = MediaQuery.textScalerOf(context).scale(12) / 12;
      final stacked = size.maxWidth / scale < 210;
      Widget pill(int i) => Semantics(
        selected: i == step,
        child: AnimatedContainer(
          duration: motionDuration(context),
          alignment: Alignment.center,
          padding: EdgeInsets.symmetric(
            horizontal: 6,
            vertical: stacked ? 8 : 11,
          ),
          decoration: BoxDecoration(
            gradient: i == step ? RelayPalette.hero : null,
            color: i == step
                ? null
                : const [
                    Color(0xffece2ff),
                    Color(0xffe0efff),
                    Color(0xffd9f5eb),
                  ][i],
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(
            '${i + 1}. ${const ['Customer', 'Order & plan', 'Submit sale'][i]}',
            textAlign: TextAlign.center,
            style: RelayTypography.caption.copyWith(
              fontWeight: FontWeight.w600,
              color: i == step ? Colors.white : const Color(0xff583186),
            ),
          ),
        ),
      );
      if (stacked) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < 3; i++) ...[
              if (i > 0) const SizedBox(height: 6),
              pill(i),
            ],
          ],
        );
      }
      return IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < 3; i++) ...[
              if (i > 0) const SizedBox(width: 6),
              Expanded(flex: const [11, 14, 11][i], child: pill(i)),
            ],
          ],
        ),
      );
    },
  );
}
