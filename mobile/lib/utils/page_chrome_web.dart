import 'dart:js_interop';
import 'dart:ui';

import 'package:flutter/scheduler.dart';

@JS('document')
external _Document get _document;

extension type _Document._(JSObject _) implements JSObject {
  external _Element? get documentElement;
  external _Element? get body;
  external _Element? querySelector(String selector);
  external _NodeList querySelectorAll(String selector);
  external _Element createElement(String tag);
  external _Element? get head;
}

extension type _NodeList._(JSObject _) implements JSObject {
  external int get length;
  external _Element item(int index);
}

extension type _Element._(JSObject _) implements JSObject {
  external _Style get style;
  external void setAttribute(String name, String value);
  external void appendChild(_Element child);
}

extension type _Style._(JSObject _) implements JSObject {
  external set backgroundColor(String value);
}

String? _last;

/// Красит фон страницы и всё, по чему Safari определяет цвет своих полос.
///
/// Safari 26 смотрит не на фон body, а на элемент, прибитый к краю экрана.
/// У Flutter это `flutter-view` во весь экран с прозрачным фоном — и
/// Safari считал полосы чёрными. Поэтому красим и его. Старые Safari и
/// Chrome берут цвет из `<meta name="theme-color">`: Flutter пишет туда
/// свой, прозрачный, — перезаписываем после кадра.
void setPageColor(Color color) {
  final css =
      'rgb(${(color.r * 255).round()}, ${(color.g * 255).round()}, '
      '${(color.b * 255).round()})';
  if (css == _last) return;
  _last = css;
  _apply(css);
  SchedulerBinding.instance.addPostFrameCallback((_) => _apply(css));
}

void _apply(String css) {
  _document.documentElement?.style.backgroundColor = css;
  _document.body?.style.backgroundColor = css;
  final views = _document.querySelectorAll('flutter-view, flt-glass-pane');
  for (var i = 0; i < views.length; i++) {
    views.item(i).style.backgroundColor = css;
  }
  var meta = _document.querySelector('meta[name="theme-color"]');
  if (meta == null) {
    meta = _document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    _document.head?.appendChild(meta);
  }
  meta.setAttribute('content', css);
}
