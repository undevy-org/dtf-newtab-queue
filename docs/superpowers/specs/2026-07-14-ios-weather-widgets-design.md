# Дизайн: iOS-приложение с погодными виджетами (home screen + lock screen)

Дата: 2026-07-14
Статус: Утверждено пользователем, ожидает review записанной спецификации

## Контекст

Расширение `dtf-newtab-queue` уже показывает четыре погодные метрики под
новостной карточкой на странице новой вкладки
(`docs/superpowers/specs/2026-07-12-weather-widget-design.md`,
`docs/superpowers/specs/2026-07-13-weather-and-news-layout-refinement-design.md`):
температура (с сравнением вчера/сегодня в `src/weatherPresentation.js`),
вероятность дождя сегодня, AQI (US AQI) + PM2.5, УФ-индекс (текущий + дневной
максимум). Все данные — три бесключевых эндпоинта Open-Meteo
(`src/weatherApi.js`: forecast, air-quality, geocoding), город задаётся
вручную и хранится в `chrome.storage.sync`, кэш ответа — 30 минут в
`chrome.storage.local`, оркестрация в `src/weatherService.js`.

Пользователь хочет получить те же четыре метрики на iOS в виде системных
виджетов — на домашнем экране и на экране блокировки. Chrome-расширение
(JS/HTML/CSS) не может выполняться на iOS home screen — там работает только
WidgetKit, нативный SwiftUI-рантайм с собственной моделью обновления
(таймлайны, управляемые системой, а не открытием страницы). Поэтому это не
порт кода, а новое нативное приложение, которое переиспользует только
бизнес-логику расширения (пороги тонов AQI/УФ, формат чисел, TTL-модель
кэша) — переписанную на Swift вручную, один раз, а не импортированную.

Реализация ведётся в отдельном новом git-репозитории: Xcode-проект
несовместим по тулингу (Swift Package Manager, `.xcodeproj`, подпись,
ассеты) с этим JS-репозиторием, и код не шарится напрямую. Эта спека фиксирует
дизайн и хранится здесь, в `dtf-newtab-queue`, так как здесь проходил
брейнсторминг и здесь источник переносимой бизнес-логики; сама реализация
(Xcode-проект) будет жить в новом репозитории.

## Цели

1. Показать те же 4 метрики (температура, дождь, AQI+PM2.5, УФ) как 4
   отдельных вида системных виджетов iOS: `WeatherWidgets.Temperature`,
   `.Precipitation`, `.AQI`, `.UVIndex`.
2. Каждый вид виджета поддерживает домашний экран (`.systemSmall`) и экран
   блокировки (`.accessoryCircular`, `.accessoryRectangular`,
   `.accessoryInline`) — 4 виджета × 4 семейства.
3. Источник данных — те же три бесключевых эндпоинта Open-Meteo, что и в
   расширении; ручной ввод города (без CoreLocation/geolocation permission);
   кэш с TTL 30 минут через App Group, читаемый/пишемый и приложением, и
   виджетами.
4. Приложение (иконка на springboard) — только экран настройки/смены города;
   сами метрики видны исключительно через виджеты, дублирующего дашборда нет.
5. Личное использование: сборка и установка через Xcode с Personal Team (без
   платного Apple Developer Program), без App Store/TestFlight.

## Не цели

- Не портировать JS-код расширения буквально — бизнес-логика (пороги
  AQI/УФ, TTL-оркестрация, нормализация ответов Open-Meteo) переписывается на
  Swift с нуля вручную; между репозиториями нет общего исполняемого кода.
- Не использовать geolocation/CoreLocation — город задаётся вручную, как в
  расширении.
- Не делать один configurable-виджет с выбором метрики через `AppIntent`
  (`IntentConfiguration`) — вместо этого 4 фиксированных вида виджета
  (`StaticConfiguration`), каждый на свою метрику.
- Не поддерживать несколько городов одновременно — один активный город, как
  в расширении.
- Не добавлять интерактивные кнопки виджета (App Intents, iOS 17+) для
  ручного retry — обновление только через таймлайн/reload.
- Не публиковать в App Store или через TestFlight — только Personal Team
  sideload через Xcode на собственное устройство.
