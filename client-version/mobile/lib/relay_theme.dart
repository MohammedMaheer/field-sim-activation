import 'package:flutter/material.dart';
import 'experience.dart';
import 'typography.dart';

abstract final class RelayCaptureStyles {
  static const _text = TextStyle(
    fontFamily: 'DM Sans',
    fontSize: 14,
    fontWeight: FontWeight.w600,
    height: 1.2,
    letterSpacing: 0,
  );
  static final scan = FilledButton.styleFrom(
    backgroundColor: RelayPalette.brand,
    foregroundColor: Colors.white,
    disabledBackgroundColor: const Color(0xFFF0D7E3),
    disabledForegroundColor: const Color(0xFF74475E),
    minimumSize: const Size(0, 48),
    textStyle: _text,
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
  );
  static final upload = OutlinedButton.styleFrom(
    backgroundColor: const Color(0xFFFFE6F0),
    foregroundColor: const Color(0xFF95234F),
    disabledBackgroundColor: const Color(0xFFF6EAF0),
    disabledForegroundColor: const Color(0xFF74475E),
    side: const BorderSide(color: Color(0xFFCC6391), width: 1.2),
    minimumSize: const Size(0, 48),
    textStyle: _text,
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
  );
}

ThemeData relayTheme() => ThemeData(
  useMaterial3: true,
  fontFamily: 'DM Sans',
  textTheme: RelayTypography.textTheme,
  pageTransitionsTheme: const PageTransitionsTheme(
    builders: {
      TargetPlatform.android: RelayPageTransitions(),
      TargetPlatform.iOS: RelayPageTransitions(),
      TargetPlatform.windows: RelayPageTransitions(),
      TargetPlatform.macOS: RelayPageTransitions(),
      TargetPlatform.linux: RelayPageTransitions(),
    },
  ),
  colorScheme: ColorScheme.fromSeed(
    seedColor: RelayPalette.brand,
    primary: RelayPalette.brand,
    surface: Colors.white,
  ),
  scaffoldBackgroundColor: RelayPalette.canvas,
  appBarTheme: const AppBarTheme(
    backgroundColor: Color(0xFFF6EEF6),
    surfaceTintColor: Colors.transparent,
    titleTextStyle: RelayTypography.title,
    foregroundColor: RelayPalette.ink,
    centerTitle: false,
  ),
  navigationBarTheme: NavigationBarThemeData(
    indicatorColor: const Color(0xFFE8D8FF),
    labelTextStyle: WidgetStateProperty.resolveWith(
      (states) => RelayTypography.caption.copyWith(
        fontWeight: states.contains(WidgetState.selected)
            ? FontWeight.w700
            : FontWeight.w500,
        color: states.contains(WidgetState.selected)
            ? const Color(0xFF642BA6)
            : const Color(0xFF526079),
      ),
    ),
  ),
  snackBarTheme: SnackBarThemeData(
    behavior: SnackBarBehavior.floating,
    backgroundColor: const Color(0xFF293B58),
    contentTextStyle: RelayTypography.body.copyWith(color: Colors.white),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
  ),
  cardTheme: CardThemeData(
    elevation: 0,
    color: Colors.white,
    margin: EdgeInsets.zero,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(16),
      side: const BorderSide(color: Color(0xFFDCDDEC)),
    ),
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: Colors.white,
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
    hintStyle: RelayTypography.body.copyWith(color: const Color(0xFF67758C)),
    labelStyle: RelayTypography.label,
    floatingLabelStyle: RelayTypography.label.copyWith(
      color: RelayPalette.brand,
    ),
    helperStyle: RelayTypography.caption,
    errorStyle: RelayTypography.caption.copyWith(
      color: const Color(0xFFAF2940),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: const BorderSide(color: Color(0xFFD6DEEF)),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: const BorderSide(color: RelayPalette.brand, width: 1.6),
    ),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: const BorderSide(color: Color(0xFFE2E5EB)),
    ),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      minimumSize: const Size(0, 48),
      textStyle: RelayTypography.bodyStrong.copyWith(height: 1.2),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    ),
  ),
  outlinedButtonTheme: OutlinedButtonThemeData(
    style: OutlinedButton.styleFrom(
      minimumSize: const Size(0, 48),
      foregroundColor: RelayPalette.brand,
      textStyle: RelayTypography.bodyStrong.copyWith(height: 1.2),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      side: const BorderSide(color: Color(0xFFD8C5CE)),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(11)),
    ),
  ),
  textButtonTheme: TextButtonThemeData(
    style: TextButton.styleFrom(
      textStyle: RelayTypography.bodyStrong.copyWith(height: 1.2),
      minimumSize: const Size(0, 48),
    ),
  ),
  chipTheme: ChipThemeData(
    labelStyle: RelayTypography.label.copyWith(
      color: RelayPalette.ink,
      fontWeight: FontWeight.w600,
    ),
  ),
  listTileTheme: ListTileThemeData(
    titleTextStyle: RelayTypography.bodyStrong,
    subtitleTextStyle: RelayTypography.label.copyWith(height: 1.4),
    minVerticalPadding: 8,
  ),
  dialogTheme: DialogThemeData(
    titleTextStyle: RelayTypography.section.copyWith(fontSize: 18),
    contentTextStyle: RelayTypography.body,
  ),
  expansionTileTheme: ExpansionTileThemeData(
    tilePadding: EdgeInsets.zero,
    childrenPadding: const EdgeInsets.only(top: 8, bottom: 4),
  ),
);
