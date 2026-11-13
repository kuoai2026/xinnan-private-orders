/**
 * 一次性設定（在 Apps Script 編輯器手動執行，不經過網站）
 * 1. setupSheets()            建立新分頁：人員、回購提醒、奶水品項、操作紀錄、LINE群組紀錄（已存在就略過）
 * 2. setStaffPassword()       先改下方姓名與密碼再執行，建立第一位管理者
 * 3. installDailyTrigger()    每天 09:00 推播奶水回購提醒到 LINE 群組
 * 4. backfillMilkReminders()  （選用）用舊訂單補建回購提醒
 * 不會修改既有分頁的資料，只會新增分頁、在新分頁寫入。
 */

function setupSheets() {
  const ss = SpreadsheetApp.getActive();
  const defs = {
    '人員': ['姓名', '角色', '啟用', '密碼雜湊', '鹽', '建立日期'],
    '回購提醒': ['提醒ID', '訂單編號', '客戶ID', '客戶', '電話', '商品', '總罐數', '每日罐數', '起算日', '預計喝完日', '提醒日', '狀態', '處理人', '處理時間', '已推播', '備註', '建立時間'],
    '奶水品項': ['關鍵字', '每箱罐數', '說明'],
    '操作紀錄': ['時間', '人員', '操作', '內容'],
    'LINE群組紀錄': ['群組ID', '記錄時間', '事件']
  };
  Object.keys(defs).forEach(name => {
    if (ss.getSheetByName(name)) return;
    const sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, defs[name].length).setValues([defs[name]]).setFontWeight('bold').setBackground('#F4F2FD');
    sh.setFrozenRows(1);
  });
  // 奶水品項預設值（每箱罐數含贈品，請依實際方案調整）
  const milk = ss.getSheetByName('奶水品項');
  if (milk.getLastRow() === 1) {
    milk.getRange(2, 1, 4, 3).setValues([
      ['補體素', 26, '24+2'],
      ['倍速', 26, '24+2（含倍速力、倍速益）'],
      ['力增', 24, '依方案不同請於建單時修改罐數'],
      ['奶水', 24, '品名含「奶水」通用規則']
    ]);
  }
  // 人員密碼欄不給一般檢視者看
  ss.getSheetByName('人員').hideColumns(4, 2);
}

/** 改好姓名、角色、密碼後執行；執行完請把密碼從這裡刪掉 */
function setStaffPassword() {
  const NAME = '請填姓名';
  const ROLE = '管理者';   // 管理者 或 一般
  const PASSWORD = '請填密碼至少6碼';
  const t = readTable_('人員');
  if (!t.rows.some(r => r['姓名'] === NAME)) appendRow_('人員', { 姓名: NAME, 角色: ROLE, 啟用: true, 建立日期: today_() });
  setPassword_(NAME, PASSWORD);
  console.log('已設定：' + NAME);
}

function installDailyTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyReminderPush').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyReminderPush').timeBased().atHour(9).everyDays(1).inTimezone(TZ).create();
}

/** 用既有訂單補建回購提醒：已出貨／已取貨且明細含奶水關鍵字者 */
function backfillMilkReminders() {
  const orders = readTable_('訂單').rows;
  const items = readTable_('訂單明細').rows;
  const ships = readTable_('出貨紀錄').rows;
  const existing = readTable_('回購提醒').rows.map(r => r['訂單編號'] + '|' + r['商品']);
  let n = +nextId_(readTable_('回購提醒').rows, '提醒ID', 'R', 5).slice(1) - 1;
  const created = [];
  orders.forEach(o => {
    if (!/已出貨|已取貨|已送達|配送中/.test(String(o['出貨狀態']))) return;
    const ship = ships.filter(s => s['訂單編號'] === o['訂單編號']).pop();
    const start = (ship && ship['出貨日期']) || o['訂單日期'];
    if (!start) return;
    items.filter(it => it['訂單編號'] === o['訂單編號']).forEach(it => {
      const rule = milkRule_(it['商品名稱']);
      if (!rule || existing.indexOf(o['訂單編號'] + '|' + it['商品名稱']) >= 0) return;
      const cans = num_(it['數量']) * num_(rule['每箱罐數']);
      const end = addDays_(String(start).slice(0, 10), cans);
      n += 1;
      appendRow_('回購提醒', {
        提醒ID: 'R' + String(n).padStart(5, '0'), 訂單編號: o['訂單編號'], 客戶ID: o['客戶ID'], 客戶: o['客戶'], 電話: o['客戶電話'],
        商品: it['商品名稱'], 總罐數: cans, 每日罐數: 1, 起算日: String(start).slice(0, 10), 預計喝完日: end,
        提醒日: addDays_(end, -REMIND_DAYS_BEFORE), 狀態: end < today_() ? '已過期' : '待聯繫', 建立時間: now_(), 備註: '舊資料補建，罐數請確認'
      });
      created.push(o['訂單編號']);
    });
  });
  console.log('補建 ' + created.length + ' 筆');
}
