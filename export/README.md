# PizzBurg — иконка и сплеш: перенос в проект

Вариант знака: **2b «Знак в край»** (логотип без маджента-кольца, 97% полотна, чёрный фон `#000000`).
Все PNG в этой папке готовы к коммиту. Слова для анимации: `word-pizz.png`, `word-burg.png` (в `assets/` проекта дизайна).

## 1. Файлы

```
export/
  ios/AppIcon.appiconset/
    Icon-App-1024x1024-1x.png     светлый, без альфы   → переименовать в Icon-App-1024x1024@1x.png
    Icon-App-Dark-1024.png        тёмный, с альфой
    Icon-App-Tinted-1024.png      тонированный, серый
  android/
    mipmap-{mdpi..xxxhdpi}/ic_launcher.png              legacy, API < 26
    mipmap-xxxhdpi/ic_launcher_foreground.png           adaptive, 432
    mipmap-xxxhdpi/ic_launcher_background.png           adaptive, 432, сплошной чёрный
    mipmap-xxxhdpi/ic_launcher_monochrome.png           Android 13+, только альфа
    notification/drawable-{mdpi..xxxhdpi}/ic_stat_pizzburg.png   FCM, белый силуэт
  splash/
    android12-icon-1152.png       холст 288 dp @4x, знак внутри 192 dp
    splash-logo-1024.png          Android 11 и старше + iOS
    splash-logo-dark-1024.png     тёмная тема
  stores/
    play-icon-512.png             Google Play
    play-feature-1024x500.png     feature graphic
```

## 2. pubspec.yaml

```yaml
dev_dependencies:
  flutter_launcher_icons: ^0.14.1
  flutter_native_splash: ^2.4.1

flutter_launcher_icons:
  image_path: "assets/branding/icon-1024.png"          # export/ios/.../Icon-App-1024x1024@1x.png
  android: "ic_launcher"
  adaptive_icon_background: "#000000"
  adaptive_icon_foreground: "assets/branding/adaptive-foreground.png"
  adaptive_icon_monochrome: "assets/branding/adaptive-monochrome.png"
  ios: true
  remove_alpha_ios: true

flutter_native_splash:
  color: "#000000"
  image: "assets/branding/splash-logo.png"
  color_dark: "#000000"
  image_dark: "assets/branding/splash-logo-dark.png"
  android_12:
    color: "#000000"
    image: "assets/branding/android12-icon.png"
    icon_background_color: "#000000"
  android: true
  ios: true
  fullscreen: true
```

```
flutter pub get
dart run flutter_launcher_icons
dart run flutter_native_splash:create
```

## 3. Ручные правки, которые генераторы затирают

1. `ios/Runner/Info.plist` → `CFBundleDisplayName` = `PizzBurg`.
2. `android/app/src/main/AndroidManifest.xml` → `android:label="PizzBurg"` и регистрация иконки FCM:

```xml
<meta-data
    android:name="com.google.firebase.messaging.default_notification_icon"
    android:resource="@drawable/ic_stat_pizzburg" />
<meta-data
    android:name="com.google.firebase.messaging.default_notification_color"
    android:resource="@color/pizzburg_orange" />
```

`android/app/src/main/res/values/colors.xml`:

```xml
<color name="pizzburg_orange">#F7931E</color>
```

3. Тёмный и тонированный варианты iOS в `Contents.json` (Xcode: AppIcon → Appearances → Any/Dark/Tinted, либо руками):

```json
{ "filename": "Icon-App-Dark-1024.png", "idiom": "universal", "platform": "ios",
  "size": "1024x1024", "appearances": [{ "appearance": "luminosity", "value": "dark" }] }
```

Иконки уведомлений копируются в `android/app/src/main/res/drawable-*/` — генераторы их не создают.

## 4. Стадия 2: анимация сплеша

Слова крутятся вокруг вертикальной оси в противоположные стороны, `Pizz` замирает на 1.38 с, `Burg` на 1.70 с. Хаптик: 5 щелчков прокрутки с растущим интервалом, `medium` на первый замок, `heavy` на второй.

```dart
class PizzBurgSplash extends StatefulWidget {
  const PizzBurgSplash({super.key, required this.onDone});
  final VoidCallback onDone;
  @override
  State<PizzBurgSplash> createState() => _PizzBurgSplashState();
}

class _PizzBurgSplashState extends State<PizzBurgSplash>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this, duration: const Duration(milliseconds: 1700))..forward();

  // 0.10 / 0.45 / 0.75 / 1.00 / 1.20 — щелчки, 1.38 medium, 1.70 heavy
  static const _ticks = <int, HapticKind>{
    100: HapticKind.selection, 450: HapticKind.selection, 750: HapticKind.selection,
    1000: HapticKind.selection, 1200: HapticKind.selection,
    1380: HapticKind.medium, 1700: HapticKind.heavy,
  };

  @override
  void initState() {
    super.initState();
    for (final e in _ticks.entries) {
      Future.delayed(Duration(milliseconds: e.key), () {
        if (!mounted) return;
        switch (e.value) {
          case HapticKind.selection: HapticFeedback.selectionClick();
          case HapticKind.medium: HapticFeedback.mediumImpact();
          case HapticKind.heavy: HapticFeedback.heavyImpact();
        }
      });
    }
    // предел удержания — 2 с, дальше показываем приложение
    Future.delayed(const Duration(milliseconds: 2000), widget.onDone);
  }

  @override
  void dispose() { _c.dispose(); super.dispose(); }

  // два оборота с торможением; b — обратное направление и более поздний замок
  double _angle(double t, {required bool reverse}) {
    final end = reverse ? 0.94 : 0.81;           // доля длительности до замка
    final p = (t / end).clamp(0.0, 1.0);
    final eased = Curves.easeOutQuart.transform(p);
    return (reverse ? -1 : 1) * eased * 4 * math.pi;
  }

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: Colors.black,
    child: Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 34),
        child: AnimatedBuilder(
          animation: _c,
          builder: (_, __) => Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _word('assets/branding/word-pizz.png', _angle(_c.value, reverse: false)),
              const SizedBox(height: 14),
              _word('assets/branding/word-burg.png', _angle(_c.value, reverse: true)),
            ],
          ),
        ),
      ),
    ),
  );

  Widget _word(String asset, double angle) => Transform(
    alignment: Alignment.center,
    transform: Matrix4.identity()..setEntry(3, 2, 0.0011)..rotateY(angle),
    child: Image.asset(asset, fit: BoxFit.fitWidth),
  );
}

enum HapticKind { selection, medium, heavy }
```

Объём в вебе даётся восьмью слоями по глубине. В Flutter дешевле обойтись одним слоем плюс `Matrix4` с перспективой; если нужен именно объём — сложить 6–8 `Transform.translate` копий с затемнением по `Z`.

## 5. Приёмка

- Между нативным экраном и первым кадром Flutter нет вспышки: оба фона `#000000`.
- Сплеш снимается по готовности, удержание не больше 2 с.
- Иконка проверена на масках Pixel: круг, суперэллипс, капля.
- Push от FCM показывает белый силуэт, не квадрат.
- Подпись под иконкой `PizzBurg` на обеих платформах.
