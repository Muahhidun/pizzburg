import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../services/push_notifications.dart';
import '../state/auth.dart';
import '../state/theme.dart';
import '../theme/themes.dart';
import 'login_screen.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/motion.dart';
import 'messages_screen.dart';
import 'legal_screen.dart';

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
  // Меню здесь больше не нужно: его загружали ради кнопки «Повтор» в
  // списке заказов, а сам список уехал на свою вкладку.

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final auth = context.watch<AuthState>();
    final push = context.watch<PushNotificationsService>();

    if (!auth.isAuthenticated) {
      return Scaffold(
        backgroundColor: c.page,
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
                  const SizedBox(height: Gap.blockWide),
                  PressScale(
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const LoginScreen(),
                      ),
                    ),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 28,
                        vertical: 15,
                      ),
                      decoration: BoxDecoration(
                        color: c.accent,
                        borderRadius: R.pill,
                      ),
                      child: Text(
                        'Войти по телефону',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: c.surface,
                        ),
                      ),
                    ),
                  ),
                  // Лента публичная: гость тоже должен видеть акции
                  const SizedBox(height: Gap.md),
                  PressScale(
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const MessagesScreen(),
                      ),
                    ),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 24,
                        vertical: 14,
                      ),
                      decoration: BoxDecoration(
                        color: c.fillSoft,
                        borderRadius: R.pill,
                      ),
                      child: Text(
                        'Акции и новости',
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
        ),
      );
    }

    return Scaffold(
      backgroundColor: c.page,
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
              _PushRow(push: push),
              const _ThemeCard(),

              const SizedBox(height: Gap.block),
              _NotificationsCard(push: push),

              // Список заказов жил и здесь, и на вкладке «Заказы» — один и
              // тот же `auth.orders` в двух местах. На вкладке он полнее:
              // с подписями «Завершён» и «Отменён» и делением на активные
              // и прошлые. В профиле остаётся то, чего больше нигде нет:
              // баллы, уровень и адреса.
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
              const _MessagesRow(),
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
              color: c.onBenefit.withValues(alpha: 0.65),
            ),
          ),
          const SizedBox(height: Gap.sm),
          AnimatedMoney(
            balance,
            withCurrency: false,
            style: Theme.of(
              context,
            ).textTheme.displayLarge?.copyWith(color: c.onBenefit),
          ),
          const SizedBox(height: Gap.xs),
          Text(
            '1 балл = 1 ₸, списывайте любой суммой',
            style: TextStyle(
              fontSize: 12.5,
              height: 1.4,
              color: c.onBenefit.withValues(alpha: 0.8),
            ),
          ),
          const SizedBox(height: Gap.lg),
          Divider(color: c.onBenefit.withValues(alpha: 0.16), height: 1),
          const SizedBox(height: Gap.md),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Кэшбэк $cashbackPct%',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: c.onBenefit,
                ),
              ),
              Text(
                levelName.isEmpty
                    ? 'Уровень $level из $levelsTotal'
                    : '$levelName · $level из $levelsTotal',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: c.onBenefit,
                ),
              ),
            ],
          ),
        ],
      ),
    );
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
              color: earned ? c.accent : c.ink,
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

/// Строка «Сообщения» с точкой непрочитанного.
///
/// Точка маджентовая — новое сообщение для клиента выгода (акция), а не
/// действие. Прочитанность считается локально по дате свежего сообщения:
/// серверного счётчика нет намеренно, лента общая для всех.
class _MessagesRow extends StatefulWidget {
  const _MessagesRow();

  @override
  State<_MessagesRow> createState() => _MessagesRowState();
}

class _MessagesRowState extends State<_MessagesRow> {
  bool _unread = false;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    try {
      final items = await context.read<ApiClient>().fetchMessages();
      if (items.isEmpty) return;
      final prefs = await SharedPreferences.getInstance();
      final readAt = DateTime.tryParse(
        prefs.getString(MessagesScreen.readAtKey) ?? '',
      );
      final unread =
          readAt == null || items.first.createdAt.isAfter(readAt);
      if (mounted && unread != _unread) setState(() => _unread = unread);
    } catch (_) {
      // Лента — не критичный путь: без сети строка просто без точки
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return PressScale(
      onTap: () async {
        await Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const MessagesScreen()),
        );
        if (mounted) _check();
      },
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: c.line)),
        ),
        child: Row(
          children: [
            const Expanded(
              child: Text('Акции и новости', style: TextStyle(fontSize: 13.5)),
            ),
            if (_unread)
              Container(
                width: 8,
                height: 8,
                margin: const EdgeInsets.only(right: Gap.sm),
                decoration: BoxDecoration(
                  color: c.accent,
                  shape: BoxShape.circle,
                ),
              ),
            Icon(Icons.chevron_right, size: 18, color: c.muted),
          ],
        ),
      ),
    );
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

