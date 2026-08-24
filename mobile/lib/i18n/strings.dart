import 'lang.dart';

/// Тексты интерфейса.
///
/// Одна таблица вместо файлов .arb и кодогенерации: языка два, строки
/// правит тот же человек, что пишет экраны, и лишний шаг сборки здесь
/// стоил бы дороже, чем экономил. Русский и казахский стоят рядом в
/// одной строке — так видно, что перевод отстал, прямо в diff.
///
/// Названия блюд сюда не попадают: они приходят с сервера и правятся в
/// админке (DECISIONS §12.30).
class S {
  static String t(String ru, String kk) => L.pick(ru, kk);

  // ── Общее ──
  static String get language => t('Язык', 'Тіл');
  static String get retry => t('Попробовать снова', 'Қайталап көру');
  static String get cancel => t('Отмена', 'Болдырмау');
  static String get close => t('Закрыть', 'Жабу');
  static String get save => t('Сохранить', 'Сақтау');
  static String get loading => t('Загружаем…', 'Жүктелуде…');

  // ── Вкладки ──
  static String get tabMenu => t('Меню', 'Мәзір');
  static String get tabFavorites => t('Избранное', 'Таңдаулы');
  static String get tabCart => t('Корзина', 'Себет');
  static String get tabOrders => t('Заказы', 'Тапсырыстар');
  static String get tabProfile => t('Профиль', 'Профиль');

  // ── Пустые состояния корзины ──
  static String get cartEmpty => t('Пока пусто', 'Әзірге бос');
  static String get cartEmptyHint => t(
        'Можно повторить прошлый заказ — это быстрее всего',
        'Өткен тапсырысты қайталауға болады — бұл ең жылдам жол',
      );
  static String get openMenu => t('Открыть меню', 'Мәзірді ашу');

  // ── Вход ──
  static String get signIn => t('Вход', 'Кіру');
  static String get signInAction => t('Войти', 'Кіру');
  static String get enterFullPhone =>
      t('Введите номер полностью', 'Нөмірді толық енгізіңіз');
  static String get enterSmsCode =>
      t('Введите код из смс', 'СМС-тегі кодты енгізіңіз');
  static String get tryAgainShort =>
      t('Не получилось. Попробуйте ещё раз', 'Болмады. Тағы бір рет көріңіз');
  static String get smsCodeTitle => t('Код из смс', 'СМС-тегі код');
  static String get yourPhone => t('Ваш номер', 'Сіздің нөміріңіз');
  static String sentTo(String phone) =>
      t('Отправили на $phone', 'Жіберілді: $phone');
  static String get smsInsteadOfPassword => t(
        'Пришлём код в смс — он заменяет пароль',
        'СМС-пен код жібереміз — ол құпиясөзді алмастырады',
      );
  static String get codeHint => t('Код', 'Код');
  static String testModeCode(String code) => t(
        'Тестовый режим: код $code. Когда подключим смс, он придёт сообщением.',
        'Сынақ режимі: код $code. СМС қосылған соң ол хабарламамен келеді.',
      );
  static String get pleaseWait => t('Подождите…', 'Күте тұрыңыз…');
  static String get getCode => t('Получить код', 'Код алу');
  static String get changePhone => t('Изменить номер', 'Нөмірді өзгерту');

