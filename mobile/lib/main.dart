import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'api/api_client.dart';
import 'state/cart.dart';
import 'state/favorites.dart';
import 'screens/app_shell.dart';
import 'state/auth.dart';
import 'services/analytics.dart';
import 'services/push_notifications.dart';
import 'screens/messages_screen.dart';
import 'screens/order_screen.dart';
import 'screens/review_screen.dart';
import 'screens/legal_screen.dart';
import 'screens/splash_screen.dart';
import 'api/models.dart';
import 'state/theme.dart';
import 'theme/themes.dart';
import 'theme/app_theme.dart';
import 'utils/haptics.dart';

final _navigatorKey = GlobalKey<NavigatorState>();
final _messengerKey = GlobalKey<ScaffoldMessengerState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final api = ApiClient();
  final auth = AuthState(api);
  final push = PushNotificationsService(api);
  final favorites = Favorites(api);
  // Избранное живёт на сервере и привязано к клиенту: при входе подтягиваем,
  // при выходе гасим — иначе следующий человек на этом телефоне увидит
  // чужие сердечки.
  auth.afterLogin = () async {
    await push.syncAfterLogin();
    await favorites.restore();
  };
  auth.beforeLogout = () async {
    await push.unregisterBeforeLogout();
    favorites.clear();
  };
  await Haptics.restore();
  final analytics = Analytics(api);
  await analytics.restore();
  analytics.log(Ev.appOpen);
  final theme = ThemeStore();
  // До первого кадра: иначе приложение стартует в чужой теме и
  // перекрашивается на глазах.
  await theme.restore();
  await auth.restore();
  if (auth.isAuthenticated) unawaited(favorites.restore());
  push.onForegroundMessage = (title, body) {
    _messengerKey.currentState
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(body.isEmpty ? title : '$title: $body')),
      );
  };
  push.onNotificationOpened = (data) {
    // Пуш рассылки ведёт в ленту: клиент должен найти сообщение, а не
    // гадать, к чему было уведомление
    if (data['type'] == 'message') {
      _navigatorKey.currentState?.push(
        MaterialPageRoute(builder: (_) => const MessagesScreen()),
      );
      return;
    }
    // Пуш анкеты ведёт в анкету, а не на шкалу статусов: заказ уже
    // доставлен, и смотреть там нечего (DECISIONS §12.23).
    if (data['type'] == 'review') {
      final reviewId = data['orderId']?.toString();
      final reviewNumber = int.tryParse(data['orderNumber']?.toString() ?? '');
      if (reviewId == null || reviewNumber == null) return;
      _navigatorKey.currentState?.push(
        MaterialPageRoute(
          builder: (_) =>
              ReviewScreen(orderId: reviewId, orderNumber: reviewNumber),
        ),
      );
      return;
    }
    if (data['type'] != 'order_status') return;
    final id = data['orderId']?.toString();
    final number = int.tryParse(data['orderNumber']?.toString() ?? '');
    final total = int.tryParse(data['total']?.toString() ?? '');
    if (id == null || number == null || total == null) return;
    _navigatorKey.currentState?.push(
      MaterialPageRoute(
        builder: (_) => OrderScreen(
          order: CreatedOrder(
            id: id,
            number: number,
            total: total,
            pointsSpent: 0,
          ),
        ),
      ),
    );
  };
  runApp(
    PizzBurgApp(
      api: api,
      auth: auth,
      push: push,
      favorites: favorites,
      themes: theme,
      analytics: analytics,
    ),
  );
  unawaited(push.initialize());
}

