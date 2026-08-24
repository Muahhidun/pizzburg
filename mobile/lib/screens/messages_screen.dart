import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../widgets/motion.dart';
import '../i18n/strings.dart';

/// Лента сообщений: акции, новости, объявления заведения.
///
/// Пуш живёт секунды — лента остаётся: сюда клиент возвращается за
/// условиями акции. Публичная, гости видят наравне с вошедшими.
class MessagesScreen extends StatefulWidget {
  const MessagesScreen({super.key});

  /// Ключ отметки «прочитано»: profile-строка сравнивает с ним дату
  /// свежего сообщения, чтобы показать точку непрочитанного
  static const readAtKey = 'pizzburg_messages_read_at';

  @override
  State<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends State<MessagesScreen> {
  List<FeedMessage>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final items = await context.read<ApiClient>().fetchMessages();
      if (!mounted) return;
      setState(() {
        _items = items;
        _error = null;
      });
      // Открытие ленты и есть прочтение: отдельного «отметить прочитанным»
      // клиенту не нужно
      if (items.isNotEmpty) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(
          MessagesScreen.readAtKey,
          items.first.createdAt.toIso8601String(),
        );
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final items = _items;

    return Scaffold(
      backgroundColor: c.page,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Gap.screen,
                Gap.md,
                Gap.screen,
                Gap.sm,
              ),
              child: Row(
                children: [
                  PressScale(
                    onTap: () => Navigator.pop(context),
                    child: Container(
                      width: 36,
                      height: 36,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: c.fillSoft,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(Icons.arrow_back, size: 18, color: c.ink),
                    ),
                  ),
                  const SizedBox(width: Gap.md),
                  Text(
                    S.messages,
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                ],
              ),
            ),
            Expanded(
              child: _error != null
                  ? _Message(
                      icon: Icons.wifi_off,
                      title: S.loadFailed,
                      text: _error!,
                      action: S.repeatAction,
                      onAction: _load,
                    )
                  : items == null
                  ? const Center(child: CircularProgressIndicator())
                  : items.isEmpty
                  ? _Message(
                      icon: Icons.notifications_none,
                      title: S.quietHere,
                      text: S.quietHereHint,
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(
                          Gap.screen,
                          Gap.sm,
                          Gap.screen,
                          Gap.blockWide,
                        ),
                        itemCount: items.length,
                        separatorBuilder: (_, _) =>
                            const SizedBox(height: Gap.md),
                        itemBuilder: (context, i) => StaggeredEntrance(
                          index: i,
                          child: _MessageCard(message: items[i]),
                        ),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MessageCard extends StatelessWidget {
  final FeedMessage message;

  const _MessageCard({required this.message});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final d = message.createdAt;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(Gap.lg),
      decoration: BoxDecoration(color: c.fillSoft, borderRadius: R.block),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (message.imageUrl != null && message.imageUrl!.isNotEmpty) ...[
            ClipRRect(
              borderRadius: R.thumb,
              child: Image.network(
                message.imageUrl!,
                width: double.infinity,
                height: 160,
                fit: BoxFit.cover,
                // Битая картинка не должна ронять карточку с текстом акции
                errorBuilder: (_, _, _) => const SizedBox.shrink(),
              ),
            ),
            const SizedBox(height: Gap.md),
          ],
          Text(
            '${d.day} ${S.monthsFull[d.month - 1]}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: Gap.xs),
          Text(message.title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: Gap.sm),
          Text(
            message.body,
            style: const TextStyle(fontSize: 13.5, height: 1.45),
          ),
        ],
      ),
    );
  }
}

class _Message extends StatelessWidget {
  final IconData icon;
  final String title;
  final String text;
  final String? action;
  final VoidCallback? onAction;

  const _Message({
    required this.icon,
    required this.title,
    required this.text,
    this.action,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Center(
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
              child: Icon(icon, size: 34, color: c.accent),
            ),
            const SizedBox(height: Gap.block),
            Text(
              title,
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontSize: 20,
              ),
            ),
            const SizedBox(height: Gap.sm),
            Text(
              text,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (action != null) ...[
              const SizedBox(height: Gap.lg),
              PressScale(
                onTap: onAction,
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
                    action!,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: c.ink,
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