  // ── Заказы ──
  static String get statusNew => t('Ждём подтверждения', 'Растауды күтудеміз');
  static String get statusCooking => t('Готовим ваш заказ', 'Тапсырысыңызды дайындап жатырмыз');
  static String get statusReady => t('Готов', 'Дайын');
  static String get statusOnWay => t('Курьер в пути', 'Курьер жолда');
  static String get statusDelivered => t('Заказ доставлен', 'Тапсырыс жеткізілді');
  static String get statusCancelled => t('Отменён', 'Бас тартылды');
  static String get orders => t('Заказы', 'Тапсырыстар');
  static String get signInToSeeOrders =>
      t('Войдите, чтобы видеть свои заказы', 'Тапсырыстарыңызды көру үшін кіріңіз');
  static String get noOrdersYet => t('Заказов ещё не было', 'Әзірге тапсырыс болған жоқ');
  static String get repeat => t('Повтор', 'Қайталау');
  static String get finished => t('Завершён', 'Аяқталды');
  static String activeOrder(String number) =>
      t('Активный · № $number', 'Белсенді · № $number');
  static String get nothingFromThatOrder => t(
        'Из того заказа сегодня ничего нет',
        'Ол тапсырыстан бүгін ештеңе жоқ',
      );
  static String get orderMovedToCart =>
      t('Заказ перенесён в корзину', 'Тапсырыс себетке көшірілді');
  static String notMoved(String names) =>
      t('Не перенеслось: $names', 'Көшірілмеді: $names');

