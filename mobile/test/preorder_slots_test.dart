import 'package:flutter_test/flutter_test.dart';
import 'package:pizzburg/api/models.dart';
import 'package:pizzburg/i18n/strings.dart';

/// Предзаказ только на сегодня и завтра (Дом, 28.11.2026): слоты делятся
/// по дню заведения, подпись дня — с датой, чтобы не перепутать.
void main() {
  test('слоты делятся на сегодня и завтра по дате сервера', () {
    final s = PreorderSlots.fromJson({
      'today': '2026-11-28',
      'slots': [
        {
          'at': '2026-11-28T14:00:00Z',
          'label': '19:00–19:15',
          'date': '2026-11-28',
        },
        {
          'at': '2026-11-29T05:00:00Z',
          'label': '10:00–10:15',
          'date': '2026-11-29',
        },
      ],
    });
    expect(s.tomorrow, '2026-11-29');
    expect(s.on(s.today).single.label, '19:00–19:15');
    expect(s.on(s.tomorrow).single.label, '10:00–10:15');
  });

  test('конец месяца: завтра после 30 ноября — 1 декабря', () {
    final s = PreorderSlots.fromJson({'today': '2026-11-30', 'slots': []});
    expect(s.tomorrow, '2026-12-01');
  });

  test('старый сервер без дат — день по часам телефона', () {
    final s = PreorderSlots.fromJson({
      'slots': [
        {'at': '2026-11-29T05:00:00Z', 'label': '10:00–10:15'},
      ],
    });
    expect(s.slots.single.date, isNotEmpty);
  });

  test('дата словами: «сб 28 ноября»', () {
    expect(S.shortDate('2026-11-28'), 'сб 28 ноября');
    expect(S.shortDate('2026-11-29'), 'вс 29 ноября');
    expect(S.placeOrderFor('завтра', '12:00'), 'На завтра 12:00');
  });
}
