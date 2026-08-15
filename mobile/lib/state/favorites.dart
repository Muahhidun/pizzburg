import 'package:flutter/foundation.dart';
import '../api/api_client.dart';

/// Избранное клиента.
///
/// Держим отдельным состоянием, а не в профиле: сердечко нажимают из
/// каталога, из карточки товара и из самого избранного — все три места
/// должны мгновенно увидеть изменение.
class Favorites extends ChangeNotifier {
  final ApiClient api;
  final Set<String> _ids = {};
  bool _loaded = false;

  Favorites(this.api);

  bool get loaded => _loaded;
  int get count => _ids.length;
  bool contains(String productId) => _ids.contains(productId);

  Future<void> restore() async {
    try {
      final ids = await api.fetchFavoriteIds();
      _ids
        ..clear()
        ..addAll(ids);
      _loaded = true;
      notifyListeners();
    } catch (_) {
      // гость или сеть — сердечки просто останутся пустыми
    }
  }

  void clear() {
    _ids.clear();
    _loaded = false;
    notifyListeners();
  }

  /// Переключает и возвращает новое состояние.
  ///
  /// Меняем локально сразу, до ответа сервера: сердечко должно
  /// закрашиваться в момент касания, а не через полсекунды. При ошибке
  /// откатываем — иначе интерфейс соврёт о том, что сохранено.
  Future<bool> toggle(String productId) async {
    final was = _ids.contains(productId);
    was ? _ids.remove(productId) : _ids.add(productId);
    notifyListeners();

    try {
      final now = await api.toggleFavorite(productId);
      if (now != !was) {
        now ? _ids.add(productId) : _ids.remove(productId);
        notifyListeners();
      }
      return now;
    } catch (_) {
      was ? _ids.add(productId) : _ids.remove(productId);
      notifyListeners();
      rethrow;
    }
  }
}
