/**
 * 信男藥局 私下訂單系統 — 後端（Google Apps Script，綁定「信男藥局_私下訂單系統_資料庫」）
 *
 * 部署：擴充功能 > Apps Script，貼上本檔與 Setup.gs → 部署 > 新增部署作業 > 網頁應用程式
 *       執行身分：我；存取權：所有人。把網址填進前端 config.js。
 * 金鑰一律放「專案設定 > 指令碼屬性」：LINE_CHANNEL_TOKEN、LINE_GROUP_ID（選用）。
 */

const SHEETS = {
  orders: '訂單', items: '訂單明細', customers: '客戶', quotes: '報價紀錄',
  products: '商品', aliases: '商品別名', payments: '收款紀錄', shipments: '出貨紀錄',
  settings: '設定', staff: '人員', reminders: '回購提醒', milk: '奶水品項',
  priceTable: '報價表', log: '操作紀錄', lineLog: 'LINE群組紀錄'
};

const SESSION_HOURS = 6;
const REMIND_DAYS_BEFORE = 5;
const TZ = 'Asia/Taipei';

/* ---------------- 入口 ---------------- */

function doGet() {
  return json_({ ok: true, service: '信男藥局 私下訂單系統 API' });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json_({ ok: false, error: '格式錯誤' }); }

  // LINE webhook：只記錄群組 ID（機器人被加進群組時），供管理者設定推播對象
  if (body.events && body.destination) return handleLineWebhook_(body);

  const action = body.action;
  try {
    if (action === 'listStaff') return json_({ ok: true, data: listStaffNames_() });
    if (action === 'login') return json_(login_(body.name, body.password));

    const user = checkSession_(body.token);
    if (!user) return json_({ ok: false, error: '登入已過期，請重新登入', code: 'AUTH' });

    const handlers = {
      logout: () => { CacheService.getScriptCache().remove('s_' + body.token); return {}; },
      bootstrap: () => bootstrap_(user),
      searchProducts: () => searchProducts_(body.keyword),
      productIndex: () => productIndex_(),
      productImages: () => productImages_(),
      createOrder: () => withLock_(() => createOrder_(body.order, user)),
      shipOrder: () => withLock_(() => shipOrder_(body.shipment, user)),
      markPaid: () => withLock_(() => markPaid_(body.payment, user)),
      updateReminder: () => withLock_(() => updateReminder_(body.reminder, user)),
      changePassword: () => changePassword_(user, body.oldPassword, body.newPassword),
      // 管理者
      addStaff: () => adminOnly_(user, () => addStaff_(body.name, body.role, body.password)),
      resetPassword: () => adminOnly_(user, () => setPassword_(body.name, body.password)),
      setStaffActive: () => adminOnly_(user, () => setStaffActive_(body.name, body.active)),
      listStaffAdmin: () => adminOnly_(user, () => readTable_(SHEETS.staff).rows.map(r => ({ 姓名: r['姓名'], 角色: r['角色'], 啟用: r['啟用'] })))
    };
    if (!handlers[action]) return json_({ ok: false, error: '未知的操作：' + action });
    const data = handlers[action]();
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/* 商品圖：雲端硬碟「私下訂單系統/商品圖/網頁」內的 <品項ID>.webp，只給登入者（data URL，逐檔快取 6 小時） */
function productImages_() {
  const folderId = PropertiesService.getScriptProperties().getProperty('IMG_FOLDER_ID');
  let folder = folderId ? DriveApp.getFolderById(folderId) : null;
  if (!folder) {
    const path = ['私下訂單系統', '商品圖', '網頁'];
    let it = DriveApp.getFoldersByName(path[0]);
    if (!it.hasNext()) return {};
    folder = it.next();
    for (let i = 1; i < path.length; i++) { it = folder.getFoldersByName(path[i]); if (!it.hasNext()) return {}; folder = it.next(); }
    PropertiesService.getScriptProperties().setProperty('IMG_FOLDER_ID', folder.getId());
  }
  const cache = CacheService.getScriptCache(), out = {};
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next(), m = f.getName().match(/^(Q\d+)\.(webp|png|jpe?g)$/i);
    if (!m) continue;
    const key = 'img_' + f.getId() + '_' + f.getLastUpdated().getTime();
    let url = cache.get(key);
    if (!url) { const b = f.getBlob(); url = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()); if (url.length < 95000) cache.put(key, url, 21600); }
    out[m[1]] = url;
  }
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------------- 表格工具（以標題列定位欄位） ---------------- */

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('找不到分頁：' + name);
  return sh;
}

