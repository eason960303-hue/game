import 'package:flutter/material.dart';
import 'package:life_logger/services/api_service.dart';
import 'package:life_logger/theme/app_theme.dart';
import 'package:life_logger/widgets/server_url_dialog.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  static const _minPasswordLength = 8;

  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  bool _isRegistering = false;
  bool _isSubmitting = false;
  bool _obscurePassword = true;
  String? _error;
  String? _notice;
  String? _unverifiedEmail;
  bool _googleEnabled = false;
  bool _appleEnabled = false;

  @override
  void initState() {
    super.initState();
    _loadProviders();
  }

  Future<void> _loadProviders() async {
    try {
      final providers = await ApiService.fetchAuthProviders();
      if (!mounted) return;
      setState(() {
        _googleEnabled = providers['google'] == true;
        _appleEnabled = providers['apple'] == true;
      });
    } catch (error) {
      // The email form still works without the optional provider buttons.
      debugPrint('Failed to load sign-in providers: $error');
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isSubmitting = true;
      _error = null;
      _notice = null;
      _unverifiedEmail = null;
    });
    final email = _emailController.text.trim();
    try {
      if (_isRegistering) {
        final signedIn = await ApiService.register(
          email: email,
          password: _passwordController.text,
          displayName: _nameController.text.trim(),
        );
        if (!signedIn && mounted) {
          setState(() {
            _isRegistering = false;
            _unverifiedEmail = email;
            _notice = '驗證信已寄到 $email，請開啟信中的連結後再登入。';
          });
        }
      } else {
        await ApiService.login(
          email: email,
          password: _passwordController.text,
        );
      }
    } catch (error) {
      _showFailure(error);
      if (error is ApiException && error.statusCode == 403 && mounted) {
        setState(() => _unverifiedEmail = email);
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  void _showFailure(Object error) {
    debugPrint('Failed to sign in: $error');
    if (!mounted) return;
    setState(() {
      _error = error is ApiException ? error.message : '登入失敗，請稍後再試';
    });
  }

  Future<void> _resendVerification() async {
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      await ApiService.resendVerification(_unverifiedEmail!);
      if (mounted) {
        setState(() => _notice = '如果這個帳號尚未驗證，新的驗證信已寄出，請到信箱查看。');
      }
    } catch (error) {
      _showFailure(error);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _signInWithProvider(String provider) async {
    setState(() {
      _isSubmitting = true;
      _error = null;
      _notice = null;
    });
    try {
      await ApiService.signInWithProvider(provider);
    } catch (error) {
      _showFailure(error);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  void _toggleMode() {
    setState(() {
      _isRegistering = !_isRegistering;
      _error = null;
      _notice = null;
      _unverifiedEmail = null;
    });
    // Resetting clears stale validation errors, but the email is worth keeping.
    final email = _emailController.text;
    _formKey.currentState!.reset();
    _emailController.text = email;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: AutofillGroup(
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Life Logger',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _isRegistering ? '建立帳號，開始記錄生活' : '登入後繼續你的日記與足跡',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.textMuted,
                        ),
                      ),
                      const SizedBox(height: 24),
                      if (_isRegistering) ...[
                        TextFormField(
                          controller: _nameController,
                          maxLength: 80,
                          textInputAction: TextInputAction.next,
                          autofillHints: const [AutofillHints.name],
                          decoration: const InputDecoration(
                            labelText: '顯示名稱',
                            counterText: '',
                          ),
                          validator: (value) {
                            if (value == null || value.trim().isEmpty) {
                              return '請輸入顯示名稱';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 12),
                      ],
                      TextFormField(
                        controller: _emailController,
                        keyboardType: TextInputType.emailAddress,
                        textInputAction: TextInputAction.next,
                        autocorrect: false,
                        autofillHints: const [AutofillHints.email],
                        decoration: const InputDecoration(labelText: '電子郵件'),
                        validator: (value) {
                          final email = value?.trim() ?? '';
                          if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
                              .hasMatch(email)) {
                            return '請輸入有效的電子郵件';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _passwordController,
                        obscureText: _obscurePassword,
                        textInputAction: TextInputAction.done,
                        autocorrect: false,
                        enableSuggestions: false,
                        autofillHints: [
                          _isRegistering
                              ? AutofillHints.newPassword
                              : AutofillHints.password,
                        ],
                        onFieldSubmitted: (_) {
                          if (!_isSubmitting) _submit();
                        },
                        decoration: InputDecoration(
                          labelText: '密碼',
                          helperText: _isRegistering
                              ? '至少 $_minPasswordLength 個字元'
                              : null,
                          suffixIcon: IconButton(
                            tooltip: _obscurePassword ? '顯示密碼' : '隱藏密碼',
                            icon: Icon(
                              _obscurePassword
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                            ),
                            onPressed: () => setState(
                              () => _obscurePassword = !_obscurePassword,
                            ),
                          ),
                        ),
                        validator: (value) {
                          final password = value ?? '';
                          if (password.isEmpty) return '請輸入密碼';
                          if (_isRegistering &&
                              password.length < _minPasswordLength) {
                            return '密碼至少需要 $_minPasswordLength 個字元';
                          }
                          return null;
                        },
                      ),
                      if (_notice != null) ...[
                        const SizedBox(height: 12),
                        Text(
                          _notice!,
                          style: const TextStyle(color: AppColors.textSecondary),
                        ),
                      ],
                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        Text(
                          _error!,
                          style: const TextStyle(color: AppColors.error),
                        ),
                      ],
                      if (_unverifiedEmail != null)
                        Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton(
                            onPressed: _isSubmitting ? null : _resendVerification,
                            child: const Text('重新寄送驗證信'),
                          ),
                        ),
                      const SizedBox(height: 20),
                      FilledButton(
                        onPressed: _isSubmitting ? null : _submit,
                        child: Text(
                          _isSubmitting
                              ? '處理中…'
                              : (_isRegistering ? '註冊並登入' : '登入'),
                        ),
                      ),
                      const SizedBox(height: 8),
                      TextButton(
                        onPressed: _isSubmitting ? null : _toggleMode,
                        child: Text(
                          _isRegistering ? '已經有帳號？登入' : '還沒有帳號？註冊',
                        ),
                      ),
                      if (_googleEnabled) ...[
                        const SizedBox(height: 12),
                        OutlinedButton.icon(
                          onPressed: _isSubmitting
                              ? null
                              : () => _signInWithProvider('google'),
                          icon: const Icon(Icons.g_mobiledata_rounded),
                          label: const Text('使用 Google 登入'),
                        ),
                      ],
                      if (_appleEnabled) ...[
                        const SizedBox(height: 12),
                        OutlinedButton.icon(
                          onPressed: _isSubmitting
                              ? null
                              : () => _signInWithProvider('apple'),
                          icon: const Icon(Icons.apple_rounded),
                          label: const Text('使用 Apple 登入'),
                        ),
                      ],
                      const SizedBox(height: 12),
                      TextButton(
                        onPressed: _isSubmitting
                            ? null
                            : () async {
                                if (await showServerUrlDialog(context)) {
                                  _loadProviders();
                                }
                              },
                        child: const Text('伺服器位址'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
