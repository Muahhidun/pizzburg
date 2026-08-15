import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'api/api_client.dart';
import 'state/cart.dart';
import 'state/favorites.dart';
import 'screens/app_shell.dart';
import 'state/auth.dart';
import 'services/push_notifications.dart';
import 'screens/order_screen.dart';
import 'screens/legal_screen.dart';
import 'api/models.dart';
import 'theme/app_theme.dart';
import 'utils/haptics.dart';
import 'widgets/liquid_glass.dart';

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
  // Компиляция шейдера занимает время: делать её в момент первого касания
  // бара — значит подвесить жест на ровном месте.
  await LiquidGlass.warmUp();
  await Haptics.restore();
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
  runApp(PizzBurgApp(api: api, auth: auth, push: push, favorites: favorites));
  unawaited(push.initialize());
}

class PizzBurgApp extends StatelessWidget {
  final ApiClient api;
  final AuthState auth;
  final PushNotificationsService push;
  final Favorites favorites;
  const PizzBurgApp({
    super.key,
    required this.api,
    required this.auth,
    required this.push,
    required this.favorites,
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
      ],
      child: MaterialApp(
        navigatorKey: _navigatorKey,
        scaffoldMessengerKey: _messengerKey,
        title: 'PizzBurg',
        debugShowCheckedModeBanner: false,
        // Направление «Сигнал» из design_handoff_pizzburg_app.
        // accent и benefit — параметры темы: платформа мультитенантная,
        // следующее заведение придёт со своими цветами.
        theme: AppTheme.build(),
        // Макет мобильный (390 pt по хендоффу). «Адаптивный» не означает
        // «растянуть телефонный экран на 1600 px»: миниатюра 76 px рядом
        // со строкой во всю ширину монитора выглядит сломанной. На широком
        // экране прижимаем контент к телефонной колонке по центру.
        builder: (context, child) => AnnotatedRegion<SystemUiOverlayStyle>(
          // Значения по умолчанию — тёмные иконки статус-бара: почти все
          // экраны белые. Без этой аннотации система просто оставляет
          // последний применённый стиль, и светлые иконки чёрного хедера
          // каталога уезжают на белые экраны, где их не видно.
          value: const SystemUiOverlayStyle(
            statusBarBrightness: Brightness.light,
            statusBarIconBrightness: Brightness.dark,
            statusBarColor: Colors.transparent,
          ),
          child: ColoredBox(
            color: const Color(0xFFF2F2F3),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: child ?? const SizedBox.shrink(),
              ),
            ),
          ),
        ),
        home: const _LegalGate(child: AppShell()),
      ),
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