/// Выбор оформления.
///
/// Не список с галочками, а кружки: тему выбирают глазами, и показать её
/// надо, а не назвать. В каждом кружке видны все три роли палитры — фон,
/// действие, выгода, — поэтому по нему заранее понятно, каким станет
/// приложение, а не только «какой тут любимый цвет».
class _ThemeCard extends StatelessWidget {
  const _ThemeCard();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final store = context.watch<ThemeStore>();

    return Container(
      padding: const EdgeInsets.all(Gap.lg),
      decoration: BoxDecoration(color: c.fillSoft, borderRadius: R.field),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Оформление',
            style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
          ),
          Text(
            store.current.hint,
            style: Theme.of(context).textTheme.labelMedium,
          ),
          const SizedBox(height: Gap.lg),
          Row(
            children: [
              for (final variant in appThemes) ...[
                Expanded(
                  child: _ThemeChoice(
                    variant: variant,
                    selected: variant.id == store.current.id,
                    onTap: () {
                      Haptics.selection();
                      context.read<ThemeStore>().select(variant);
                    },
                  ),
                ),
                if (variant != appThemes.last) const SizedBox(width: Gap.sm),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _ThemeChoice extends StatelessWidget {
  final AppThemeVariant variant;
  final bool selected;
  final VoidCallback onTap;

  const _ThemeChoice({
    required this.variant,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return PressScale(
      onTap: onTap,
      child: Column(
        children: [
          Container(
            height: 52,
            decoration: BoxDecoration(
              // Кружок показывает фон страницы, а не «светлый» цвет темы:
              // у тёмной они разные, и белый кружок обещал бы не то.
              color: variant.page ?? variant.surface,
              borderRadius: R.thumbRepeat,
              border: Border.all(
                color: selected ? c.ink : c.ink.withValues(alpha: 0.12),
                width: selected ? 2 : 1,
              ),
            ),
            child: Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _Dot(variant.ink),
                  const SizedBox(width: 3),
                  _Dot(variant.accent),
                  const SizedBox(width: 3),
                  _Dot(variant.benefit),
                ],
              ),
            ),
          ),
          const SizedBox(height: Gap.xs),
          Text(
            variant.name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 11,
              fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
              color: selected ? c.ink : c.muted,
            ),
          ),
        ],
      ),
    );
  }
}

class _Dot extends StatelessWidget {
  final Color color;
  const _Dot(this.color);

  @override
  Widget build(BuildContext context) => Container(
    width: 12,
    height: 12,
    decoration: BoxDecoration(color: color, shape: BoxShape.circle),
  );
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

/// Уведомления о заказе.
///
/// Строка нужна тем, кто отказался в диалоге после первого заказа: iOS
/// показывает это окно один раз, и без такой строки включить уведомления
/// обратно можно было бы только угадав путь в настройках телефона.
class _PushRow extends StatelessWidget {
  final PushNotificationsService push;
  const _PushRow({required this.push});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final status = context.watch<PushNotificationsService>().status;
    if (status == PushNotificationsStatus.unavailable) {
      return const SizedBox.shrink();
    }

    final (title, hint) = switch (status) {
      PushNotificationsStatus.enabled => (
        'Уведомления включены',
        'Сообщим, когда заказ будет готов',
      ),
      PushNotificationsStatus.denied => (
        'Уведомления выключены',
        'Включить можно в Настройках телефона → PizzBurg → Уведомления',
      ),
      PushNotificationsStatus.requesting => ('Спрашиваем…', 'Секунду'),
      _ => ('Уведомления о заказе', 'Сообщим, когда заказ будет готов'),
    };

    final canAsk =
        status == PushNotificationsStatus.notRequested ||
        status == PushNotificationsStatus.error;

    return Container(
      margin: const EdgeInsets.only(bottom: Gap.block),
      padding: const EdgeInsets.all(Gap.lg),
      decoration: BoxDecoration(color: c.fillSoft, borderRadius: R.field),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(hint, style: Theme.of(context).textTheme.labelMedium),
              ],
            ),
          ),
          if (canAsk)
            PressScale(
              onTap: () async {
                Haptics.tap();
                await push.requestPermission();
              },
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 9,
                ),
                decoration: BoxDecoration(
                  color: c.accent,
                  borderRadius: R.pill,
                ),
                child: Text(
                  'Включить',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: c.surface,
                  ),
                ),
              ),
            ),
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