class PizzBurgApp extends StatelessWidget {
  final ApiClient api;
  final AuthState auth;
  final PushNotificationsService push;
  final Favorites favorites;
  final ThemeStore themes;
  final Analytics analytics;
  const PizzBurgApp({
    super.key,
    required this.api,
    required this.auth,
    required this.push,
    required this.favorites,
    required this.themes,
    required this.analytics,
  });

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider.value(value: api),
        ChangeNotifierProvider.value(value: auth),
        ChangeNotifierProvider.value(value: push),
        ChangeNotifierProvider.value(value: favorites),
        ChangeNotifierProvider(create: (_) => Cart()),
        ChangeNotifierProvider.value(value: themes),
        Provider.value(value: analytics),
      ],
      child: Consumer<ThemeStore>(
        builder: (context, themes, _) => _app(context, themes.current),
      ),
    );
  }

  Widget _app(BuildContext context, AppThemeVariant variant) {
    return MaterialApp(
        navigatorKey: _navigatorKey,
        scaffoldMessengerKey: _messengerKey,
        title: 'PizzBurg',
        debugShowCheckedModeBanner: false,
        // Направление «Сигнал» из design_handoff_pizzburg_app.
        // accent и benefit — параметры темы: платформа мультитенантная,
        // следующее заведение придёт со своими цветами.
        theme: AppTheme.build(
          ink: variant.ink,
          accent: variant.accent,
          benefit: variant.benefit,
          surface: variant.surface,
          page: variant.page,
          panel: variant.panel,
          onSurface: variant.onSurface,
          danger: variant.danger ?? const Color(0xFFD92D20),
          brightness: variant.brightness,
        ),
        // Макет мобильный (390 pt по хендоффу). «Адаптивный» не означает
        // «растянуть телефонный экран на 1600 px»: миниатюра 76 px рядом
        // со строкой во всю ширину монитора выглядит сломанной. На широком
        // экране прижимаем контент к телефонной колонке по центру.
        builder: (context, child) => AnnotatedRegion<SystemUiOverlayStyle>(
          // Значения по умолчанию — тёмные иконки статус-бара: в светлых
          // темах почти все экраны белые. Без этой аннотации система просто
          // оставляет последний применённый стиль, и светлые иконки чёрного
          // хедера каталога уезжают на белые экраны, где их не видно.
          //
          // В тёмной теме всё наоборот: там страница тёмная, и умолчанием
          // должны быть светлые иконки.
          value: variant.brightness == Brightness.dark
              ? const SystemUiOverlayStyle(
                  statusBarBrightness: Brightness.dark,
                  statusBarIconBrightness: Brightness.light,
                  statusBarColor: Colors.transparent,
                )
              : const SystemUiOverlayStyle(
                  statusBarBrightness: Brightness.light,
                  statusBarIconBrightness: Brightness.dark,
                  statusBarColor: Colors.transparent,
                ),
          // Заставка лежит выше телефонной колонки, а не внутри неё:
          // ограничение в 460 pt прижимает контент к центру, а чёрный фон
          // заставки должен закрывать окно целиком.
          child: _ColdStart(
            child: ColoredBox(
              // Поля вокруг телефонной колонки на широком экране: в тёмной
              // теме светлая рамка вокруг тёмного приложения била бы в глаза.
              color: variant.brightness == Brightness.dark
                  ? const Color(0xFF0B0D12)
                  : const Color(0xFFF2F2F3),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 460),
                  child: child ?? const SizedBox.shrink(),
                ),
              ),
            ),
          ),
        ),
      home: const _LegalGate(child: AppShell()),
    );
  }
}

/// Держит заставку поверх приложения на холодном старте и гасит её.
///
/// Приложение под ней уже живое: к моменту первого кадра `main` дождался
/// восстановления сессии и настроек, поэтому заставка ничего не ждёт — она
/// доигрывает анимацию и уходит. Состояние живёт в дереве `builder`, куда
/// навигация не достаёт, так что на переходах между экранами заставка не
/// возвращается.
class _ColdStart extends StatefulWidget {
  final Widget child;
  const _ColdStart({required this.child});

  @override
  State<_ColdStart> createState() => _ColdStartState();
}

enum _SplashStage { playing, fading, gone }

class _ColdStartState extends State<_ColdStart> {
  var _stage = _SplashStage.playing;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        widget.child,
        if (_stage != _SplashStage.gone)
          Positioned.fill(
            child: IgnorePointer(
              ignoring: _stage == _SplashStage.fading,
              child: AnimatedOpacity(
                opacity: _stage == _SplashStage.playing ? 1 : 0,
                duration: const Duration(milliseconds: 260),
                curve: Curves.easeOut,
                onEnd: () => setState(() => _stage = _SplashStage.gone),
                child: SplashScreen(
                  onDone: () => setState(() => _stage = _SplashStage.fading),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Поднимает экран согласия, как только сервер сообщил о непринятых
/// редакциях: после входа, после восстановления сессии и после публикации
/// новой оферты. Витрину при этом не прячет — меню можно смотреть без
/// согласия, оно требуется к моменту заказа.
class _LegalGate extends StatefulWidget {
  final Widget child;
  const _LegalGate({required this.child});

  @override
  State<_LegalGate> createState() => _LegalGateState();
}

class _LegalGateState extends State<_LegalGate> {
  bool _showing = false;

  @override
  Widget build(BuildContext context) {
    final needs = context.watch<AuthState>().needsLegalConsent;
    if (needs && !_showing) {
      _showing = true;
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        await _navigatorKey.currentState?.push(
          MaterialPageRoute(
            builder: (_) => const LegalConsentScreen(),
            fullscreenDialog: true,
          ),
        );
        // Сбрасываем флаг после закрытия: если клиент вышел и вошёл снова
        // либо вышла новая редакция, экран должен подняться заново.
        if (mounted) _showing = false;
      });
    }
    return widget.child;
  }
}
