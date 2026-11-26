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

  // Адрес веб-приложения Google Apps Script (server/Code.gs): через него бот присылает файл в чат.
  // Без адреса кнопки «Прислать в чат» нет. Токен бота здесь не нужен, он лежит в свойствах скрипта.
  sendUrl: "https://script.google.com/macros/s/AKfycbwn8iqhT26OHLXsmSVSLkM6H6akVfBY4sGEKRRZqG2ihJRZHwIwlbdYs2DuX2hO4eufpA/exec",
};