- Не дублировать все 4 метрики в самом приложении в виде дашборда — экран
  приложения ограничен настройкой города.
- Не поддерживать `.systemMedium`/`.systemLarge` на домашнем экране — только
  `.systemSmall`.
- Не менять единицы измерения или язык интерфейса — те же русскоязычные
  лейблы (пороги AQI/УФ, названия категорий) и метрическая система, что уже
  приняты в расширении.

## Архитектура

Один Xcode-проект (новый репозиторий), три таргета:

| Таргет | Тип | Ответственность |
| --- | --- | --- |
| `WeatherWidgetsApp` | App (SwiftUI) | Единственный экран — настройка/смена города. Иконка на springboard, никакого дашборда метрик. |
| `WeatherWidgets` | Widget Extension | Один extension-таргет, четыре `Widget`-структуры (`TemperatureWidget`, `PrecipitationWidget`, `AQIWidget`, `UVIndexWidget`), объединённые в `@main struct WeatherWidgetsBundle: WidgetBundle`. Стандартный паттерн Apple — не нужно 4 отдельных extension-таргета. |
| `WeatherCore` | Локальный Swift Package, линкуется в оба таргета выше | Перенесённая бизнес-логика: `OpenMeteoClient` (аналог `weatherApi.js`), `WeatherLocationStore`/`WeatherCacheStore` (аналог `weatherStore.js`, App Group `UserDefaults`), `WeatherRefreshService` (аналог `weatherService.js`, TTL-оркестрация), пороги тонов/категорий AQI/УФ (аналог `weatherPresentation.js`/констант из `weatherApi.js`). |

App Group `group.com.undevy.weatherwidgets` — единственный канал связи между
App- и Widget Extension-таргетом: общий контейнер для
`UserDefaults(suiteName:)`, куда приложение пишет город, а виджеты читают
город и кэш. Работает между собственными таргетами и с Personal Team
signing, платный Developer Program для этого не требуется.

Структура — прямое зеркало текущего разбиения `api`/`store`/`service` в
расширении, перенесённое на другой язык и рантайм.

## Данные Open-Meteo

Те же три эндпоинта, что и в расширении, без API-ключа:

- **Погода**: `GET https://api.open-meteo.com/v1/forecast` —
  `current=temperature_2m,uv_index`, `daily=uv_index_max`,
  `hourly=temperature_2m,precipitation_probability`, `past_days=1`,
  `forecast_days=1`, `timezone=auto`. Используется: текущая температура,
  температура вчера/сегодня в 15:00 (для тона), дневной максимум УФ, максимум
  вероятности дождя сегодня + час начала (probability ≥ 30%).
- **Качество воздуха**: `GET https://air-quality-api.open-meteo.com/v1/air-quality`
  — `current=us_aqi,pm2_5`.
- **Геокодинг**: `GET https://geocoding-api.open-meteo.com/v1/search` —
  `name=<город>&count=1&language=ru`, берётся `results[0]`.

Пороговые таблицы и тон-функции переносятся из `weatherApi.js`/
`weatherPresentation.js` в `WeatherCore` как статические Swift-константы и
чистые функции с теми же границами и русскоязычными лейблами: категории US
AQI и уровни УФ (текстовые лейблы), `temperatureTone` (сравнение с
15:00 вчера), `rainTone` (интенсивность по вероятности).

## Модель данных

`WeatherLocation` (Codable, App Group `UserDefaults`, ключ `weatherLocation`):

```swift
struct WeatherLocation: Codable {
    var version: Int = 1
    var name: String
    var country: String
    var latitude: Double
    var longitude: Double
}
```

`WeatherCache` (Codable, App Group `UserDefaults`, ключ `weatherCache`):

```swift
struct WeatherCache: Codable {
    var version: Int = 1
    var locationName: String
    var fetchedAt: Date
    var temperature: Double
    var temperatureTodayAt15: Double
    var temperatureYesterdayAt15: Double
    var uvIndex: Double
    var uvIndexMax: Double
    var precipitationProbabilityMax: Int
    var precipitationStartHour: String?
    var usAqi: Int
    var pm25: Double
}
```

