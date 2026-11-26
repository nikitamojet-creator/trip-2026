/**
 * Бот присылает файл поездки (ваучер, билет, чек) в чат Telegram тому, кто нажал «Прислать в чат».
 *
 * Это Google Apps Script, опубликованный как веб-приложение («Выполнять от моего имени», доступ «Все»).
 * Токен бота в коде не хранится: он лежит в свойствах скрипта под именем BOT_TOKEN
 * (Настройки проекта → Свойства скрипта).
 *
 * Запрос: POST, тело JSON { t: <id поездки>, f: <id файла>, initData: <Telegram.WebApp.initData> }.
 * Кому слать, берём только из initData и только после проверки подписи Telegram,
 * поэтому файл уходит тому, кто сам открыл мини-приложение, и никому другому.
 */
const DB = 'https://trip-guide-ffb87-default-rtdb.europe-west1.firebasedatabase.app';
const MAX_BYTES = 8 * 1024 * 1024;        // больше приложение и не загружает
const MAX_AGE = 30 * 24 * 3600;           // подпись Telegram старше 30 дней не принимаем
const TRIP_RE = /^[A-Za-z0-9_-]{16,64}$/;
const FILE_RE = /^[a-z0-9]{6,24}$/i;

function doPost(e) {
  if (e && e.parameter && e.parameter.hook) return hookReply(e); // сообщение боту от Telegram, см. «ответы бота» ниже
  let res;
  try { res = send(JSON.parse(e.postData.contents)); }
  catch (err) { res = { ok: false, error: 'bad_request' }; }
  // В журнал («Выполнения» в Apps Script) пишем только итог: без имён, id и токена.
  console.log((res.ok ? 'ok' : res.error) + (res.code ? ' ' + res.code : '') + (res.log ? ' · ' + res.log : ''));
  delete res.log;
  return out(res);
}

// Проверка, что всё настроено: открыть адрес веб-приложения в браузере.
function doGet() {
  const token = getToken();
  const res = { ok: true, token: !!token, selftest: selfTest(), bot: null };
  if (token) {
    try {
      const j = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getMe', { muteHttpExceptions: true }).getContentText());
      res.bot = j.ok ? j.result.username : null;
    } catch (err) { /* адрес запроса содержит токен, поэтому текст ошибки никуда не отдаём */ }
  }
  return out(res);
}

function out(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function getToken() { return (PropertiesService.getScriptProperties().getProperty('BOT_TOKEN') || '').trim(); }

function send(req) {
  const token = getToken();
  if (!token) return { ok: false, error: 'no_token' };
  if (!req || !TRIP_RE.test(req.t || '') || !FILE_RE.test(req.f || '')) return { ok: false, error: 'bad_request' };

  const fields = verify(req.initData, token);
  if (!fields) return { ok: false, error: 'auth' };
  if (Math.abs(Date.now() / 1000 - Number(fields.auth_date)) > MAX_AGE) return { ok: false, error: 'auth' };
  let user; try { user = JSON.parse(fields.user); } catch (err) { user = null; }
  if (!user || !user.id) return { ok: false, error: 'auth' };

  let file;
  try {
    const r = UrlFetchApp.fetch(DB + '/trips/' + req.t + '/files/' + req.f + '.json', { muteHttpExceptions: true });
    file = r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : null;
  } catch (err) { return { ok: false, error: 'db' }; }
  const m = file && typeof file.data === 'string' ? /^data:([^;,]+);base64,/.exec(file.data.slice(0, 80)) : null;
  if (!m) return { ok: false, error: 'not_found' };
  const bytes = Utilities.base64Decode(file.data.slice(m[0].length));
  if (bytes.length > MAX_BYTES) return { ok: false, error: 'too_big' };
  const pdf = m[1].indexOf('pdf') >= 0;
  const blob = Utilities.newBlob(bytes, pdf ? 'application/pdf' : 'image/jpeg', fileName(file.name, pdf));

  let code = 0, j = null;
  try {
    const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendDocument', {
      method: 'post', payload: { chat_id: String(user.id), document: blob }, muteHttpExceptions: true });
    code = r.getResponseCode(); j = JSON.parse(r.getContentText());
  } catch (err) { return { ok: false, error: 'telegram' }; } // текст ошибки не отдаём: в нём адрес с токеном
  if (j && j.ok) return { ok: true };
  const log = j && j.description ? String(j.description).slice(0, 120) : '';
  if (code === 403) return { ok: false, error: 'write', log: log };      // бот не может написать первым
  return { ok: false, error: 'telegram', code: code, log: log };
}

