import 'package:flutter/material.dart';
import 'package:life_logger/services/api_service.dart';

/// Asks which server to use. Returns true when the address changed.
Future<bool> showServerUrlDialog(BuildContext context) async {
  final changed = await showDialog<bool>(
    context: context,
    builder: (_) => const _ServerUrlDialog(),
  );
  return changed ?? false;
}

class _ServerUrlDialog extends StatefulWidget {
  const _ServerUrlDialog();

  @override
  State<_ServerUrlDialog> createState() => _ServerUrlDialogState();
}

class _ServerUrlDialogState extends State<_ServerUrlDialog> {
  late final TextEditingController _controller;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: ApiService.savedServerUrl);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final input = _controller.text.trim();
    final url = input.isEmpty ? null : ApiService.normalizeServerUrl(input);
    if (input.isNotEmpty && url == null) {
      setState(() => _error = '這看起來不是有效的網址');
      return;
    }
    final changed = url != (ApiService.savedServerUrl.isEmpty ? null : ApiService.savedServerUrl);
    if (changed) await ApiService.setServerUrl(url);
    if (mounted) Navigator.of(context).pop(changed);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('伺服器位址'),
      content: TextField(
        controller: _controller,
        autofocus: true,
        autocorrect: false,
        keyboardType: TextInputType.url,
        decoration: InputDecoration(
          hintText: 'https://xxx.trycloudflare.com',
          helperText: '留空會使用預設位址。更改後需要重新登入。',
          helperMaxLines: 2,
          errorText: _error,
        ),
        onSubmitted: (_) => _save(),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        FilledButton(onPressed: _save, child: const Text('儲存')),
      ],
    );
  }
}
