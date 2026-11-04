import 'package:flutter/material.dart';
import 'package:life_logger/models/user_profile.dart';
import 'package:life_logger/screens/home_screen.dart';
import 'package:life_logger/screens/login_screen.dart';
import 'package:life_logger/services/api_service.dart';
import 'package:life_logger/theme/app_theme.dart';
import 'package:life_logger/widgets/server_url_dialog.dart';

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
      theme: AppTheme.dark,
      home: const AuthGate(),
    );
  }
}

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  bool _isRestoring = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    setState(() {
      _isRestoring = true;
      _error = null;
    });
    String? error;
    try {
      await ApiService.restoreSession();
    } catch (exception) {
      debugPrint('Failed to restore session: $exception');
      error = exception is ApiException ? exception.message : '無法確認登入狀態，請稍後再試';
    }
    if (!mounted) return;
    setState(() {
      _isRestoring = false;
      _error = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_isRestoring) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_error != null) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _error!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.textSecondary),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _restoreSession,
                  child: const Text('重試'),
                ),
                const SizedBox(height: 8),
                // A saved address can go stale, and this screen is the only way out.
                TextButton(
                  onPressed: () async {
                    if (await showServerUrlDialog(context)) _restoreSession();
                  },
                  child: const Text('更改伺服器位址'),
                ),
              ],
            ),
          ),
        ),
      );
    }
    return ValueListenableBuilder<AppUser?>(
      valueListenable: ApiService.currentUser,
      builder: (context, user, _) {
        if (user == null) return const LoginScreen();
        return HomeScreen(key: ValueKey(user.id));
      },
    );
  }
}
