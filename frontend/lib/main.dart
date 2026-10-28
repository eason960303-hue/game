import 'package:flutter/material.dart';
import 'package:life_logger/screens/home_screen.dart';

void main() {
  runApp(const LifeLoggerApp());
}

class LifeLoggerApp extends StatelessWidget {
  const LifeLoggerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Life Logger',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF071B2E),
        primarySwatch: Colors.blue,
        fontFamily: 'SF Pro Display',
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.transparent,
          elevation: 0,
          foregroundColor: Colors.white,
        ),
      ),
      home: const HomeScreen(),
    );
  }
}
