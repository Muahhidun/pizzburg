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

  // ── Корзина ──
  static String get cart => t('Корзина', 'Себет');
  static String get noSuchPromo => t('Такого промокода нет', 'Мұндай промокод жоқ');
  static String addMoreForGift(String sum, String gift) => t(
        'Добавьте ещё на $sum — $gift в подарок',
        'Тағы $sum қосыңыз — сыйлыққа $gift',
      );
  static String get checkout => t('Оформить', 'Рәсімдеу');
  static String get gift => t('Подарок', 'Сыйлық');
  static String get addToOrder => t('Добавить к заказу', 'Тапсырысқа қосу');
  static String get promoCode => t('Промокод', 'Промокод');
  static String get apply => t('Применить', 'Қолдану');
  static String promoApplied(String code) =>
      t('Промокод $code применён', '$code промокоды қолданылды');
  static String get spendPoints => t('Списать баллы', 'Ұпайларды жұмсау');
  static String get unavailableShort => t('недоступно', 'қолжетімсіз');
  static String pointsAvailable(int balance) =>
      t('$balance доступно', '$balance қолжетімді');
  static String get pointsBlockedByPromo => t(
        'В заказе есть акция — баллы к ней не добавляются. Уберите акцию, если хотите списать баллы.',
        'Тапсырыста акция бар — оған ұпай қосылмайды. Ұпай жұмсағыңыз келсе, акцияны алып тастаңыз.',
      );
  static String get dontSpend => t('Не списывать', 'Жұмсамау');
  static String get maximum => t('Максимум', 'Барынша');
  static String get goods => t('Товары', 'Тауарлар');
  static String get free => t('бесплатно', 'тегін');
  static String get promoGift => t('Подарок по акции', 'Акция бойынша сыйлық');
  static String get points => t('Баллы', 'Ұпайлар');

  // ── Оформление ──
  static String get checkoutTitle => t('Оформление', 'Рәсімдеу');
  static String get whereToBring => t('Куда привезти', 'Қайда әкелеміз');
  static String get newAddress => t('+ Новый адрес', '+ Жаңа мекенжай');
  static String get whereToPickUp => t('Откуда забрать', 'Қайдан аласыз');
  static String get name => t('Имя', 'Аты');
  static String get phone => t('Телефон', 'Телефон');
  static String get time => t('Время', 'Уақыт');
  static String get asap => t('Ближайшее', 'Ең жақын');
  static String get payment => t('Оплата', 'Төлем');
  static String get cash => t('Наличными', 'Қолма-қол');
  static String get cardToCourier => t('Картой курьеру', 'Курьерге картамен');
  static String get online => t('Онлайн', 'Онлайн');
  static String get prepareChangeFrom =>
      t('Подготовить сдачу с', 'Қайырымды дайындау');
  static String get bigBillHint => t(
        'Сумма заказа больше обычных купюр — скажите курьеру, с чего готовить сдачу',
        'Тапсырыс сомасы кәдімгі купюралардан үлкен — курьерге қайырымды неден дайындау керегін айтыңыз',
      );
  static String get commentToCourier =>
      t('Комментарий курьеру', 'Курьерге түсініктеме');
  static String get placeOrder => t('Заказать', 'Тапсырыс беру');
  static String get soon => t('скоро', 'жақында');
  static String entrance(String value) =>
      t('подъезд $value', '$value кіреберіс');
  static String floor(String value) => t('этаж $value', '$value қабат');
  static String get flatLabel => t('Квартира', 'Пәтер');
  static String get entranceLabel => t('Подъезд', 'Кіреберіс');
  static String get floorLabel => t('Этаж', 'Қабат');
  static String get byTappingYouAgree =>
      t('Нажимая кнопку, вы соглашаетесь с ', 'Түймені басу арқылы сіз ');
  static String get publicOffer => t('Публичная оферта', 'Жария оферта');
  static String get offerLink => t('офертой', 'офертамен');
  static String get and => t(' и ', ' және ');
  static String get privacyPolicy =>
      t('Политика конфиденциальности', 'Құпиялылық саясаты');
  static String get privacyLink => t(
        'политикой обработки данных',
        'деректерді өңдеу саясатымен келісесіз',
      );

  /// Адрес точки самовывоза. Пока зашит: точка одна, и настройка ради
  /// одной строки была бы дороже строки.
  static String get pickupPointShort =>
      t('Ауэзова 47б, MaxiMall', 'Әуезов 47б, MaxiMall');
  static String get pickupPointFull => t(
        'Ауэзова 47б, ТРЦ «MaxiMall», 3 этаж',
        'Әуезов 47б, «MaxiMall» СОО, 3-қабат',
      );

  // ── Экран заказа ──
  static String get statusReadyPickup => t('Готов к выдаче', 'Беруге дайын');
  static String get statusCancelledOrder => t('Заказ отменён', 'Тапсырыс тоқтатылды');
  static String get passedToCashier =>
      t('Передали кассиру — скоро ответим', 'Кассирге жеткіздік — жақында жауап береміз');
  static String orderNo(int number) => t('Заказ № $number', '№ $number тапсырыс');
  static String get onePositionMissing =>
      t('Одной позиции не оказалось', 'Бір позиция табылмады');
  static String get canStillCancel => t('Ещё можно отменить', 'Әлі болдырмауға болады');
  static String cancelWindowLeft(int seconds) => t(
        'Отменить без последствий можно ещё $seconds с — заведение о заказе пока не знает.',
        'Салдарсыз болдырмауға тағы $seconds с бар — мекеме тапсырыс туралы әлі білмейді.',
      );
  static String get cancelling => t('Отменяем…', 'Тоқтатудамыз…');
  static String get cancelOrder => t('Отменить заказ', 'Тапсырысты тоқтату');
  static String get deliveredLower => t('доставлен', 'жеткізілді');
  static String get inProgressLower => t('в работе', 'орындалуда');
  static String get acceptedPickupHint => t(
        'Заказ приняли и готовят. Мы позвоним, когда его можно будет забрать.',
        'Тапсырыс қабылданды, дайындалып жатыр. Дайын болғанда қоңырау шаламыз.',
      );
  static String get acceptedDeliveryHint => t(
        'Заказ приняли и готовят. Как только он будет готов, курьер привезёт его и занесёт до двери.',
        'Тапсырыс қабылданды, дайындалып жатыр. Дайын болған соң курьер есікке дейін жеткізеді.',
      );
  static String get outOfStockLower => t('нет в наличии', 'қоймада жоқ');
  static String get giftLower => t('подарок', 'сыйлық');
  static String get cancelUnavailableCourier => t(
        'Отмена недоступна — заказ уже у курьера',
        'Болдырмау мүмкін емес — тапсырыс курьерде',
      );
  static String get positionsMissing =>
      t('Позиции нет в наличии', 'Позиция қоймада жоқ');
  static String missingList(String names) => t('Нет: $names', 'Жоқ: $names');
  static String get shortageQuestion => t(
        'Остальное уже готовится. Везём без этой позиции — или отменяем заказ целиком?',
        'Қалғаны дайындалып жатыр. Осы позициясыз әкелейік пе — әлде тапсырысты толық тоқтатайық па?',
      );
  static String get shortageTimeUp => t(
        'Время вышло — сейчас оформим доставку остального',
        'Уақыт бітті — қалғанын жеткізуге рәсімдейміз',
      );
  static String shortageCountdown(int minutes, String seconds) => t(
        'Если не ответите за $minutes:$seconds, привезём остальное',
        '$minutes:$seconds ішінде жауап бермесеңіз, қалғанын әкелеміз',
      );
  static String get oneSecond => t('Секунду…', 'Бір секунд…');
  static String get bringWithoutIt => t('Везите без неё', 'Онсыз әкеліңіз');
  static String get cancelWholeOrder =>
      t('Отменить заказ целиком', 'Тапсырысты толық тоқтату');
  static String positionsShort(int count, String type) =>
      t('$count поз. · $type', '$count поз. · $type');
  static String get weGotYourMessages =>
      t('Мы получили ваши сообщения', 'Хабарламаларыңызды алдық');
  static String writeAgainIn(String left) =>
      t('Написать снова можно через $left', 'Қайта жазуға $left кейін болады');
  static String get writeMore => t('Написать ещё', 'Тағы жазу');
  static String get writeToUs => t('Написать нам', 'Бізге жазу');
  static String get cashierSeesThem =>
      t('Кассир их видит и разбирается', 'Кассир оларды көріп, реттеп жатыр');
  static String sentOf(int sent, int limit) =>
      t('Отправлено $sent из $limit', '$limit-тен $sent жіберілді');
  static String secondsShort(int seconds) => t('$seconds с', '$seconds с');

  // ── Написать нам: темы ──
  static String get topicWhere => t('Где мой заказ?', 'Тапсырысым қайда?');
  static String get topicAddress => t('Поменять адрес', 'Мекенжайды өзгерту');
  static String get topicMissing => t('Забыли позицию', 'Позицияны ұмытыпсыздар');
  static String get topicOther => t('Другое', 'Басқа');
  static String get whatHappened => t('Что случилось?', 'Не болды?');
  static String get willPassWithOrderNumber => t(
        'Передадим кассиру вместе с номером заказа',
        'Тапсырыс нөмірімен бірге кассирге жеткіземіз',
      );
  static String get tellWhatIsWrong =>
      t('Расскажите, что не так', 'Не дұрыс емес екенін айтыңыз');
  static String get fewWordsIfNeeded =>
      t('Пара слов, если нужно', 'Қажет болса, бірер сөз');
  static String get whyCancelling => t('Почему отменяете?', 'Неге тоқтатып жатырсыз?');
  static String get keepOrder => t('Оставить заказ', 'Тапсырысты қалдыру');

  // ── Профиль ──
  static String get signInByPhone => t('Войдите по телефону', 'Телефон арқылы кіріңіз');
  static String get signInByPhoneAction =>
      t('Войти по телефону', 'Телефон арқылы кіру');
  static String get afterSignInHint => t(
        'Баллы, история заказов и сохранённые адреса — после входа',
        'Ұпайлар, тапсырыс тарихы және сақталған мекенжайлар — кіргеннен кейін',
      );
  static String get promosAndNews => t('Акции и новости', 'Акциялар мен жаңалықтар');
  static String get profile => t('Профиль', 'Профиль');
  static String toNextLevel(String sum, int pct) => t(
        'Ещё $sum заказов — и кэшбэк станет $pct%',
        'Тағы $sum тапсырыс — кэшбэк $pct% болады',
      );
  static String get pointsHistory => t('История баллов', 'Ұпай тарихы');
  static String get noOperationsYet => t('Операций ещё не было', 'Әзірге операция болған жоқ');
  static String get signOut => t('Выйти', 'Шығу');
  static String get pointEqualsTenge => t(
        '1 балл = 1 ₸, списывайте любой суммой',
        '1 ұпай = 1 ₸, кез келген сомамен жұмсаңыз болады',
      );
  static String cashbackPercent(int pct) => t('Кэшбэк $pct%', 'Кэшбэк $pct%');
  static String levelOf(int level, int total) =>
      t('Уровень $level из $total', '$total деңгейдің $level-сі');
  static String levelNamed(String name, int level, int total) =>
      t('$name · $level из $total', '$name · $total-тен $level');
  static String get earned => t('Начислено', 'Есептелді');
  static String get spent => t('Списано', 'Жұмсалды');
  static String get requisites => t('Реквизиты', 'Деректемелер');
  static String get osmCredit => t(
        'Адреса города — данные © участников OpenStreetMap, ODbL',
        'Қала мекенжайлары — © OpenStreetMap қатысушыларының деректері, ODbL',
      );
  static String get appSettings => t('Настройки приложения', 'Қосымша баптаулары');
  static String get appearance => t('Оформление', 'Безендіру');

  // ── Настройки ──
  static String get settings => t('Настройки', 'Баптаулар');
  static String get vibration => t('Вибрация', 'Дірілдеу');
  static String get vibrationHint => t(
        'Отклик при выборе и подтверждении',
        'Таңдау мен растау кезіндегі жауап',
      );
  static String get pushQuietTitle =>
      t('Уведомления приходят тихо', 'Хабарламалар үнсіз келеді');
  static String get pushQuietHint => t(
        'Без баннера и звука. Включить их: Настройки телефона → PizzBurg',
        'Баннерсіз және дыбыссыз. Қосу: телефон баптаулары → PizzBurg',
      );
  static String get pushOnTitle => t('Уведомления включены', 'Хабарламалар қосулы');
  static String get pushOrderHint => t(
        'Сообщим, когда заказ будет готов',
        'Тапсырыс дайын болғанда хабарлаймыз',
      );
  static String get pushOffTitle => t('Уведомления выключены', 'Хабарламалар өшірулі');
  static String get pushOffHint => t(
        'Включить можно в Настройках телефона → PizzBurg → Уведомления',
        'Қосу: телефон баптаулары → PizzBurg → Хабарламалар',
      );
  static String get asking => t('Спрашиваем…', 'Сұрап жатырмыз…');
  static String get justASecond => t('Секунду', 'Бір секунд');
  static String get orderNotifications =>
      t('Уведомления о заказе', 'Тапсырыс туралы хабарламалар');
  static String get turnOn => t('Включить', 'Қосу');

  // ── Адрес ──
  static String get pickStreetFromHints => t(
        'Выберите улицу и дом из подсказок',
        'Көше мен үйді ұсыныстардан таңдаңыз',
      );
  static String get newAddressTitle => t('Новый адрес', 'Жаңа мекенжай');
  static String get saving => t('Сохраняем…', 'Сақталуда…');
  static String get saveAddress => t('Сохранить адрес', 'Мекенжайды сақтау');
  static String get street => t('Улица', 'Көше');
  static String get house => t('Дом', 'Үй');
  static String get savedOperatorWillCheck => t(
        'Записали. Оператор проверит адрес перед доставкой',
        'Жазып алдық. Оператор жеткізу алдында мекенжайды тексереді',
      );
  static String get operatorWillCheck => t(
        'Оператор проверит адрес перед доставкой',
        'Оператор жеткізу алдында мекенжайды тексереді',
      );
  static String get streetInDirectory =>
      t('Улица есть в справочнике города', 'Көше қала анықтамалығында бар');
  static String get addressInDirectory =>
      t('Адрес есть в справочнике города', 'Мекенжай қала анықтамалығында бар');
  static String get myAddressNotListed =>
      t('Моего адреса нет в списке', 'Менің мекенжайым тізімде жоқ');

  // ── Документы ──
  static String get document => t('Документ', 'Құжат');
  static String edition(int version) =>
      t('Редакция $version', '$version редакциясы');
  static String get termsTitle => t('Условия использования', 'Пайдалану шарттары');
  static String get acceptDocsHint => t(
        'Чтобы пользоваться приложением и оформлять заказы, примите документы:',
        'Қосымшаны пайдалану және тапсырыс беру үшін құжаттарды қабылдаңыз:',
      );
  static String get iAcceptTerms =>
      t('Я прочитал и принимаю условия', 'Оқыдым және шарттарды қабылдаймын');
  static String get acceptAndContinue =>
      t('Принять и продолжить', 'Қабылдап, жалғастыру');

  static String httpError(int code) => t('Ошибка $code', '$code қатесі');

  // ── Названия тем ──
  static String themeName(String id) => switch (id) {
        'ember' => t('Оранжевая', 'Қызғылт сары'),
        'olive' => t('Оливковая', 'Зәйтүн'),
        'night' => t('Тёмная', 'Қараңғы'),
        _ => t('Базовая', 'Негізгі'),
      };
  static String themeHint(String id) => switch (id) {
        'ember' => t('Оранжевый, как на вывеске', 'Маңдайшадағыдай қызғылт сары'),
        'olive' => t('Приглушённая, без ярких пятен', 'Басыңқы, ашық дақсыз'),
        'night' => t('Для вечера и тёмного экрана', 'Кешке және қараңғы экранға'),
        _ => t('Чернила, кобальт, лайм', 'Сия, кобальт, лайм'),
      };

  // ── Метки товара ──
  static String get badgeHit => t('Хит', 'Хит');
  static String get badgeSpicy => t('Острое', 'Ащы');
  static String get badgeNew => t('Новинка', 'Жаңалық');

  // ── Проверка полей ──
  static String get nameTooShort => t('Имя слишком короткое', 'Аты тым қысқа');
  static String get lettersOnly => t(
        'Только буквы, пробел, дефис или апостроф',
        'Тек әріптер, бос орын, дефис немесе апостроф',
      );
  static String get specifyStreet => t('Укажите улицу', 'Көшені көрсетіңіз');
  static String get checkStreetName =>
      t('Проверьте название улицы', 'Көше атауын тексеріңіз');
  static String get specifyHouse => t('Укажите дом', 'Үйді көрсетіңіз');
  static String get houseExample => t('Например: 47Б или 12/1', 'Мысалы: 47Б немесе 12/1');
  static String get flatExample => t('Например: 69 или 6А', 'Мысалы: 69 немесе 6А');
  static String get numberOnly => t('Только номер', 'Тек нөмір');
  static String get floorExample => t('Например: 9 или -1', 'Мысалы: 9 немесе -1');
  static String get max300Chars =>
      t('Не больше 300 символов', '300 таңбадан аспауы керек');

  // ── Удаление аккаунта ──
  static String get deleteAccount => t('Удалить аккаунт', 'Аккаунтты жою');
  static String get deleteAccountTitle =>
      t('Удалить аккаунт?', 'Аккаунтты жоямыз ба?');
  static String get deleteAccountWhatGoes => t(
        'Пропадут баллы, сохранённые адреса, избранное и вход по этому номеру. Восстановить нельзя.',
        'Ұпайлар, сақталған мекенжайлар, таңдаулылар және осы нөмірмен кіру жойылады. Қалпына келтіру мүмкін емес.',
      );
  static String get deleteAccountWhatStays => t(
        'Заказы останутся у заведения без вашего адреса — они нужны для отчётности.',
        'Тапсырыстар мекенжайсыз мекемеде қалады — олар есеп үшін қажет.',
      );
  static String get deleteAccountConfirm => t('Да, удалить', 'Иә, жою');
  static String get deleting => t('Удаляем…', 'Жойылуда…');
  static String get accountDeleted => t('Аккаунт удалён', 'Аккаунт жойылды');
}
