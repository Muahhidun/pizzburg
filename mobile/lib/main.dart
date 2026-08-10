import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'api/api_client.dart';
import 'state/cart.dart';
import 'screens/menu_screen.dart';
import 'state/auth.dart';
import 'services/push_notifications.dart';
import 'screens/order_screen.dart';
import 'api/models.dart';

final _navigatorKey = GlobalKey<NavigatorState>();
final _messengerKey = GlobalKey<ScaffoldMessengerState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final api = ApiClient();
  final auth = AuthState(api);
  final push = PushNotificationsService(api);
  auth.afterLogin = push.syncAfterLogin;
  auth.beforeLogout = push.unregisterBeforeLogout;
  await auth.restore();
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
  runApp(PizzBurgApp(api: api, auth: auth));
  unawaited(push.initialize());
}

class PizzBurgApp extends StatelessWidget {
  final ApiClient api;
  final AuthState auth;
  const PizzBurgApp({super.key, required this.api, required this.auth});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider.value(value: api),
        ChangeNotifierProvider.value(value: auth),
        ChangeNotifierProvider(create: (_) => Cart()),
      ],
      child: MaterialApp(
        navigatorKey: _navigatorKey,
        scaffoldMessengerKey: _messengerKey,
        title: 'PizzBurg',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFFE53935),
            brightness: Brightness.light,
          ),
          scaffoldBackgroundColor: const Color(0xFFF6F6F6),
          fontFamily: 'Inter',
        ),
        home: const MenuScreen(),
      ),
    );
  }
}
