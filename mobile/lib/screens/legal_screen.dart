import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../state/auth.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../widgets/motion.dart';

/// Чтение одного документа.
///
/// Текст приходит с сервера как обычный текст, а не как HTML: документы
/// пишет владелец или юрист, и разметку им вести негде.
class LegalDocumentScreen extends StatefulWidget {
  final String type;
  final String? title;

  const LegalDocumentScreen({super.key, required this.type, this.title});

  @override
  State<LegalDocumentScreen> createState() => _LegalDocumentScreenState();
}

class _LegalDocumentScreenState extends State<LegalDocumentScreen> {
  LegalDocument? _doc;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final doc = await context.read<ApiClient>().fetchLegalDocument(
        widget.type.toLowerCase(),
      );
      if (mounted) setState(() => _doc = doc);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final doc = _doc;
    return Scaffold(
      backgroundColor: c.page,
      body: SafeArea(
        child: _error != null
            ? _LegalMessage(text: _error!, onRetry: _load)
            : ListView(
                padding: const EdgeInsets.fromLTRB(
                  Gap.screen,
                  Gap.md,
                  Gap.screen,
                  Gap.blockWide,
                ),
                children: [
                  Row(
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
                    ],
                  ),
                  const SizedBox(height: Gap.lg),
                  Text(
                    doc?.displayTitle ?? widget.title ?? 'Документ',
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  if (doc != null) ...[
                    const SizedBox(height: Gap.sm),
                    Text(
                      'Редакция ${doc.version}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: Gap.block),
                    // Документ читают редко, но читают внимательно:
                    // межстрочный больше обычного.
                    SelectableText(
                      doc.content,
                      style: const TextStyle(fontSize: 14, height: 1.6),
                    ),
                  ] else
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 48),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                ],
              ),
      ),
    );
  }
}

/// Экран согласия: показывается, когда сервер сообщил о непринятых редакциях.
///
/// Закрыть его свайпом нельзя — согласие обязательно, а тихий пропуск
/// означал бы заказ без принятой оферты.
class LegalConsentScreen extends StatefulWidget {
  const LegalConsentScreen({super.key});

  @override
  State<LegalConsentScreen> createState() => _LegalConsentScreenState();
}

class _LegalConsentScreenState extends State<LegalConsentScreen> {
  bool _agreed = false;
  bool _busy = false;
  String? _error;
  List<LegalDocument> _docs = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final pending = context.read<AuthState>().pendingLegal;
      final all = await context.read<ApiClient>().fetchLegalDocuments();
      if (mounted) {
        setState(() {
          _docs = all.where((d) => pending.contains(d.type)).toList();
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _accept() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<AuthState>().acceptLegal();
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Условия использования'),
          automaticallyImplyLeading: false,
        ),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Чтобы пользоваться приложением и оформлять заказы, '
                  'примите документы:',
                ),
                const SizedBox(height: 12),
                Expanded(
                  child: _docs.isEmpty
                      ? const Center(child: CircularProgressIndicator())
                      : ListView(
                          children: [
                            for (final doc in _docs)
                              Card(
                                child: ListTile(
                                  title: Text(doc.displayTitle),
                                  subtitle: Text('Редакция ${doc.version}'),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: () => Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) => LegalDocumentScreen(
                                        type: doc.type,
                                        title: doc.displayTitle,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                ),
                CheckboxListTile(
                  value: _agreed,
                  onChanged: _busy
                      ? null
                      : (v) => setState(() => _agreed = v ?? false),
                  controlAffinity: ListTileControlAffinity.leading,
                  contentPadding: EdgeInsets.zero,
                  title: const Text(
                    'Я прочитал и принимаю условия',
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      _error!,
                      style: const TextStyle(color: Colors.red),
                    ),
                  ),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    // Кнопка неактивна, пока документы не загрузились: принять
                    // то, чего не показали, клиент не должен.
                    onPressed: (_agreed && !_busy && _docs.isNotEmpty)
                        ? _accept
                        : null,
                    child: _busy
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Принять и продолжить'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LegalMessage extends StatelessWidget {
  final String text;
  final VoidCallback onRetry;

  const _LegalMessage({required this.text, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(text, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: onRetry, child: const Text('Повторить')),
          ],
        ),
      ),
    );
  }
}
