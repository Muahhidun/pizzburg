import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'api/api_client.dart';
import 'state/cart.dart';
import 'screens/menu_screen.dart';
import 'state/auth.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final api = ApiClient();
  final auth = AuthState(api);
  await auth.restore();
  runApp(PizzBurgApp(api: api, auth: auth));
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
