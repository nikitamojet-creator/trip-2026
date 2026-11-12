// Настройки путеводителя. Это единственный файл, который нужно править руками.
window.TRIP_CONFIG = {
  // Имя «папки» поездки в базе. Правила Firebase открывают доступ только к ней:
  // если поменяете, поменяйте и в Realtime Database → Rules.
  tripId: "asia26-x9m4tq2v",

  // Realtime Database в проекте nazare-loyalty (регион Сингапур).
  // Для Realtime Database достаточно адреса базы, apiKey не нужен.
  firebase: {
    projectId: "nazare-loyalty",
    databaseURL: "https://nazare-loyalty-default-rtdb.asia-southeast1.firebasedatabase.app",
  },

  // Участники по умолчанию (потом можно поменять в приложении: «Ещё» → «Поездка»)
  people: ["Никита", "Диана", "Стас", "Марина", "Фролов"],
};
