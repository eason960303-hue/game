import 'package:flutter/material.dart';

class AppColors {
  const AppColors._();

  static const background = Color(0xFF131613);
  static const card = Color(0xFF1C201C);
  static const field = Color(0xFF232823);
  static const outline = Color(0x14FFFFFF);

  static const primary = Color(0xFF24795F);
  static const accent = Color(0xFF74C9AB);
  static const accentSoft = Color(0xFF8ED6BC);
  static const accentStrong = Color(0xFF4FAE8D);
  static const selected = Color(0xFF2B5E4D);

  static const textSecondary = Color(0xFFC0C1B6);
  static const textMuted = Color(0xFF9A9C90);
  static const textBody = Color(0xD9ECEAE1);

  static const error = Color(0xFFF0978E);
  static const errorSurface = Color(0xFF8A3B33);

  static const actionGradient = LinearGradient(
    colors: [accent, accentStrong],
  );
  static const heroGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF1C201C), Color(0xFF1F362D), Color(0xFF24503F)],
  );
  static const mapGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF171A17), Color(0xFF1F362D), Color(0xFF1C2C26)],
  );
}

class AppTheme {
  const AppTheme._();

  static const _fontFamily = 'PingFang TC';
  static const _fieldRadius = BorderRadius.all(Radius.circular(14));

  static const cardDecoration = BoxDecoration(
    color: AppColors.card,
    borderRadius: BorderRadius.all(Radius.circular(20)),
    border: Border.fromBorderSide(BorderSide(color: AppColors.outline)),
  );

  static OutlineInputBorder _fieldBorder(Color color) {
    return OutlineInputBorder(
      borderRadius: _fieldRadius,
      borderSide: BorderSide(color: color),
    );
  }

  static ThemeData get dark {
    return ThemeData(
      colorScheme: const ColorScheme.dark(
        primary: AppColors.accent,
        onPrimary: AppColors.background,
        secondary: AppColors.accent,
        onSecondary: AppColors.background,
        surface: AppColors.card,
        onSurface: Colors.white,
        error: AppColors.error,
        onError: AppColors.background,
      ),
      scaffoldBackgroundColor: AppColors.background,
      fontFamily: _fontFamily,
      textTheme: const TextTheme(
        headlineMedium: TextStyle(
          color: Colors.white,
          fontSize: 28,
          fontWeight: FontWeight.w700,
        ),
        titleLarge: TextStyle(
          color: Colors.white,
          fontSize: 22,
          fontWeight: FontWeight.w700,
        ),
        titleSmall: TextStyle(
          color: AppColors.textSecondary,
          fontSize: 14,
          fontWeight: FontWeight.w600,
        ),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        foregroundColor: Colors.white,
        titleTextStyle: TextStyle(
          fontFamily: _fontFamily,
          color: Colors.white,
          fontSize: 18,
          fontWeight: FontWeight.w600,
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: Colors.transparent,
        elevation: 0,
        type: BottomNavigationBarType.fixed,
        selectedItemColor: AppColors.accent,
        unselectedItemColor: AppColors.textSecondary,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.field,
        hintStyle: const TextStyle(color: AppColors.textMuted),
        helperStyle: const TextStyle(color: AppColors.textMuted),
        counterStyle: const TextStyle(color: AppColors.textMuted),
        prefixIconColor: AppColors.accent,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 14,
        ),
        border: _fieldBorder(AppColors.outline),
        enabledBorder: _fieldBorder(AppColors.outline),
        focusedBorder: _fieldBorder(AppColors.accent),
        errorBorder: _fieldBorder(AppColors.error),
        focusedErrorBorder: _fieldBorder(AppColors.error),
      ),
      chipTheme: const ChipThemeData(
        backgroundColor: AppColors.field,
        selectedColor: AppColors.selected,
        showCheckmark: false,
        shape: StadiumBorder(),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: SegmentedButton.styleFrom(
          backgroundColor: AppColors.field,
          foregroundColor: AppColors.textSecondary,
          selectedBackgroundColor: AppColors.selected,
          selectedForegroundColor: Colors.white,
          side: const BorderSide(color: AppColors.outline),
          shape: const RoundedRectangleBorder(borderRadius: _fieldRadius),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AppColors.selected,
          disabledForegroundColor: AppColors.textSecondary,
          minimumSize: const Size(0, 54),
          textStyle: const TextStyle(
            fontFamily: _fontFamily,
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(18)),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.textSecondary,
          minimumSize: const Size(0, 54),
          textStyle: const TextStyle(
            fontFamily: _fontFamily,
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
          side: const BorderSide(color: AppColors.outline),
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(18)),
          ),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        contentTextStyle: TextStyle(color: Colors.white),
      ),
    );
  }
}