function readTable_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const headers = (values.shift() || []).map(h => String(h).trim());
  const rows = values
    .map((v, i) => { const o = { _row: i + 2 }; headers.forEach((h, j) => { if (h) o[h] = v[j] instanceof Date ? fmtDate_(v[j]) : v[j]; }); return o; })
    .filter(o => headers.some(h => h && o[h] !== '' && o[h] !== null));
  return { sh, headers, rows };
}

function appendRow_(name, obj) {
  const sh = sheet_(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  sh.appendRow(headers.map(h => (h in obj ? obj[h] : '')));
}

function updateRow_(table, rowNum, patch) {
  Object.keys(patch).forEach(k => {
    const col = table.headers.indexOf(k);
    if (col >= 0) table.sh.getRange(rowNum, col + 1).setValue(patch[k]);
  });
}

function fmtDate_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function today_() { return fmtDate_(new Date()); }
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function addDays_(dateStr, n) { const d = new Date(dateStr + 'T00:00:00+08:00'); d.setDate(d.getDate() + n); return fmtDate_(d); }
function num_(v) { const n = Number(String(v).replace(/[,$\s]/g, '')); return isFinite(n) ? n : 0; }

function nextId_(rows, field, prefix, width) {
  let max = 0;
  rows.forEach(r => { const m = String(r[field] || '').match(new RegExp('^' + prefix + '(\\d+)$')); if (m) max = Math.max(max, +m[1]); });
  return prefix + String(max + 1).padStart(width, '0');
}

function log_(user, action, detail) {
  try { appendRow_(SHEETS.log, { 時間: now_(), 人員: user.name, 操作: action, 內容: detail }); } catch (e) { /* 沒有操作紀錄分頁時略過 */ }
}

/* ---------------- 登入 ---------------- */

function hash_(password, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + password, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function listStaffNames_() {
  return readTable_(SHEETS.staff).rows.filter(r => r['啟用'] !== false && String(r['啟用']) !== 'FALSE').map(r => r['姓名']);
}

function login_(name, password) {
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + name;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) return { ok: false, error: '密碼錯誤次數過多，請 10 分鐘後再試' };

  const r = readTable_(SHEETS.staff).rows.find(x => x['姓名'] === name);
  if (!r || String(r['啟用']) === 'FALSE' || r['啟用'] === false) return { ok: false, error: '找不到此人員' };
  if (!r['密碼雜湊']) return { ok: false, error: '此人員尚未設定密碼，請管理者設定' };
  if (hash_(String(password || ''), r['鹽']) !== r['密碼雜湊']) {
    cache.put(failKey, String(fails + 1), 600);
    return { ok: false, error: '密碼錯誤' };
  }
  cache.remove(failKey);
  const token = Utilities.getUuid();
  const user = { name: r['姓名'], role: r['角色'] || '一般' };
  cache.put('s_' + token, JSON.stringify(user), SESSION_HOURS * 3600);
  return { ok: true, data: { token, user } };
}

function checkSession_(token) {
  if (!token) return null;
  const s = CacheService.getScriptCache().get('s_' + token);
  return s ? JSON.parse(s) : null;
}

function adminOnly_(user, fn) {
  if (user.role !== '管理者') throw new Error('需要管理者權限');
  return fn();
}

function setPassword_(name, password) {
  if (!password || String(password).length < 6) throw new Error('密碼至少 6 碼');
  const t = readTable_(SHEETS.staff);
  const r = t.rows.find(x => x['姓名'] === name);
  if (!r) throw new Error('找不到人員：' + name);
  const salt = Utilities.getUuid();
  updateRow_(t, r._row, { 鹽: salt, 密碼雜湊: hash_(String(password), salt) });
  return {};
}

function addStaff_(name, role, password) {
  if (!name) throw new Error('請輸入姓名');
  const t = readTable_(SHEETS.staff);
  if (t.rows.some(x => x['姓名'] === name)) throw new Error('已有同名人員');
  appendRow_(SHEETS.staff, { 姓名: name, 角色: role || '一般', 啟用: true, 建立日期: today_() });
  setPassword_(name, password);
  return {};
}

function setStaffActive_(name, active) {
  const t = readTable_(SHEETS.staff);
  const r = t.rows.find(x => x['姓名'] === name);
  if (!r) throw new Error('找不到人員');
  updateRow_(t, r._row, { 啟用: !!active });
  return {};
}

function changePassword_(user, oldPw, newPw) {
  const r = readTable_(SHEETS.staff).rows.find(x => x['姓名'] === user.name);
  if (!r || hash_(String(oldPw || ''), r['鹽']) !== r['密碼雜湊']) throw new Error('目前密碼不正確');
  return setPassword_(user.name, newPw);
}

/* ---------------- 讀取資料 ---------------- */

function bootstrap_(user) {
  const settings = readSettings_();
  const orders = readTable_(SHEETS.orders).rows;
  const items = readTable_(SHEETS.items).rows;
  const customers = readTable_(SHEETS.customers).rows;
  const quotes = readTable_(SHEETS.quotes).rows;
  const shipments = readTable_(SHEETS.shipments).rows;
  const payments = readTable_(SHEETS.payments).rows;
  const reminders = optionalTable_(SHEETS.reminders);
  const milk = optionalTable_(SHEETS.milk);
  const priceTable = optionalTable_(SHEETS.priceTable);
  const aliases = optionalTable_(SHEETS.aliases);
  return { user, settings, orders, items, customers, quotes, shipments, payments, reminders, milk, priceTable, aliases, remindDaysBefore: REMIND_DAYS_BEFORE, today: today_() };
}

function optionalTable_(name) {
  return SpreadsheetApp.getActive().getSheetByName(name) ? readTable_(name).rows : [];
}

function readSettings_() {
  const sh = sheet_(SHEETS.settings);
  const v = sh.getDataRange().getValues();
  const headers = v.shift() || [];
  const out = {};
  headers.forEach((h, j) => { if (h) out[String(h).trim()] = v.map(r => r[j]).filter(x => x !== '' && x !== null); });
  return out;
}

/** 商品主檔很大（4,000 多筆），不放進 bootstrap，建單時依關鍵字查前 30 筆 */
function searchProducts_(keyword) {
  const k = String(keyword || '').trim().toLowerCase();
  if (k.length < 1) return [];
  const words = k.split(/\s+/);
  const out = [];
  const rows = readTable_(SHEETS.products).rows;
  for (let i = 0; i < rows.length && out.length < 30; i++) {
    const text = Object.keys(rows[i]).filter(h => h !== '_row').map(h => rows[i][h]).join(' ').toLowerCase();
    if (words.every(w => text.indexOf(w) >= 0)) out.push(rows[i]);
  }
  return out;
}

/**
 * 建單用的精簡商品清單（貨號、品名、成本、品牌、規格），登入後一次下載，前端即時搜尋。
 * 快取 10 分鐘，避免每次都讀 4,000 多列。
 */
function productIndex_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('prodIdx');
  if (hit) return JSON.parse(hit);
  const t = readTable_(SHEETS.products);
  const pick = re => t.headers.find(h => re.test(h)) || '';
  const kSku = t.headers.indexOf('商品貨號') >= 0 ? '商品貨號' : pick(/貨號|編號|SKU/i);
  const kName = pick(/商品名稱|品名|名稱/), kCost = pick(/成本/), kBrand = pick(/品牌|廠牌/), kSpec = pick(/規格|容量/);
  const out = t.rows.map(r => [r[kSku] || '', r[kName] || '', kCost ? r[kCost] : '', kBrand ? r[kBrand] : '', kSpec ? r[kSpec] : ''])
    .filter(x => x[0] || x[1]);
  const json = JSON.stringify(out);
  if (json.length < 95000) cache.put('prodIdx', json, 600);
  return out;
}