Оба типа читаются/пишутся через небольшой протокол-обёртку над
`UserDefaults(suiteName:)`, чтобы в тестах подставлять фейковый storage
(аналог фейковой storage area в JS-тестах). Невалидный/несовместимый по
`version` персистентный JSON трактуется как отсутствующий, а не как краш.

## Поток данных и обновление

Общая логика фетча и кэша — один generic `WeatherTimelineProvider<Entry>` в
`WeatherCore`, а не 4 независимые копии; каждый из 4 видов виджета передаёт
только функцию маппинга `WeatherCache` → свой `Entry`.

1. **Город не задан** — таймлайн из одной записи «Не настроено» с подсказкой
   открыть приложение, `reloadPolicy = .never`, сети нет.
2. **TTL-проверка кэша** (порт логики `weatherService.js`): если
   `WeatherCache.locationName == location.name` и
   `Date.now() - fetchedAt < 30 мин` — таймлайн строится из кэша немедленно,
   без сети.
3. **Иначе — параллельный фетч**: `async let` для `fetchWeather` и
   `fetchAirQuality` (аналог `Promise.all` в `weatherService.js`), запись
   нового `WeatherCache`, таймлайн из свежих данных.
4. **Reload policy**: `.after(fetchedAt + 30 мин)`. Это запрос на повторный
   вызов `getTimeline`, не гарантия — WidgetKit сам управляет фактическим
   бюджетом reload'ов по каждому widget kind. Данные иногда будут держаться
   дольше 30 минут без обновления — то же допущение о неточной свежести, что
   уже принято в расширении (там устаревание ограничено открытием вкладки,
   здесь — решением ОС).
5. **`getSnapshot`** (превью в галерее виджетов) читает только кэш, без сети.
6. Смена города в приложении сразу пишет новый `WeatherLocation` (что
   инвалидирует кэш на следующей проверке `locationName`) и вызывает
   `WidgetCenter.shared.reloadAllTimelines()`, чтобы не ждать системного окна
   обновления — аналог форс-рефетча при смене города в `weatherService.js`.

## Виджеты и семейства

Все 4 вида виджета — `StaticConfiguration`, без `AppIntent`-конфигурации.
Каждый поддерживает `.systemSmall` (домашний экран) и все три lock-screen
семейства. Цветовое тонирование по порогам (как сейчас в расширении —
зелёный/оранжевый/красный) работает **только** на `.systemSmall`: экран
блокировки рендерит accessory-виджеты в единый системный оттенок,
собственный цвет фона там недоступен по правилам платформы.

| Виджет | Home Small | Lock Circular | Lock Rectangular | Lock Inline |
| --- | --- | --- | --- | --- |
| Температура | `24°` + «теплее вчера», тон-фон | `24°` | `🌡️ 24°` / «теплее вчера» | `🌡️ 24°` |
| Дождь | `20%` + «с 14:00», тон-фон | `20%` | `☔ 20%` / «начало ~14:00» | `☔ 20%` |
| AQI | `34` + «Умеренно» + `PM2.5 · 11.4`, тон-фон | `34` | `AQI 34 · Умеренно` / `PM2.5 11.4` | `AQI 34` (без категории/PM2.5 — не влезает) |
| УФ-индекс | `6` + «Высокий» + «макс. сегодня 6.1», тон-фон | `6` | `УФ 6 · Высокий` / «макс 6.1» | `☀️ 6` |

## Ошибки

- Город не задан → запись «Не настроено», сети нет.
- Фетч упал, есть валидный кэш для текущего города (даже устаревший) →
  рендер кэша; на Home Small и Lock Rectangular — тусклая пометка «данные
  устарели», на Circular/Inline — без пометки (не влезает физически,
  показывается только последнее известное значение).
- Фетч упал, кэша нет → явная entry-ошибка («Нет данных»). Кнопки повтора
  нет — обновится на следующем reload или после открытия приложения.
- Город не найден при геокодинге — ошибка остаётся в форме настройки в
  приложении; сохранённые город/кэш виджетов не трогаются.
- Битый persisted JSON (кэш или город, включая несовпадение `version`) —
  трактуется как отсутствующий, не крашит provider.

