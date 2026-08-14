import 'package:flutter/services.dart';

const _letters = r"A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі";

/// Форматирует любой допустимый ввод как +7 (707) 123-45-67
/// и физически не даёт ввести больше десяти цифр после +7.
class KzPhoneInputFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    if (newValue.text.isEmpty) return newValue;

    var digits = _significantDigits(newValue.text);

    // Удаление символа форматирования не должно быть холостым.
    //
    // На «+7 (708)» backspace стирает скобку, форматтер тут же дорисовывает
    // её обратно — текст не меняется, и номер становится невозможно
    // исправить. Поэтому если после удаления набор цифр не изменился,
    // убираем последнюю цифру: пользователь хотел стереть именно её.
    final deleting = newValue.text.length < oldValue.text.length;
    if (deleting && digits == _significantDigits(oldValue.text)) {
      if (digits.isEmpty) return newValue;
      digits = digits.substring(0, digits.length - 1);
    }

    final out = StringBuffer('+7');
    if (digits.isNotEmpty) {
      out.write(' (');
      out.write(digits.substring(0, digits.length < 3 ? digits.length : 3));
    }
    if (digits.length >= 3) out.write(')');
    if (digits.length > 3) {
      out.write(
        ' ${digits.substring(3, digits.length < 6 ? digits.length : 6)}',
      );
    }
    if (digits.length > 6) {
      out.write(
        '-${digits.substring(6, digits.length < 8 ? digits.length : 8)}',
      );
    }
    if (digits.length > 8) {
      out.write(
        '-${digits.substring(8, digits.length < 10 ? digits.length : 10)}',
      );
    }

    final text = out.toString();
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }

  /// Цифры номера без кода страны: «+7 (708) 12» → «70812»
  static String _significantDigits(String raw) {
    var digits = raw.replaceAll(RegExp(r'\D'), '');
    final hasFormattedPrefix = raw.trimLeft().startsWith('+7');
    if (hasFormattedPrefix && digits.startsWith('7')) {
      digits = digits.substring(1);
    } else if (digits.length > 10 &&
        (digits.startsWith('7') || digits.startsWith('8'))) {
      digits = digits.substring(1);
    }
    return digits.length > 10 ? digits.substring(0, 10) : digits;
  }
}

final nameInputFormatters = <TextInputFormatter>[
  FilteringTextInputFormatter.allow(RegExp("[$_letters '’-]")),
  LengthLimitingTextInputFormatter(60),
];

final streetInputFormatters = <TextInputFormatter>[
  FilteringTextInputFormatter.allow(RegExp("[${_letters}0-9 .,'’№/()\\-]")),
  LengthLimitingTextInputFormatter(100),
];

final houseInputFormatters = <TextInputFormatter>[
  FilteringTextInputFormatter.allow(RegExp("[${_letters}0-9 ./\\-]")),
  LengthLimitingTextInputFormatter(20),
];

final flatInputFormatters = <TextInputFormatter>[
  FilteringTextInputFormatter.allow(RegExp("[${_letters}0-9/\\-]")),
  LengthLimitingTextInputFormatter(12),
];

final entranceInputFormatters = <TextInputFormatter>[
  FilteringTextInputFormatter.digitsOnly,
  LengthLimitingTextInputFormatter(3),
];

// Минус убран: на цифровой клавиатуре iOS его всё равно нет, а этаж «−1»
// пишут как «0» или «цоколь» в комментарии.
final floorInputFormatters = <TextInputFormatter>[
  FilteringTextInputFormatter.digitsOnly,
  LengthLimitingTextInputFormatter(3),
];

final commentInputFormatters = <TextInputFormatter>[
  LengthLimitingTextInputFormatter(300),
];

String? validateKzPhone(String? value) {
  final digits = (value ?? '').replaceAll(RegExp(r'\D'), '');
  return RegExp(r'^7\d{10}$').hasMatch(digits)
      ? null
      : 'Введите номер полностью';
}

String? validateName(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) return null;
  if (text.length < 2) return 'Имя слишком короткое';
  return RegExp("^[$_letters]+(?:[ '’-][$_letters]+)*\$").hasMatch(text)
      ? null
      : 'Только буквы, пробел, дефис или апостроф';
}

String? validateStreet(String? value) {
  final text = (value ?? '').trim();
  if (text.length < 2) return 'Укажите улицу';
  return RegExp("^[${_letters}0-9 .,'’№/()\\-]+\$").hasMatch(text)
      ? null
      : 'Проверьте название улицы';
}

String? validateHouse(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) return 'Укажите дом';
  return RegExp("^(?=.*[0-9])[${_letters}0-9 ./\\-]{1,20}\$").hasMatch(text)
      ? null
      : 'Например: 47Б или 12/1';
}

String? validateFlat(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) return null;
  return RegExp(
        "^[0-9]{1,5}[$_letters]?(?:[/\\-][0-9]{1,5}[$_letters]?)?\$",
      ).hasMatch(text)
      ? null
      : 'Например: 69 или 6А';
}

String? validateEntrance(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) return null;
  return RegExp(r'^\d{1,3}$').hasMatch(text) ? null : 'Только номер';
}

String? validateFloor(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) return null;
  return RegExp(r'^-?\d{1,2}$').hasMatch(text) ? null : 'Например: 9 или -1';
}

String? validateComment(String? value) {
  return (value ?? '').length <= 300 ? null : 'Не больше 300 символов';
}