/* ---------------- 建單 ---------------- */

function createOrder_(o, user) {
  if (!o || !o.items || !o.items.length) throw new Error('至少要有一個品項');
  const date = o.date || today_();
  const ymd = date.replace(/-/g, '');

  // 訂單編號：YYYYMMDD-NN（90 以上保留給舊資料補號）
  const orders = readTable_(SHEETS.orders);
  let maxSeq = 0;
  orders.rows.forEach(r => { const m = String(r['訂單編號']).match(new RegExp('^' + ymd + '-(\\d{2})$')); if (m && +m[1] < 90) maxSeq = Math.max(maxSeq, +m[1]); });
  const orderNo = ymd + '-' + String(maxSeq + 1).padStart(2, '0');

  // 客戶：電話完全相符優先，沒有就新增
  const cust = readTable_(SHEETS.customers);
  const phone = String(o.customer.phone || '').replace(/\D/g, '');
  let c = o.customer.id ? cust.rows.find(r => r['客戶ID'] === o.customer.id) : null;
  if (!c && phone) c = cust.rows.find(r => String(r['電話'] || '').replace(/\D/g, '') === phone);
  let custId = c ? c['客戶ID'] : nextId_(cust.rows, '客戶ID', 'C', 4);
  if (!c) appendRow_(SHEETS.customers, { 客戶ID: custId, 姓名: o.customer.name, 電話: o.customer.phone, LINE名稱: o.customer.lineName || '', 類型: o.type, 建立日期: date });

  let goods = 0, cost = 0;
  o.items.forEach(it => { it.subtotal = num_(it.qty) * num_(it.price); it.costTotal = num_(it.qty) * num_(it.unitCost); goods += it.subtotal; cost += it.costTotal; });
  const discount = num_(o.discount), shipping = num_(o.shipping);
  const total = goods - discount + shipping;
  const profit = goods - discount - cost;

  appendRow_(SHEETS.orders, {
    訂單編號: orderNo, 訂單日期: date, 類型: o.type, 來源: o.source, 客戶ID: custId, 客戶: o.customer.name, 客戶電話: o.customer.phone,
    收件人: o.recipient.name, 收件電話: o.recipient.phone, '收件地址/門市': o.recipient.address, 寄送方式: o.shippingMethod,
    商品金額: goods, 折扣: discount, 運費: shipping, 訂單總額: total, 成本合計: cost, 毛利: profit,
    毛利率: goods ? Math.round(profit / (goods - discount) * 1000) / 1000 : '',
    付款方式: o.paymentMethod, 匯款末五碼: o.last5 || '', 付款狀態: o.paid ? '已付款' : '待付款', 出貨狀態: '待出貨',
    接單人: user.name, 備註: o.note || '', 資料來源: '網站建單'
  });

  const quoteRows = [];
  o.items.forEach((it, i) => {
    appendRow_(SHEETS.items, {
      明細ID: orderNo + '-' + String(i + 1).padStart(2, '0'), 訂單編號: orderNo, 商品貨號: it.sku || '', 商品名稱: it.name, 規格: it.spec || '',
      數量: num_(it.qty), 單價: num_(it.price), 小計: it.subtotal, 成本: it.costTotal, 毛利: it.subtotal - it.costTotal,
      成本來源: it.costSource || '', 贈品: it.gift ? '是' : '', 收件人: o.recipient.name, 收件電話: o.recipient.phone, '收件地址/門市': o.recipient.address
    });
    if (!it.gift && num_(it.price) > 0) quoteRows.push(it);
  });

  // 報價紀錄：價格和這位客戶上次不同才記
  const quotes = readTable_(SHEETS.quotes).rows;
  quoteRows.forEach(it => {
    const last = quotes.filter(q => q['客戶ID'] === custId && (q['商品貨號'] === it.sku && it.sku || q['商品名稱'] === it.name)).pop();
    if (!last || num_(last['單價']) !== num_(it.price)) {
      appendRow_(SHEETS.quotes, { 日期: date, 客戶ID: custId, 客戶: o.customer.name, 商品貨號: it.sku || '', 商品名稱: it.name, 規格: it.spec || '', 單價: num_(it.price), 來源: '歷史成交', 訂單編號: orderNo });
    }
  });

  // 奶水回購提醒
  createMilkReminders_(orderNo, custId, o, user);

  log_(user, '建單', orderNo + ' ' + o.customer.name + ' $' + total);
  return { orderNo, customerId: custId, total };
}