// Имя файла такое же, как при скачивании в приложении.
function fileName(name, pdf) {
  const base = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return (base || (pdf ? 'document' : 'photo')) + (pdf ? '.pdf' : '.jpg');
}

/**
 * Проверка подписи Telegram (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * ключ = HMAC-SHA256("WebAppData", токен); подпись = HMAC-SHA256(ключ, строки "имя=значение" по алфавиту через \n, без hash).
 * Возвращает поля initData или null.
 */
function verify(initData, token) {
  if (typeof initData !== 'string' || !initData || initData.length > 8192) return null;
  const fields = {};
  try {
    initData.split('&').forEach(function (p) {
      const i = p.indexOf('='); if (i < 1) return;
      fields[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1).replace(/\+/g, ' '));
    });
  } catch (err) { return null; }
  const hash = fields.hash; delete fields.hash;
  if (!/^[0-9a-f]{64}$/.test(hash || '') || !fields.auth_date || !fields.user) return null;
  const dcs = Object.keys(fields).sort().map(function (k) { return k + '=' + fields[k]; }).join('\n');
  const key = Utilities.computeHmacSha256Signature(Utilities.newBlob(token).getBytes(), Utilities.newBlob('WebAppData').getBytes());
  const sig = Utilities.computeHmacSha256Signature(Utilities.newBlob(dcs).getBytes(), key);
  return hex(sig) === hash ? fields : null;
}
function hex(bytes) { return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join(''); }

// Самопроверка подписи на выдуманном токене: верная строка проходит, испорченная нет.
function selfTest() {
  const token = '1234567:TEST-TOKEN-NOT-REAL';
  const good = 'auth_date=1700000000&query_id=AAHtest&signature=c2lnbmF0dXJl&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22%D0%A2%D0%B5%D1%81%D1%82%20%D0%98%D0%BC%D1%8F%22%2C%22allows_write_to_pm%22%3Atrue%7D&hash=97408d71e41b309739805d01c3a7e4887de1ff86fc2b2b1948fc49ce925acffb';
  try {
    const f = verify(good, token);
    return !!f && JSON.parse(f.user).id === 42 && verify(good.replace('%3A42', '%3A43'), token) === null && verify(good, token + 'x') === null;
  } catch (err) { return false; }
}

/* ---------------- оформление бота ----------------
 * Эти функции из интернета недоступны. Их запускают вручную в редакторе Apps Script:
 * выбрать функцию в списке над кодом и нажать «Выполнить». Результат виден в «Журнале выполнения».
 */
const SITE = 'https://nikitamojet-creator.github.io/trip-2026/';
const BOT_ABOUT = 'Общий путеводитель для поездки: маршрут, билеты, жильё, расходы и заметки. Бесплатно.';
const BOT_DESCRIPTION = [
  'Общий путеводитель для поездки с друзьями или семьёй.',
  '',
  '🗺 Маршрут по дням и карта',
  '🎫 Билеты, жильё и ваучеры под рукой',
  '💰 Общие расходы: сразу видно, кто кому должен',
  '📍 Места, заметки и список дел',
  '',
  'Создай поездку и отправь ссылку тем, кто едет с тобой. Править могут все, у кого есть ссылка. Бесплатно.',
  '',
  'Чтобы начать, нажми «Запустить».',
].join('\n');

// Вызов Bot API. Текст сетевой ошибки не показываем: в нём адрес запроса с токеном.
function tg(method, payload) {
  try {
    const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + getToken() + '/' + method, { method: 'post', payload: payload || {}, muteHttpExceptions: true });
    return JSON.parse(r.getContentText());
  } catch (err) { return { ok: false, description: 'запрос не выполнен' }; }
}

// Что сейчас выставлено у бота.
function botInfo() {
  ['getMe', 'getMyName', 'getMyDescription', 'getMyShortDescription', 'getMyCommands', 'getChatMenuButton'].forEach(function (m) {
    const j = tg(m); console.log(m + ': ' + JSON.stringify(j.ok ? j.result : j.description));
  });
  const w = tg('getWebhookInfo'), url = w.ok && w.result.url ? w.result.url : '';
  // сам адрес не показываем: в нём секрет
  console.log('приём сообщений: ' + (url ? url.split('/')[2] + ', в очереди ' + w.result.pending_update_count +
    (w.result.last_error_message ? ', последняя ошибка: ' + w.result.last_error_message + ' (' + new Date(w.result.last_error_date * 1000).toISOString() + ')' : ', ошибок нет') : 'выключен'));
}

