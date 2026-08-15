import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../services/push_notifications.dart';
import '../state/auth.dart';
import '../state/cart.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/motion.dart';
import 'legal_screen.dart';
import 'order_screen.dart';

/// Профиль по прототипу «Сигнал».
///
/// Карточка баллов — единственный маджентовый блок в приложении: это и есть
/// выгода клиента, ради которой он возвращается.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  MenuResponse? _menu;

  @override
  void initState() {
    super.initState();
    context.read<ApiClient>().fetchMenu().then((menu) {
      if (mounted) setState(() => _menu = menu);
    }).catchError((_) {});
  }

  Future<void> _repeat(Map<String, dynamic> order) async {
    final loaded = _menu;
    final messenger = ScaffoldMessenger.of(context);
    if (loaded == null) return;
    try {
      final result = await context.read<ApiClient>().repeatOrder(
        order['id'].toString(),
      );
      if (!mounted) return;
      final added = context.read<Cart>().fillFromRepeat(result, loaded);
      if (added == 0) {
        await Haptics.warning();
        messenger.showSnackBar(
          const SnackBar(content: Text('Из того заказа сегодня ничего нет')),
        );
        return;
      }
      Haptics.success();
      messenger.showSnackBar(
        const SnackBar(content: Text('Заказ перенесён в корзину')),
      );
    } catch (e) {
      await Haptics.warning();
      messenger.showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final auth = context.watch<AuthState>();
    final push = context.watch<PushNotificationsService>();
    final orders = auth.orders.cast<Map<String, dynamic>>();

    if (!auth.isAuthenticated) {
      return Scaffold(
        backgroundColor: c.surface,
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(Gap.blockWide),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 92,
                    height: 92,
                    decoration: BoxDecoration(
                      color: c.accentSoft,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.person_outline,
                      size: 34,
                      color: c.accent,
                    ),
                  ),
                  const SizedBox(height: Gap.block),
                  Text(
                    'Войдите по телефону',
                    style: Theme.of(
                      context,
                    ).textTheme.titleLarge?.copyWith(fontSize: 20),
                  ),
                  const SizedBox(height: Gap.sm),
                  Text(
                    'Баллы, история заказов и сохранённые адреса — '
                    'после входа',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: c.surface,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: auth.refresh,
          child: ListView(
            padding: EdgeInsets.fromLTRB(
              Gap.screen,
              Gap.lg,
              Gap.screen,
              // Плавающий бар лежит поверх списка
              Gap.navBarSpace(context),
            ),
            children: [
              Text(
                auth.name.isEmpty ? 'Профиль' : auth.name,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              Text(auth.phone, style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: Gap.block),

              _PointsCard(
                balance: auth.pointsBalance,
                cashbackPct: auth.cashbackPct,
                levelName: auth.levelName,
                level: auth.loyaltyLevel,
                levelsTotal: auth.levelsTotal,
              ),

              if (auth.toNextLevel > 0 && auth.nextCashbackPct != null) ...[
                const SizedBox(height: Gap.md),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(Gap.lg),
                  decoration: BoxDecoration(
                    color: c.accentSoft,
                    borderRadius: R.thumb,
                  ),
                  child: Text(
                    'Ещё ${formatTenge(auth.toNextLevel)} заказов — '
                    'и кэшбэк станет ${auth.nextCashbackPct}%',
                    style: TextStyle(
                      fontSize: 13,
                      height: 1.4,
                      fontWeight: FontWeight.w500,
                      color: c.accent,
                    ),
                  ),
                ),
              ],

              const SizedBox(height: Gap.block),
              _NotificationsCard(push: push),

              if (orders.isNotEmpty) ...[
                const SizedBox(height: Gap.blockWide),
                const Text(
                  'Заказы',
                  style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: Gap.sm),
                for (var i = 0; i < orders.length && i < 5; i++)
                  StaggeredEntrance(
                    index: i,
                    child: _OrderRow(
                      order: orders[i],
                      canRepeat: _menu != null,
                      onRepeat: () => _repeat(orders[i]),
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => OrderScreen(
                            order: CreatedOrder(
                              id: orders[i]['id'].toString(),
                              number: (orders[i]['number'] as num).toInt(),
                              total:
                                  (orders[i]['total'] as num?)?.toInt() ?? 0,
                              pointsSpent: 0,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],

              const SizedBox(height: Gap.blockWide),
              const Text(
                'История баллов',
                style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: Gap.sm),
              if (auth.transactions.isEmpty)
                Text(
                  'Операций ещё не было',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              for (final raw in auth.transactions.take(20))
                _PointsRow(txn: raw as Map<String, dynamic>),

              const SizedBox(height: Gap.blockWide),
              const _LegalLinks(),
              const SizedBox(height: Gap.lg),
              PressScale(
                onTap: auth.logout,
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 15),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: c.fillSoft,
                    borderRadius: R.pill,
                  ),
                  child: Text(
                    'Выйти',
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: c.ink,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PointsCard extends StatelessWidget {
  final int balance;
  final int cashbackPct;
  final String levelName;
  final int level;
  final int levelsTotal;

  const _PointsCard({
    required this.balance,
    required this.cashbackPct,
    required this.levelName,
    required this.level,
    required this.levelsTotal,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: c.benefit,
        borderRadius: const BorderRadius.all(Radius.circular(30)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Баллы',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: c.ink.withValues(alpha: 0.65),
            ),
          ),
          const SizedBox(height: Gap.sm),
          AnimatedMoney(
            balance,
            withCurrency: false,
            style: Theme.of(
              context,
            ).textTheme.displayLarge?.copyWith(color: c.ink),
          ),
          const SizedBox(height: Gap.xs),
          Text(
            '1 балл = 1 ₸, списывайте любой суммой',
            style: TextStyle(
              fontSize: 12.5,
              height: 1.4,
              color: c.ink.withValues(alpha: 0.8),
            ),
          ),
          const SizedBox(height: Gap.lg),
          Divider(color: c.ink.withValues(alpha: 0.16), height: 1),
          const SizedBox(height: Gap.md),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Кэшбэк $cashbackPct%',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: c.ink,
                ),
              ),
              Text(
                levelName.isEmpty
                    ? 'Уровень $level из $levelsTotal'
                    : '$levelName · $level из $levelsTotal',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: c.ink,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _OrderRow extends StatelessWidget {
  final Map<String, dynamic> order;
  final bool canRepeat;
  final VoidCallback onRepeat;
  final VoidCallback onTap;

  const _OrderRow({
    required this.order,
    required this.canRepeat,
    required this.onRepeat,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final items = (order['items'] as List?) ?? const [];
    return PressScale(
      onTap: onTap,
      scale: 0.99,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: Gap.md),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: c.line)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _date(order['createdAt']),
                    style: const TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    items.map((i) => (i as Map)['name'].toString()).join(', '),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelMedium,
                  ),
                ],
              ),
            ),
            const SizedBox(width: Gap.sm),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  formatTenge((order['total'] as num?)?.toInt() ?? 0),
                  style: Theme.of(
                    context,
                  ).textTheme.titleMedium?.copyWith(fontSize: 15),
                ),
                const SizedBox(height: Gap.sm),
                PressScale(
                  onTap: canRepeat ? onRepeat : null,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: c.fillSoft,
                      borderRadius: R.pill,
                    ),
                    child: Text(
                      'Повтор',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: canRepeat ? c.ink : c.muted,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  static String _date(dynamic value) {
    final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    if (date == null) return '';
    const months = [
      'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
    ];
    return '${date.day} ${months[date.month - 1]}';
  }
}

class _PointsRow extends StatelessWidget {
  final Map<String, dynamic> txn;
  const _PointsRow({required this.txn});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final amount = (txn['amount'] as num).toInt();
    final earned = amount > 0;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: Gap.md),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: c.line)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '${earned ? 'Начислено' : 'Списано'} · ${_date(txn['createdAt'])}',
              style: const TextStyle(fontSize: 13.5),
            ),
          ),
          Text(
            '${earned ? '+' : ''}$amount',
            style: TextStyle(
              fontFamily: 'Unbounded',
              fontSize: 14.5,
              fontWeight: FontWeight.w700,
              color: earned ? c.benefit : c.ink,
            ),
          ),
        ],
      ),
    );
  }

  static String _date(dynamic value) {
    final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    if (date == null) return '';
    const months = [
      'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
      'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
    ];
    return '${date.day} ${months[date.month - 1]}';
  }
}

class _LegalLinks extends StatelessWidget {
  const _LegalLinks();

  static const _types = [
    ('OFFER', 'Публичная оферта'),
    ('PRIVACY', 'Политика конфиденциальности'),
    ('REQUISITES', 'Реквизиты'),
  ];

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Column(
      children: [
        for (final (type, label) in _types)
          PressScale(
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => LegalDocumentScreen(type: type, title: label),
              ),
            ),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 14),
              decoration: BoxDecoration(
                border: Border(bottom: BorderSide(color: c.line)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      label,
                      style: const TextStyle(fontSize: 13.5),
                    ),
                  ),
                  Icon(Icons.chevron_right, size: 18, color: c.muted),
                ],
              ),
            ),
          ),
        // Требование лицензии ODbL: адресный справочник города собран из
        // данных OpenStreetMap, и указать это обязательно.
        Padding(
          padding: const EdgeInsets.only(top: Gap.md),
          child: Text(
            'Адреса города — данные © участников OpenStreetMap, ODbL',
            style: TextStyle(fontSize: 11, color: c.muted),
          ),
        ),
      ],
    );
  }
}

class _NotificationsCard extends StatelessWidget {
  final PushNotificationsService push;
  const _NotificationsCard({required this.push});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.all(Gap.lg),
      decoration: BoxDecoration(color: c.fillSoft, borderRadius: R.field),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Вибрация',
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  'Отклик при выборе и подтверждении',
                  style: Theme.of(context).textTheme.labelMedium,
                ),
              ],
            ),
          ),
          _HapticsSwitch(),
        ],
      ),
    );
  }
}

class _HapticsSwitch extends StatefulWidget {
  @override
  State<_HapticsSwitch> createState() => _HapticsSwitchState();
}

class _HapticsSwitchState extends State<_HapticsSwitch> {
  @override
  Widget build(BuildContext context) {
    return Switch(
      value: Haptics.enabled,
      activeThumbColor: context.colors.accent,
      onChanged: (v) async {
        await Haptics.setEnabled(v);
        if (v) Haptics.selection();
        if (mounted) setState(() {});
      },
    );
  }
}