/* ---------------- 出貨與收款 ---------------- */

function shipOrder_(s, user) {
  const orders = readTable_(SHEETS.orders);
  const r = orders.rows.find(x => x['訂單編號'] === s.orderNo);
  if (!r) throw new Error('找不到訂單：' + s.orderNo);
  const date = s.date || today_();
  const ship = readTable_(SHEETS.shipments);
  const id = nextId_(ship.rows, '出貨ID', 'S', 4);
  appendRow_(SHEETS.shipments, { 出貨ID: id, 訂單編號: s.orderNo, 出貨日期: date, 物流商: s.carrier, 物流單號: s.trackingNo, 收件人: r['收件人'], 代收金額: num_(s.cod), 處理人: user.name, 備註: s.note || '' });
  updateRow_(orders, r._row, { 物流商: s.carrier, 物流單號: s.trackingNo, 出貨狀態: '已出貨' });
  startMilkReminders_(s.orderNo, date);
  log_(user, '出貨', s.orderNo + ' ' + s.carrier + ' ' + s.trackingNo);
  return { shipmentId: id };
}

function markPaid_(p, user) {
  const orders = readTable_(SHEETS.orders);
  const r = orders.rows.find(x => x['訂單編號'] === p.orderNo);
  if (!r) throw new Error('找不到訂單：' + p.orderNo);
  const pay = readTable_(SHEETS.payments);
  const id = nextId_(pay.rows, '收款ID', 'P', 4);
  appendRow_(SHEETS.payments, { 收款ID: id, 訂單編號: p.orderNo, 收款日期: p.date || today_(), 金額: num_(p.amount || r['訂單總額']), 付款方式: p.method || r['付款方式'], 匯款末五碼: p.last5 || '', 處理人: user.name, 備註: p.note || '' });
  updateRow_(orders, r._row, { 付款狀態: '已付款' });
  log_(user, '收款', p.orderNo);
  return { paymentId: id };
}

