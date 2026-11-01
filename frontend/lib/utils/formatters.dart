/// The backend stores `CURRENT_TIMESTAMP` values, which are UTC without a zone.
DateTime? parseServerTime(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return null;
  final hasZone = RegExp(r'(Z|[+-]\d{2}:?\d{2})$').hasMatch(trimmed);
  final normalized = trimmed.replaceFirst(' ', 'T');
  return DateTime.tryParse(hasZone ? normalized : '${normalized}Z')?.toLocal();
}

String formatDate(DateTime date) {
  return '${date.year}/${_twoDigits(date.month)}/${_twoDigits(date.day)}';
}

String formatDateTime(DateTime date) {
  return '${formatDate(date)} ${_twoDigits(date.hour)}:${_twoDigits(date.minute)}';
}

String _twoDigits(int value) => value.toString().padLeft(2, '0');