// Описание и подпись в профиле. Кнопку меню «Путеводитель» не трогаем: она уже открывает приложение.
function show(name, j) { console.log(name + ': ' + (j.ok ? 'готово' : 'ошибка · ' + j.description)); }
function setupBot() {
  show('описание', tg('setMyDescription', { description: BOT_DESCRIPTION }));
  show('подпись в профиле', tg('setMyShortDescription', { short_description: BOT_ABOUT }));
}

// Аватарка: картинка лежит на сайте (bot-avatar.jpg).
function setupBotPhoto() {
  let img;
  try { img = UrlFetchApp.fetch(SITE + 'bot-avatar.jpg').getBlob().setName('avatar.jpg'); }
  catch (err) { console.log('аватарка: не удалось скачать картинку с сайта'); return; }
  const j = tg('setMyProfilePhoto', { photo: JSON.stringify({ type: 'static', photo: 'attach://file' }), file: img });
  console.log('аватарка: ' + (j.ok ? 'готово' : 'ошибка · ' + j.description));
}

/* ---------------- ответы бота ----------------
 * Бот отвечает на «Запустить» и на любое личное сообщение: присылает приветствие с кнопкой, которая открывает приложение.
 * Telegram шлёт сообщения на адрес веб-приложения с параметром hook=<секрет>. Секрет создаёт setupHook и хранит
 * в свойствах скрипта (HOOK_SECRET), поэтому подделать сообщение от Telegram нельзя.
 */
const EXEC_URL = 'https://script.google.com/macros/s/AKfycbwn8iqhT26OHLXsmSVSLkM6H6akVfBY4sGEKRRZqG2ihJRZHwIwlbdYs2DuX2hO4eufpA/exec';
const HELLO = [
  'Привет! Я открываю путеводитель для поездки: маршрут по дням, билеты и жильё, общие расходы, места и заметки.',
  '',
  'Создай поездку и отправь ссылку тем, кто едет с тобой. Если тебе уже прислали приглашение, открой его, и поездка появится в списке.',
  '',
  'Сюда же я присылаю ваучеры и билеты, когда в приложении нажимаешь «Прислать в чат».',
].join('\n');
const HELLO_TRIP = 'Привет! Тебя зовут в поездку. Нажми кнопку ниже, и она откроется.';
const HELLO_ANY = 'Отвечать на сообщения я не умею, зато открываю путеводитель. Нажми кнопку ниже.';

function hookReply(e) {
  // Telegram ждёт ответ 200 без переадресации: страницу HtmlService Google отдаёт сразу, а JSON только через переадресацию.
  const done = HtmlService.createHtmlOutput('ok');
  try {
    const secret = PropertiesService.getScriptProperties().getProperty('HOOK_SECRET');
    if (!secret || e.parameter.hook !== secret) return done;
    const up = JSON.parse(e.postData.contents), m = up.message;
    if (!m || !m.chat || m.chat.type !== 'private') return done;
    // Telegram повторяет сообщение, если не дождался ответа: на каждое отвечаем один раз.
    const cache = CacheService.getScriptCache(), key = 'u' + up.update_id;
    if (cache.get(key)) return done;
    cache.put(key, '1', 3600);
    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?/.exec(String(m.text || ''));
    const trip = start && start[1] && TRIP_RE.test(start[1]) ? start[1] : '';
    const text = trip ? HELLO_TRIP : start ? HELLO : HELLO_ANY;
    const button = { text: trip ? '🧭 Открыть поездку' : '🧭 Открыть путеводитель', web_app: { url: trip ? SITE + '?t=' + trip : SITE } };
    tg('sendMessage', { chat_id: String(m.chat.id), text: text, reply_markup: JSON.stringify({ inline_keyboard: [[button]] }) });
  } catch (err) { /* что бы ни случилось, Telegram должен получить обычный ответ, иначе он будет повторять сообщение */ }
  return done;
}

// Включить ответы бота. Запускается вручную в редакторе, как и функции оформления.
function setupHook() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('HOOK_SECRET');
  if (!secret) { secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); props.setProperty('HOOK_SECRET', secret); }
  // старые неотвеченные «Запустить» сбрасываем, чтобы бот не ответил на них разом
  show('приём сообщений', tg('setWebhook', { url: EXEC_URL + '?hook=' + secret, allowed_updates: JSON.stringify(['message']), drop_pending_updates: 'true' }));
  show('команда /start', tg('setMyCommands', { commands: JSON.stringify([{ command: 'start', description: 'Открыть путеводитель' }]) }));
}

// Выключить ответы бота.
function removeHook() {
  show('приём сообщений выключен', tg('deleteWebhook', { drop_pending_updates: 'true' }));
  show('команды убраны', tg('deleteMyCommands', {}));
}