/* ---------------- 奶水回購提醒 ---------------- */

/** 「奶水品項」分頁：關鍵字｜每箱罐數（含贈）。品名含任一關鍵字即視為奶水 */
function milkRule_(name) {
  const rules = optionalTable_(SHEETS.milk);
  return rules.find(r => r['關鍵字'] && String(name).indexOf(String(r['關鍵字'])) >= 0) || null;
}

function createMilkReminders_(orderNo, custId, o, user) {
  if (!SpreadsheetApp.getActive().getSheetByName(SHEETS.reminders)) return;
  const t = readTable_(SHEETS.reminders);
  // 同一位客人又買奶水 → 舊的提醒自動結案
  const milkItems = o.items.filter(it => !it.gift && (num_(it.cans) > 0 || milkRule_(it.name)));
  if (!milkItems.length) return;
  t.rows.filter(r => r['客戶ID'] === custId && (r['狀態'] === '待聯繫' || r['狀態'] === '已聯繫' || r['狀態'] === '未出貨'))
    .forEach(r => updateRow_(t, r._row, { 狀態: '已回購', 處理人: user.name, 處理時間: now_(), 備註: '新訂單 ' + orderNo }));

  let n = +nextId_(t.rows, '提醒ID', 'R', 5).slice(1) - 1;
  milkItems.forEach(it => {
    const rule = milkRule_(it.name);
    const cans = num_(it.cans) || num_(it.qty) * num_(rule ? rule['每箱罐數'] : 24);
    const perDay = num_(o.cansPerDay) || customerCansPerDay_(custId) || 1;
    n += 1;
    appendRow_(SHEETS.reminders, {
      提醒ID: 'R' + String(n).padStart(5, '0'), 訂單編號: orderNo, 客戶ID: custId, 客戶: o.customer.name, 電話: o.customer.phone,
      商品: it.name, 總罐數: cans, 每日罐數: perDay, 起算日: '', 預計喝完日: '', 提醒日: '', 狀態: '未出貨', 建立時間: now_()
    });
  });
}

function customerCansPerDay_(custId) {
  const r = optionalTable_(SHEETS.reminders).filter(x => x['客戶ID'] === custId && num_(x['每日罐數']) > 0).pop();
  return r ? num_(r['每日罐數']) : 0;
}

/** 出貨後開始計算喝完日 */
function startMilkReminders_(orderNo, shipDate) {
  if (!SpreadsheetApp.getActive().getSheetByName(SHEETS.reminders)) return;
  const t = readTable_(SHEETS.reminders);
  t.rows.filter(r => r['訂單編號'] === orderNo && r['狀態'] === '未出貨').forEach(r => {
    const days = Math.floor(num_(r['總罐數']) / (num_(r['每日罐數']) || 1));
    const end = addDays_(shipDate, days);
    updateRow_(t, r._row, { 起算日: shipDate, 預計喝完日: end, 提醒日: addDays_(end, -REMIND_DAYS_BEFORE), 狀態: '待聯繫' });
  });
}

