import 'package:flutter/material.dart';
import 'package:life_logger/theme/app_theme.dart';
import 'package:life_logger/widgets/form_section.dart';

const defaultPrivacy = 'private';

const _privacyOptions = [
  (
    value: 'private',
    label: '私密',
    description: '只有自己看得到',
    icon: Icons.lock_outline_rounded,
  ),
  (
    value: 'public',
    label: '公開',
    description: '所有人都看得到；私人帳號只有追蹤你的人看得到',
    icon: Icons.public_rounded,
  ),
  (
    value: 'friends',
    label: '摯友',
    description: '只有摯友名單中的追蹤者看得到',
    icon: Icons.star_outline_rounded,
  ),
  (
    value: 'followers',
    label: '追蹤者',
    description: '所有追蹤你的人都看得到',
    icon: Icons.group_outlined,
  ),
];

class PrivacySelector extends StatelessWidget {
  const PrivacySelector({
    super.key,
    required this.value,
    required this.onChanged,
  });

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final selected = _privacyOptions.firstWhere(
      (option) => option.value == value,
    );
    return SectionCard(
      children: [
        LabeledField(
          label: '誰可以看',
          child: SegmentedButton<String>(
            showSelectedIcon: false,
            segments: [
              for (final option in _privacyOptions)
                ButtonSegment(
                  value: option.value,
                  label: Text(option.label),
                  icon: Icon(option.icon, size: 18),
                ),
            ],
            selected: {value},
            onSelectionChanged: (selection) => onChanged(selection.first),
          ),
        ),
        const SizedBox(height: 10),
        Text(
          selected.description,
          style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
        ),
      ],
    );
  }
}
