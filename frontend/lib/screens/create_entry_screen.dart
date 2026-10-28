import 'package:flutter/material.dart';
import 'package:life_logger/services/api_service.dart';

class CreateEntryScreen extends StatefulWidget {
  const CreateEntryScreen({super.key});

  @override
  State<CreateEntryScreen> createState() => _CreateEntryScreenState();
}

class _CreateEntryScreenState extends State<CreateEntryScreen> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _contentController = TextEditingController();
  final _locationController = TextEditingController();
  final _tagsController = TextEditingController();

  String _mood = '開心';
  String _privacy = 'private';
  bool _isSaving = false;

  @override
  void dispose() {
    _titleController.dispose();
    _contentController.dispose();
    _locationController.dispose();
    _tagsController.dispose();
    super.dispose();
  }

  Future<void> _saveEntry() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSaving = true);
    try {
      await ApiService.createEntry({
        'title': _titleController.text.trim(),
        'content': _contentController.text.trim(),
        'mood': _mood,
        'location': _locationController.text.trim().isEmpty
            ? null
            : _locationController.text.trim(),
        'privacy': _privacy,
        'tags': _tagsController.text
            .split(',')
            .map((tag) => tag.trim())
            .where((tag) => tag.isNotEmpty)
            .join(','),
      });

      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('日記儲存失敗：$error'),
          backgroundColor: const Color(0xFF9D3D52),
        ),
      );
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF071B2E),
      appBar: AppBar(
        title: const Text('寫一篇日記'),
        actions: [
          TextButton(
            onPressed: _isSaving ? null : _saveEntry,
            child: _isSaving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Color(0xFF7FC7FF),
                    ),
                  )
                : const Text(
                    '儲存',
                    style: TextStyle(
                      color: Color(0xFF9AD0FF),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
          children: [
            _sectionLabel('今天的標題'),
            const SizedBox(height: 8),
            TextFormField(
              controller: _titleController,
              maxLength: 200,
              textCapitalization: TextCapitalization.sentences,
              style: const TextStyle(color: Colors.white, fontSize: 18),
              decoration: _inputDecoration('為今天留下一個名字'),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return '請輸入日記標題';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),
            _sectionLabel('記錄此刻'),
            const SizedBox(height: 8),
            TextFormField(
              controller: _contentController,
              minLines: 7,
              maxLines: 12,
              textCapitalization: TextCapitalization.sentences,
              style: const TextStyle(color: Colors.white, height: 1.6),
              decoration: _inputDecoration('今天發生了什麼？寫下你的心情與故事…'),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return '寫幾句今天的故事吧';
                }
                return null;
              },
            ),
            const SizedBox(height: 20),
            _sectionLabel('今天的心情'),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: ['開心', '平靜', '感動', '疲憊', '難過'].map((mood) {
                final selected = _mood == mood;
                return ChoiceChip(
                  label: Text(mood),
                  selected: selected,
                  onSelected: (_) => setState(() => _mood = mood),
                  selectedColor: const Color(0xFF28618B),
                  backgroundColor: const Color(0xFF11263F),
                  labelStyle: TextStyle(
                    color: selected ? Colors.white : const Color(0xFFB8D5F2),
                  ),
                  side: BorderSide(
                    color: selected
                        ? const Color(0xFF7FC7FF)
                        : Colors.white.withOpacity(0.08),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 20),
            _sectionLabel('地點（選填）'),
            const SizedBox(height: 8),
            TextFormField(
              controller: _locationController,
              textInputAction: TextInputAction.next,
              style: const TextStyle(color: Colors.white),
              decoration: _inputDecoration('例如：高雄港邊').copyWith(
                prefixIcon: const Icon(
                  Icons.location_on_outlined,
                  color: Color(0xFF8FD9FF),
                ),
              ),
            ),
            const SizedBox(height: 16),
            _sectionLabel('標籤（選填，以逗號分隔）'),
            const SizedBox(height: 8),
            TextFormField(
              controller: _tagsController,
              textInputAction: TextInputAction.done,
              style: const TextStyle(color: Colors.white),
              decoration: _inputDecoration('例如：星空,散步,朋友'),
            ),
            const SizedBox(height: 20),
            _sectionLabel('日記隱私'),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              value: _privacy,
              dropdownColor: const Color(0xFF11263F),
              style: const TextStyle(color: Colors.white),
              decoration: _inputDecoration(''),
              items: const [
                DropdownMenuItem(
                  value: 'private',
                  child: Text('僅自己可見'),
                ),
                DropdownMenuItem(
                  value: 'shared',
                  child: Text('分享'),
                ),
              ],
              onChanged: (value) {
                if (value != null) setState(() => _privacy = value);
              },
            ),
            const SizedBox(height: 28),
            SizedBox(
              height: 54,
              child: FilledButton.icon(
                onPressed: _isSaving ? null : _saveEntry,
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF3B91D0),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(18),
                  ),
                ),
                icon: const Icon(Icons.bookmark_add_outlined),
                label: Text(_isSaving ? '儲存中…' : '儲存日記'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _sectionLabel(String label) {
    return Text(
      label,
      style: const TextStyle(
        color: Color(0xFFB8D5F2),
        fontWeight: FontWeight.w600,
      ),
    );
  }

  InputDecoration _inputDecoration(String hint) {
    return InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(color: Colors.white38),
      filled: true,
      fillColor: const Color(0xFF11263F),
      counterStyle: const TextStyle(color: Colors.white38),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: BorderSide(color: Colors.white.withOpacity(0.06)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: const BorderSide(color: Color(0xFF7FC7FF)),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: const BorderSide(color: Color(0xFFE57373)),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: const BorderSide(color: Color(0xFFE57373)),
      ),
    );
  }
}
