import 'package:flutter_test/flutter_test.dart';
import 'package:life_logger/models/entry.dart';
import 'package:life_logger/utils/formatters.dart';

void main() {
  group('parseServerTime', () {
    test('treats a zoneless SQLite timestamp as UTC', () {
      expect(
        parseServerTime('2026-11-02 10:30:00')?.toUtc(),
        DateTime.utc(2026, 11, 2, 10, 30),
      );
    });

    test('respects an explicit zone', () {
      expect(
        parseServerTime('2026-11-02T10:30:00+08:00')?.toUtc(),
        DateTime.utc(2026, 11, 2, 2, 30),
      );
    });

    test('returns null for empty or invalid text instead of throwing', () {
      expect(parseServerTime(''), isNull);
      expect(parseServerTime('今天'), isNull);
    });
  });

  test('formats dates with zero padding', () {
    final date = DateTime(2026, 3, 4, 5, 6);
    expect(formatDate(date), '2026/03/04');
    expect(formatDateTime(date), '2026/03/04 05:06');
  });

  test('Entry.tagList handles spaces, hashes, and empty items', () {
    Entry entryWith(String? tags) => Entry.fromJson({'tags': tags});
    expect(entryWith('星空, #散步,,朋友 ').tagList, ['星空', '散步', '朋友']);
    expect(entryWith(null).tagList, isEmpty);
  });
}