function updateReminder_(p, user) {
  const t = readTable_(SHEETS.reminders);
  const r = t.rows.find(x => x['提醒ID'] === p.id);
  if (!r) throw new Error('找不到提醒');
  const patch = { 處理人: user.name, 處理時間: now_() };
  if (p.status) patch['狀態'] = p.status;
  if (p.note !== undefined) patch['備註'] = p.note;
  if (p.cansPerDay) {
    const perDay = num_(p.cansPerDay);
    patch['每日罐數'] = perDay;
    if (r['起算日']) {
      const end = addDays_(r['起算日'], Math.floor(num_(r['總罐數']) / perDay));
      patch['預計喝完日'] = end; patch['提醒日'] = addDays_(end, -REMIND_DAYS_BEFORE);
    }
  }
  updateRow_(t, r._row, patch);
  return {};
}

/** 每天早上由時間觸發器執行：把今天到期的提醒推到 LINE 員工群組 */
function dailyReminderPush() {
  const t = readTable_(SHEETS.reminders);
  const today = today_();
  const due = t.rows.filter(r => r['狀態'] === '待聯繫' && r['提醒日'] && r['提醒日'] <= today && r['已推播'] !== today);
  if (!due.length) return;
  const lines = due.map(r => '・' + r['客戶'] + '｜' + r['商品'] + '｜預計 ' + String(r['預計喝完日']).slice(5) + ' 喝完');
  const text = '【奶水回購提醒】今天有 ' + due.length + ' 位客人可以主動詢問：\n' + lines.join('\n') + '\n\n處理後請到系統「回購提醒」標記。';
  pushLine_(text);
  due.forEach(r => updateRow_(t, r._row, { 已推播: today }));
}

/**
 * 推播到 LINE 員工群組。優先走 Cloudflare 中介（xinnan-line-relay，群組 ID 存在 Cloudflare）；
 * 未設定中介時才直接呼叫 LINE。指令碼屬性：RELAY_ADMIN_TOKEN（必填）、RELAY_URL（選填）。
 */
const RELAY_DEFAULT_URL = 'https://xinnan-line-relay.174kuo.workers.dev';
function pushLine_(text) {
  const props = PropertiesService.getScriptProperties();
  const body = text.slice(0, 4900);
  const relayToken = props.getProperty('RELAY_ADMIN_TOKEN');
  if (relayToken) {
    const url = (props.getProperty('RELAY_URL') || RELAY_DEFAULT_URL).replace(/\/$/, '') + '/push/test';
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + relayToken },
      payload: JSON.stringify({ text: body })
    });
    if (res.getResponseCode() !== 200) throw new Error('LINE 推播失敗（中介回應 ' + res.getResponseCode() + '）');
    return;
  }
  const token = props.getProperty('LINE_CHANNEL_TOKEN');
  const to = props.getProperty('LINE_GROUP_ID');
  if (!token || !to) { console.log('未設定 RELAY_ADMIN_TOKEN 或 LINE_CHANNEL_TOKEN / LINE_GROUP_ID，略過推播'); return; }
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: body }] })
  });
}

/** 手動執行：送一則測試訊息到目前設定的群組（不含客戶資料） */
function testLinePush() {
  pushLine_('【私下訂單系統】LINE 群組推播測試成功');
  console.log('已送出測試訊息，請到 LINE 群組確認');
}

/** 機器人被加入群組時記下群組 ID；管理者確認後手動填入指令碼屬性 LINE_GROUP_ID */
function handleLineWebhook_(body) {
  (body.events || []).forEach(ev => {
    if (ev.source && ev.source.groupId && (ev.type === 'join' || ev.type === 'message')) {
      const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.lineLog);
      if (sh) {
        const ids = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues().map(r => r[0]);
        if (ids.indexOf(ev.source.groupId) < 0) sh.appendRow([ev.source.groupId, now_(), ev.type]);
      }
    }
  });
  return json_({ ok: true });
}
