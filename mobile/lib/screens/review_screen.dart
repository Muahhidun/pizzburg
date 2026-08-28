import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/motion.dart';
import '../i18n/strings.dart';

/// Анкета о заказе (DECISIONS §12.23).
///
/// Не звёзды. Прямая оценка даёт либо пять, либо один: человек не хочет
/// выносить приговор и уходит в крайности. Здесь он отвечает на факты —
/// вовремя ли, всё ли привезли, горячей ли была еда, — а оценку выводит
/// сервер. Отвечать можно не на всё: пропуск не занижает оценку.
class ReviewScreen extends StatefulWidget {
  final String orderId;
  final int orderNumber;

  const ReviewScreen({
    super.key,
    required this.orderId,
    required this.orderNumber,
  });

  @override
  State<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends State<ReviewScreen> {
  List<Map<String, dynamic>>? _questions;
  final Map<String, String> _answers = {};
  final _text = TextEditingController();
  bool _sending = false;
  bool _done = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final form = await context.read<ApiClient>().fetchReviewForm(
        widget.orderId,
      );
      if (!mounted) return;
      setState(() {
        _done = form['alreadyAnswered'] == true;
        _questions = ((form['questions'] ?? []) as List)
            .cast<Map<String, dynamic>>();
      });
    } catch (e) {
      if (mounted) setState(() => _error = _clean(e));
    }
  }

  Future<void> _submit() async {
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await context.read<ApiClient>().submitReview(
        widget.orderId,
        answers: _answers,
        text: _text.text,
      );
      if (!mounted) return;
      Haptics.success();
      setState(() => _done = true);
    } catch (e) {
      if (!mounted) return;
      await Haptics.warning();
      if (mounted) {
        setState(() {
          _error = _clean(e);
          _sending = false;
        });
      }
    }
  }

  String _clean(Object e) => e.toString().replaceFirst('Exception: ', '');

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final questions = _questions;

    return Scaffold(
      backgroundColor: c.page,
      body: SafeArea(
        child: ListView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.fromLTRB(
            Gap.screen,
            Gap.lg,
            Gap.screen,
            Gap.blockWide,
          ),
          children: [
            Row(
              children: [
                Padding(
                  padding: const EdgeInsets.only(right: Gap.md),
                  child: PressScale(
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
                ),
                Expanded(
                  child: Text(
                    _done ? S.thanks : S.howWasIt,
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: Gap.sm),
            Text(
              _done
                  ? S.willReadAndFix
                  : S.reviewIntro(widget.orderNumber),
              style: Theme.of(context).textTheme.labelMedium,
            ),

            if (_error != null) ...[
              const SizedBox(height: Gap.lg),
              Text(_error!, style: TextStyle(fontSize: 13, color: c.accent)),
            ],

            if (!_done && questions == null && _error == null)
              const Padding(
                padding: EdgeInsets.only(top: Gap.blockWide),
                child: Center(child: CircularProgressIndicator()),
              ),

            if (!_done && questions != null) ...[
              for (final question in questions) ...[
                const SizedBox(height: Gap.block),
                Text(
                  question['label']?.toString() ?? '',
                  style: Theme.of(
                    context,
                  ).textTheme.titleMedium?.copyWith(fontSize: 15),
                ),
                const SizedBox(height: Gap.md),
                Wrap(
                  spacing: Gap.sm,
                  runSpacing: Gap.sm,
                  children: [
                    for (final option
                        in ((question['options'] ?? []) as List)
                            .cast<Map<String, dynamic>>())
                      _OptionChip(
                        label: option['label']?.toString() ?? '',
                        selected:
                            _answers[question['id']] == option['id'],
                        onTap: () {
                          Haptics.selection();
                          setState(
                            () => _answers[question['id'].toString()] =
                                option['id'].toString(),
                          );
                        },
                      ),
                  ],
                ),
              ],

              const SizedBox(height: Gap.block),
              TextField(
                controller: _text,
                maxLines: 3,
                maxLength: 1000,
                decoration: InputDecoration(
                  hintText: S.addWords,
                  counterText: '',
                  filled: true,
                  fillColor: c.fillSoft,
                  border: OutlineInputBorder(
                    borderRadius: R.field,
                    borderSide: BorderSide.none,
                  ),
                ),
              ),

              const SizedBox(height: Gap.lg),
              PressScale(
                onTap: _answers.isEmpty || _sending ? null : _submit,
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: _answers.isEmpty ? c.fillSoft : c.accent,
                    borderRadius: R.pill,
                  ),
                  child: Text(
                    _sending ? S.sending : S.send,
                    style: TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w700,
                      color: _answers.isEmpty ? c.muted : c.surface,
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

class _OptionChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _OptionChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return PressScale.selection(
      onTap: onTap,
      child: AnimatedContainer(
        duration: Motion.base,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
        decoration: BoxDecoration(
          color: selected ? c.panel : c.fillSoft,
          borderRadius: R.pill,
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w600,
            color: selected ? c.surface : c.ink,
          ),
        ),
      ),
    );
  }
}
