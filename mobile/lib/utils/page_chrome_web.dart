import 'dart:js_interop';
import 'dart:ui';

@JS('document.documentElement.style')
external _Style get _rootStyle;

@JS('document.body.style')
external _Style get _bodyStyle;

extension type _Style._(JSObject _) implements JSObject {
  external set backgroundColor(String value);
}

String? _last;

/// Красит фон страницы. Повторный вызов с тем же цветом ничего не трогает:
/// вызывается на каждой сборке корня.
void setPageColor(Color color) {
  final css =
      'rgb(${(color.r * 255).round()}, ${(color.g * 255).round()}, '
      '${(color.b * 255).round()})';
  if (css == _last) return;
  _last = css;
  _rootStyle.backgroundColor = css;
  _bodyStyle.backgroundColor = css;
}
