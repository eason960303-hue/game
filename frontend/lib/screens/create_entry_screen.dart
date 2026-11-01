import 'package:flutter/material.dart';
import 'package:life_logger/services/api_service.dart';
import 'package:life_logger/theme/app_theme.dart';
import 'package:life_logger/widgets/form_section.dart';
import 'package:life_logger/widgets/privacy_selector.dart';

const _moods = [
  (label: '開心', icon: Icons.sentiment_very_satisfied_rounded),
  (label: '平靜', icon: Icons.spa_outlined),
  (label: '感動', icon: Icons.favorite_border_rounded),
  (label: '疲憊', icon: Icons.bedtime_outlined),
  (label: '難過', icon: Icons.sentiment_dissatisfied_rounded),
];

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

  String _mood = _moods.first.label;
  String _privacy = defaultPrivacy;
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
      final location = _locationController.text.trim();
      await ApiService.createEntry({
        'title': _titleController.text.trim(),
        'content': _contentController.text.trim(),
        'mood': _mood,
        'location': location.isEmpty ? null : location,
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
          backgroundColor: AppColors.errorSurface,
        ),
      );
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('寫一篇日記')),
      body: SafeArea(
        top: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: ListView(
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
                      children: [
                        _buildStorySection(),
                        const SizedBox(height: 16),
                        _buildMoodSection(),
                        const SizedBox(height: 16),
                        _buildDetailsSection(),
                        const SizedBox(height: 16),
                        PrivacySelector(
                          value: _privacy,
                          onChanged: (value) =>
                              setState(() => _privacy = value),
                        ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                    child: FilledButton.icon(
                      onPressed: _isSaving ? null : _saveEntry,
                      icon: _isSaving
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: AppColors.textSecondary,
                              ),
                            )
                          : const Icon(Icons.bookmark_add_outlined),
                      label: Text(_isSaving ? '儲存中…' : '儲存日記'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStorySection() {
    return SectionCard(
      children: [
        LabeledField(
          label: '今天的標題',
          child: TextFormField(
            controller: _titleController,
            maxLength: 200,
            textCapitalization: TextCapitalization.sentences,
            textInputAction: TextInputAction.next,
            style: const TextStyle(fontSize: 18),
            decoration: const InputDecoration(hintText: '為今天留下一個名字'),
            validator: (value) => _requireText(value, '請輸入日記標題'),
          ),
        ),
        const SizedBox(height: 8),
        LabeledField(
          label: '記錄此刻',
          child: TextFormField(
            controller: _contentController,
            minLines: 7,
            maxLines: 12,
            textCapitalization: TextCapitalization.sentences,
            style: const TextStyle(height: 1.6),
            decoration: const InputDecoration(
              hintText: '今天發生了什麼？寫下你的心情與故事…',
            ),
            validator: (value) => _requireText(value, '寫幾句今天的故事吧'),
          ),
        ),
      ],
    );
  }

  Widget _buildMoodSection() {
    return SectionCard(
      children: [
        LabeledField(
          label: '今天的心情',
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final mood in _moods)
                _buildMoodChip(mood.label, mood.icon),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildMoodChip(String label, IconData icon) {
    final selected = _mood == label;
    final color = selected ? Colors.white : AppColors.textSecondary;
    return ChoiceChip(
      avatar: Icon(icon, size: 18, color: color),
      label: Text(label),
      selected: selected,
      onSelected: (_) => setState(() => _mood = label),
      labelStyle: TextStyle(color: color),
      side: BorderSide(
        color: selected ? AppColors.accent : AppColors.outline,
      ),
    );
  }

  Widget _buildDetailsSection() {
    return SectionCard(
      children: [
        LabeledField(
          label: '地點（選填）',
          child: TextFormField(
            controller: _locationController,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(
              hintText: '例如：高雄港邊',
              prefixIcon: Icon(Icons.location_on_outlined),
            ),
          ),
        ),
        const SizedBox(height: 16),
        LabeledField(
          label: '標籤（選填）',
          child: TextFormField(
            controller: _tagsController,
            textInputAction: TextInputAction.done,
            decoration: const InputDecoration(
              hintText: '例如：星空,散步,朋友',
              helperText: '以逗號分隔',
              prefixIcon: Icon(Icons.sell_outlined),
            ),
          ),
        ),
      ],
    );
  }

  String? _requireText(String? value, String message) {
    if (value == null || value.trim().isEmpty) return message;
    return null;
  }
}
