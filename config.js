// Настройки путеводителя.
window.TRIP_CONFIG = {
  // Бот Telegram: из него собираются ссылки-приглашения t.me/<бот>?startapp=<поездка>
  bot: "Ana7_Travel_bot",

  // Realtime Database. Для неё достаточно адреса базы, apiKey не нужен.
  // Правила доступа лежат в database.rules.json: читать можно только поездку, id которой знаешь.
  firebase: {
    projectId: "trip-guide-ffb87",
    databaseURL: "https://trip-guide-ffb87-default-rtdb.europe-west1.firebasedatabase.app",
  },
};