  /// «1 позиция / 2 позиции / 5 позиций». В казахском числительное не
  /// склоняет существительное — форма одна.
  static String positions(int n) {
    if (L.isKk) return 'позиция';
    if (n % 10 == 1 && n % 100 != 11) return 'позиция';
    if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) {
      return 'позиции';
    }
    return 'позиций';
  }

  static const _monthsRu = [
    'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
    'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
  ];
  static const _monthsKk = [
    'қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау',
    'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел',
  ];
  static List<String> get months => L.isKk ? _monthsKk : _monthsRu;

  // ── Избранное ──
  static String get favorites => t('Избранное', 'Таңдаулы');
  static String get signInToSave => t('Войдите, чтобы сохранять', 'Сақтау үшін кіріңіз');
  static String get favoritesTiedToPhone => t(
        'Избранное привязано к номеру телефона — оно останется с вами на любом устройстве',
        'Таңдаулы телефон нөміріне байланған — ол кез келген құрылғыда сізбен бірге қалады',
      );
  static String get loadFailed => t('Не удалось загрузить', 'Жүктеу мүмкін болмады');
  static String get repeatAction => t('Повторить', 'Қайталау');
  static String get nothingYet => t('Пока пусто', 'Әзірге бос');
  static String get tapHeartHint => t(
        'Нажмите на сердечко у блюда в меню — оно окажется здесь',
        'Мәзірдегі тағамның жүрекшесін басыңыз — ол осында пайда болады',
      );

  // ── Каталог ──
  static String get deliveryTo => t('Доставим на', 'Жеткіземіз');
  static String get pickupFrom => t('Заберёте из', 'Өзіңіз аласыз');
  static String get delivery => t('Доставка', 'Жеткізу');
  static String get pickup => t('Самовывоз', 'Өзі алып кету');
  static String get deliveryLower => t('доставка', 'жеткізу');
  static String get pickupLower => t('самовывоз', 'өзі алып кету');
  static String get deliveryClosed => t('Доставка закрыта', 'Жеткізу жабық');
  static String get closedNow => t('Сейчас закрыто', 'Қазір жабық');
  static String get yourOrder => t('Ваш заказ', 'Сіздің тапсырысыңыз');
  static String get howWasIt => t('Как всё прошло?', 'Бәрі қалай өтті?');
  static String get sameOrderAgain => t('Тот же заказ?', 'Сол тапсырыс па?');
  static String get menuFailed => t('Меню не загрузилось', 'Мәзір жүктелмеді');
  static String get noServerHint => t(
        'Не получается связаться с сервером. Проверьте интернет — корзина сохранена.',
        'Серверге қосыла алмай тұрмыз. Интернетті тексеріңіз — себет сақталды.',
      );
  static String attemptLine(int attempt, String message) =>
      t('Попытка $attempt · $message', '$attempt-әрекет · $message');
  static String get temporarilyUnavailable =>
      t('Временно недоступно', 'Уақытша қолжетімсіз');
  static String get hit => t('хит', 'хит');
  static String get none => t('нет', 'жоқ');
  static String cartWithCount(int count) =>
      t('Корзина · $count', 'Себет · $count');
  static String get findDish => t('Найти блюдо', 'Тағам іздеу');
  static String get nothingFound => t('Ничего не нашли', 'Ештеңе табылмады');
  static String noDishesFor(String query) => t(
        'По запросу «$query» блюд нет. Проверьте написание или посмотрите меню целиком.',
        '«$query» бойынша тағам жоқ. Жазылуын тексеріңіз немесе мәзірді толық қараңыз.',
      );
  static String get showWholeMenu => t('Показать всё меню', 'Бүкіл мәзірді көрсету');

  // ── Карточка товара ──
  static String get addToCart => t('В корзину', 'Себетке');
  static String get saveFailed =>
      t('Не удалось сохранить — попробуйте ещё раз', 'Сақталмады — тағы көріңіз');
  static String get outToday => t('Сегодня закончилась', 'Бүгін таусылды');
  static String get outTodayHint => t(
        'Вернём в меню, когда привезут продукты. Можем написать, как только появится.',
        'Өнім жеткізілген соң мәзірге қайтарамыз. Пайда болғанда хабарлай аламыз.',
      );
  static String get willNotifyWhenBack => t(
        'Напишем, когда блюдо вернётся в меню',
        'Тағам мәзірге оралғанда хабарлаймыз',
      );
  static String get notifyMe => t('Сообщить о поступлении', 'Түскенде хабарлаңыз');
  static String get similarAvailable => t('Похожее в наличии', 'Ұқсас тағамдар бар');

  // ── Шкала статусов в шапке каталога ──
  static String get stageSentToKitchen =>
      t('Отправлен на кухню', 'Асханаға жіберілді');
  static String get stageAccepted => t('Принят кухней', 'Асхана қабылдады');

  // ── Шапка: режим и адрес ──
  static String get closedShort => t('закрыто', 'жабық');
  static String get pickupOnlyShort =>
      t('только самовывоз', 'тек өзі алып кету');
  static String until(String time) => t('до $time', '$time дейін');
  static String get specifyAddress => t('Укажите адрес', 'Мекенжайды көрсетіңіз');
  static String get needYourAnswer => t('Нужен ваш ответ', 'Жауабыңыз қажет');
  static String get whereToDeliver => t('Куда доставить', 'Қайда жеткіземіз');
  static String flat(String value) => t('кв. $value', '$value пәтер');
  static String get addNewAddress =>
      t('+ Добавить новый адрес', '+ Жаңа мекенжай қосу');
  static String get rateLastOrder =>
      t('Оцените прошлый заказ', 'Өткен тапсырысты бағалаңыз');
  static String get rateLastOrderHint => t(
        'Пара нажатий — и мы будем знать, что чинить',
        'Бірер басу — және бізге нені түзету керегі белгілі болады',
      );

  // ── Сообщения ──
  static String get messages => t('Сообщения', 'Хабарламалар');
  static String get quietHere => t('Пока тихо', 'Әзірге тыныш');
  static String get quietHereHint => t(
        'Акции и новости заведения появятся здесь',
        'Акциялар мен жаңалықтар осында пайда болады',
      );

  static const _monthsFullRu = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  static const _monthsFullKk = [
    'қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым',
    'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан',
  ];
  static List<String> get monthsFull =>
      L.isKk ? _monthsFullKk : _monthsFullRu;

  // ── Анкета качества ──
  static String get thanks => t('Спасибо', 'Рақмет');
  static String get willReadAndFix => t(
        'Мы прочитаем и разберёмся, если что-то пошло не так.',
        'Оқып шығамыз, бірдеңе дұрыс болмаса — реттейміз.',
      );
  static String reviewIntro(int number) => t(
        'Заказ № $number. Отвечать на всё не обязательно.',
        '№ $number тапсырыс. Барлығына жауап беру міндетті емес.',
      );
  static String get addWords => t('Хотите добавить словами?', 'Сөзбен қосқыңыз келе ме?');
  static String get sending => t('Отправляем…', 'Жіберілуде…');
  static String get send => t('Отправить', 'Жіберу');
}