## Тестирование

XCTest в `WeatherCore` (аналог `weatherApi.test.js`/`weatherStore.test.js`/
`weatherService.test.js`):

- `OpenMeteoClientTests` — построение URL/параметров для всех трёх
  эндпоинтов, декодинг валидного ответа, ошибки на не-200, невалидный JSON,
  отсутствующие поля, пустой результат геокодинга; границы категорий
  AQI/УФ.
- `WeatherLocationStoreTests`/`WeatherCacheStoreTests` — round-trip через
  фейковый `UserDefaults`; невалидный/версионно несовместимый JSON →
  трактуется как отсутствующий.
- `WeatherRefreshServiceTests` — свежий кэш → без сетевого вызова (мок
  клиента подтверждает отсутствие вызова); устаревший кэш → рефетч; смена
  города → форс-рефетч независимо от TTL; ошибка сети при наличии кэша →
  stale-with-error; ошибка при отсутствии кэша → error.

Виджет-уровень (`TimelineProvider`, SwiftUI-вьюхи) не покрывается XCTest в
привычном смысле — верификация через `#Preview` по каждому семейству в
Xcode-канвасе и ручную проверку на реальном устройстве (галерея виджетов,
экран блокировки, авиарежим для проверки stale-while-error, ввод
несуществующего города).

## Подпись и сборка

- Personal Team (бесплатный Apple ID), автоматическое управление подписью на
  обоих таргетах (`WeatherWidgetsApp`, `WeatherWidgets`).
- Bundle ID: `com.undevy.weatherwidgets` (app), `com.undevy.weatherwidgets.widgets`
  (extension); App Group `group.com.undevy.weatherwidgets`.
- Ограничение Personal Team: сборка на устройстве считается «просроченной»
  через 7 дней — раз в неделю нужно пересобрать/переустановить из Xcode,
  иначе и приложение, и виджеты перестают обновляться. Не блокер для личного
  использования, но регулярная операционная задача, которую стоит держать в
  голове (в отличие от TestFlight/App Store, которые убирают это
  ограничение ценой платного Developer Program).

## Рекомендуемый порядок реализации

1. `WeatherCore`: `OpenMeteoClient` + модели + пороги AQI/УФ + тесты — чистый
   Foundation-код без Apple-специфичных фреймворков, прямой перенос
   `weatherApi.js`, легко покрывается тестами первым.
2. `WeatherCore`: `WeatherLocationStore`/`WeatherCacheStore` (App Group
   `UserDefaults`) + тесты на фейковом storage.
3. `WeatherCore`: `WeatherRefreshService` (TTL, форс-рефетч,
   stale-while-error) + тесты.
4. Скаффолд Xcode-проекта: App-таргет + Widget Extension-таргет, App Group
   capability на обоих, Personal Team signing.
5. Generic `WeatherTimelineProvider` + 4 `Widget`-структуры
   (`StaticConfiguration`, `supportedFamilies: [.systemSmall, .accessoryCircular,
   .accessoryRectangular, .accessoryInline]`), объединённые в `WidgetBundle`.
6. SwiftUI-вьюхи по каждому виджету (`switch` по `widgetFamily`) — 4 файла.
7. Экран настройки города в App-таргете: форма ввода/смены, запись в
   `WeatherLocationStore`, `WidgetCenter.reloadAllTimelines()` на submit.
8. Ручная проверка на устройстве: добавление всех 4 виджетов в галерею
   домашнего экрана и экрана блокировки, поведение пустого состояния,
   авиарежим (stale-while-error), несуществующий город.

## Оценка сложности

Средняя — как и в исходном спеке погодного виджета расширения. Слой данных
(`WeatherCore`) почти дословно переносится из уже проверенной и
протестированной JS-логики (низкий риск, не изобретение нового). Менее
привычные части — однократная настройка App Group + подписи Personal Team
(разовое трение при скаффолде, не постоянная сложность) и
multi-family SwiftUI-вёрстка (4 виджета × 4 семейства = 16 компактных
вью-вариантов, но каждый тривиален по содержанию — число/лейбл/иконка).
