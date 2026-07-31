import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'api/api_client.dart';
import 'state/cart.dart';
import 'screens/menu_screen.dart';

void main() {
  runApp(const PizzBurgApp());
}

class PizzBurgApp extends StatelessWidget {
  const PizzBurgApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider(create: (_) => ApiClient()),
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
