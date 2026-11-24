/* 信男藥局 私下訂單系統 — 前端（單頁，無框架） */
(function () {
  'use strict';
  const API = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
  const DEMO = !API;
  const root = document.getElementById('root');

  const S = {
    token: sessionStorage.getItem('token') || '',
    user: JSON.parse(sessionStorage.getItem('user') || 'null'),
    data: null, route: 'orders', filter: '全部', q: '', sel: null,
    remindTab: 'today', brand: '全部', draft: null, staffList: null, busy: false
  };

  /* ---------- 工具 ---------- */
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => { const x = Number(String(v == null ? '' : v).replace(/[,$\s]/g, '')); return isFinite(x) ? x : 0; };
  const money = v => (v === '' || v == null) ? '—' : Math.round(n(v)).toLocaleString('en-US');
  const pct = v => (v === '' || v == null || !isFinite(v)) ? '—' : (v * 100).toFixed(1) + '%';
  const todayStr = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
  const icon = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    list: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.4"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.8-3.2 3.3-4.8 6-4.8s5.2 1.6 6 4.8"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 15.5c1.5.7 2.6 2.2 3 4.5"/>',
    out: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'
  };
  const svg = (k, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon[k]}</svg>`;

  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }

  /* ---------- API ---------- */
  async function api(action, payload = {}) {
    if (DEMO) return demoApi(action, payload);
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: S.token, ...payload }) });
    const j = await res.json();
    if (!j.ok) {
      if (j.code === 'AUTH') { logoutLocal(); throw new Error(j.error); }
      throw new Error(j.error || '發生錯誤');
    }
    return j.data;
  }

  // 示範模式：在瀏覽器記憶體模擬後端
  const D = window.DEMO_DATA;
  function demoApi(action, p) {
    return new Promise((ok, fail) => setTimeout(() => {
      try {
        if (action === 'listStaff') return ok(D.staff);
        if (action === 'login') { if (!p.password) throw new Error('請輸入密碼'); return ok({ token: 'demo', user: { name: p.name, role: p.name === '示範管理者' ? '管理者' : '一般' } }); }
        if (action === 'bootstrap') return ok({ user: S.user, settings: D.settings, orders: D.orders, items: D.items, customers: D.customers, quotes: D.quotes, shipments: D.shipments, payments: D.payments, reminders: D.reminders, milk: D.milk, priceTable: D.priceTable, aliases: D.aliases, remindDaysBefore: 5, today: todayStr() });
        if (action === 'productIndex') return ok(D.products.map(x => [x.商品貨號, x.商品名稱, x.成本 != null ? x.成本 : (x.單位成本 || ''), x.品牌 || '', x.規格 || '']));
        if (action === 'searchProducts') { const k = p.keyword.toLowerCase(); return ok(D.products.filter(x => (x.商品名稱 + x.商品貨號).toLowerCase().includes(k))); }
        if (action === 'createOrder') {
          const o = p.order, ymd = (o.date || todayStr()).replace(/-/g, '');
          const seq = D.orders.filter(x => x.訂單編號.startsWith(ymd)).length + 1, no = ymd + '-' + String(seq).padStart(2, '0');
          let c = D.customers.find(x => x.客戶ID === o.customer.id);
          if (!c) { c = { 客戶ID: 'C' + String(D.customers.length + 1).padStart(4, '0'), 姓名: o.customer.name, 電話: o.customer.phone }; D.customers.push(c); }
          let goods = 0, cost = 0; o.items.forEach(i => { goods += n(i.qty) * n(i.price); cost += n(i.qty) * n(i.unitCost); });
          const total = goods - n(o.discount) + n(o.shipping);
          D.orders.unshift({ 訂單編號: no, 訂單日期: o.date || todayStr(), 類型: o.type, 來源: o.source, 客戶ID: c.客戶ID, 客戶: o.customer.name, 客戶電話: o.customer.phone, 收件人: o.recipient.name, 收件電話: o.recipient.phone, '收件地址/門市': o.recipient.address, 寄送方式: o.shippingMethod, 商品金額: goods, 折扣: n(o.discount), 運費: n(o.shipping), 訂單總額: total, 成本合計: cost, 毛利: goods - n(o.discount) - cost, 毛利率: goods ? (goods - n(o.discount) - cost) / (goods - n(o.discount)) : '', 付款方式: o.paymentMethod, 付款狀態: o.paid ? '已付款' : '待付款', 出貨狀態: '待出貨', 接單人: S.user.name });
          o.items.forEach((i, k) => D.items.push({ 明細ID: no + '-' + (k + 1), 訂單編號: no, 商品貨號: i.sku, 商品名稱: i.name, 數量: n(i.qty), 單價: n(i.price), 小計: n(i.qty) * n(i.price), 成本: n(i.qty) * n(i.unitCost), 贈品: i.gift ? '是' : '' }));
          o.items.filter(i => !i.gift && n(i.cans) > 0).forEach(i => {
            D.reminders.filter(r => r.客戶ID === c.客戶ID && /待聯繫|已聯繫|未出貨/.test(r.狀態)).forEach(r => { r.狀態 = '已回購'; });
            D.reminders.push({ 提醒ID: 'R' + String(D.reminders.length + 1).padStart(5, '0'), 訂單編號: no, 客戶ID: c.客戶ID, 客戶: o.customer.name, 電話: o.customer.phone, 商品: i.name, 總罐數: n(i.cans), 每日罐數: n(o.cansPerDay) || 1, 狀態: '未出貨' });
          });
          return ok({ orderNo: no, customerId: c.客戶ID, total });
        }
        if (action === 'shipOrder') {
          const o = D.orders.find(x => x.訂單編號 === p.shipment.orderNo); const date = p.shipment.date || todayStr();
          Object.assign(o, { 物流商: p.shipment.carrier, 物流單號: p.shipment.trackingNo, 出貨狀態: '已出貨' });
          D.shipments.push({ 出貨ID: 'S' + String(D.shipments.length + 1).padStart(4, '0'), 訂單編號: o.訂單編號, 出貨日期: date, 物流商: p.shipment.carrier, 物流單號: p.shipment.trackingNo });
          D.reminders.filter(r => r.訂單編號 === o.訂單編號 && r.狀態 === '未出貨').forEach(r => { const days = Math.floor(n(r.總罐數) / (n(r.每日罐數) || 1)); r.起算日 = date; r.預計喝完日 = addDays(date, days); r.提醒日 = addDays(r.預計喝完日, -5); r.狀態 = '待聯繫'; });
          return ok({});
        }
        if (action === 'markPaid') { D.orders.find(x => x.訂單編號 === p.payment.orderNo).付款狀態 = '已付款'; D.payments.push({ 訂單編號: p.payment.orderNo, 收款日期: todayStr() }); return ok({}); }
        if (action === 'updateReminder') {
          const r = D.reminders.find(x => x.提醒ID === p.reminder.id);
          if (p.reminder.status) r.狀態 = p.reminder.status;
          if (p.reminder.note !== undefined) r.備註 = p.reminder.note;
          if (p.reminder.cansPerDay) { r.每日罐數 = n(p.reminder.cansPerDay); if (r.起算日) { r.預計喝完日 = addDays(r.起算日, Math.floor(n(r.總罐數) / r.每日罐數)); r.提醒日 = addDays(r.預計喝完日, -5); } }
          r.處理人 = S.user.name; return ok({});
        }
        if (action === 'listStaffAdmin') return ok(D.staff.map(x => ({ 姓名: x, 角色: x === '示範管理者' ? '管理者' : '一般', 啟用: true })));
        if (action === 'addStaff') { D.staff.push(p.name); return ok({}); }
        if (['resetPassword', 'setStaffActive', 'changePassword', 'logout'].includes(action)) return ok({});
        throw new Error('示範模式不支援：' + action);
      } catch (e) { fail(e); }
    }, 150));
  }
  function addDays(s, k) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + k); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  /* ---------- 登入 ---------- */
  async function renderLogin(err = '') {
    root.innerHTML = `${DEMO ? '<div class="demo-bar">示範模式：尚未連接資料庫，畫面中的資料都是遮蔽過的範例</div>' : ''}
      <div class="login-wrap"><form class="login" id="loginForm" autocomplete="off">
        <div class="logo">信</div>
        <div><h1 style="margin:0 0 4px;font-size:22px">私下訂單系統</h1><span class="sub">信男藥局 · 請選擇你的名字並輸入密碼</span></div>
        <fieldset style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:8px"><legend class="sec-title" style="margin-bottom:8px">人員</legend><div class="names" id="names"><span class="sub">載入中…</span></div></fieldset>
        <label class="field"><span>密碼</span><input type="password" id="pw" autocomplete="current-password" required></label>
        <div class="err" id="err" role="alert">${esc(err)}</div>
        <button class="btn dark" type="submit" id="loginBtn" disabled>登入</button>
      </form></div>`;
    let picked = '';
    try {
      const names = await api('listStaff');
      const box = document.getElementById('names');
      box.innerHTML = names.length ? names.map(x => `<button type="button" data-name="${esc(x)}" aria-pressed="false">${esc(x)}</button>`).join('') : '<span class="sub">尚未建立人員，請管理者先在 Apps Script 執行 setStaffPassword</span>';
      box.onclick = e => {
        const b = e.target.closest('button[data-name]'); if (!b) return;
        picked = b.dataset.name;
        box.querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
        document.getElementById('loginBtn').disabled = false; document.getElementById('pw').focus();
      };
    } catch (e) { document.getElementById('err').textContent = '無法連線：' + e.message; }
    document.getElementById('loginForm').onsubmit = async e => {
      e.preventDefault(); if (!picked) return;
      const btn = document.getElementById('loginBtn'); btn.disabled = true; btn.textContent = '登入中…';
      try {
        const r = await api('login', { name: picked, password: document.getElementById('pw').value });
        S.token = r.token; S.user = r.user;
        sessionStorage.setItem('token', r.token); sessionStorage.setItem('user', JSON.stringify(r.user));
        await load(); go(remindersDue().length ? 'reminders' : 'orders');
      } catch (err2) { document.getElementById('err').textContent = err2.message; btn.disabled = false; btn.textContent = '登入'; }
    };
  }
  function logoutLocal() { S.token = ''; S.user = null; S.data = null; sessionStorage.clear(); renderLogin('請重新登入'); }

  async function load() { S.data = await api('bootstrap'); }

  /* ---------- 共用計算 ---------- */
  const orderItems = no => S.data.items.filter(i => i.訂單編號 === no);
  const statusTag = o => {
    if (o.付款狀態 === '待付款' && o.出貨狀態 === '待出貨') return '<span class="tag t-pay">待付款</span>';
    const m = { 待出貨: 't-wait', 已出貨: 't-ship', 配送中: 't-ship', 已取貨: 't-done', 已送達: 't-done' }[o.出貨狀態] || 't-done';
    return `<span class="tag ${m}">${esc(o.出貨狀態 || '—')}</span>`;
  };
  function remindersDue() {
    const t = todayStr();
    return (S.data.reminders || []).filter(r => r.狀態 === '待聯繫' && r.提醒日 && r.提醒日 <= t);
  }
  const milkRule = name => (S.data.milk || []).find(r => r.關鍵字 && String(name).includes(r.關鍵字));
  const pickKey = (row, re) => Object.keys(row).find(k => re.test(k));

  /* ---------- 版面 ---------- */
  function go(route, sel) { S.route = route; S.sel = sel || null; location.hash = route; render(); }

  function render() {
    if (!S.user) return renderLogin();
    if (!S.data) { root.innerHTML = '<div class="empty">載入中…</div>'; load().then(render).catch(e => toast(e.message)); return; }
    const due = remindersDue().length;
    const links = [
      ['create', 'plus', '建單'], ['orders', 'list', '訂單'], ['ship', 'truck', '出貨'],
      ['reminders', 'bell', '奶水回購提醒', due], ['prices', 'tag', '成本報價表']
    ];
    if (S.user.role === '管理者') links.push(['staff', 'users', '人員管理']);
    root.innerHTML = `${DEMO ? '<div class="demo-bar">示範模式：尚未連接資料庫，資料只存在這個分頁，重新整理就會還原</div>' : ''}
      <div class="app">
        <nav class="nav" aria-label="主選單"><div class="logo">信</div>
          ${links.map(([r, ic, label, b]) => `<a href="#${r}" data-go="${r}" aria-label="${label}" title="${label}" class="${S.route === r ? 'on' : ''}" ${S.route === r ? 'aria-current="page"' : ''}>${svg(ic)}${b ? `<span class="badge num">${b}</span>` : ''}</a>`).join('')}
          <span class="spacer"></span>
          <a href="#account" data-go="account" aria-label="我的帳號：${esc(S.user.name)}" title="我的帳號" class="${S.route === 'account' ? 'on' : ''}">${svg('users')}</a>
          <a href="#" data-act="logout" aria-label="登出" title="登出">${svg('out')}</a>
          <span class="me">${esc(S.user.name)}</span>
        </nav>
        <main class="main" id="main"></main>
        <aside class="side" id="side" aria-label="詳情"></aside>
      </div>`;
    root.querySelector('.nav').onclick = e => {
      const a = e.target.closest('a'); if (!a) return; e.preventDefault();
      if (a.dataset.act === 'logout') { api('logout').catch(() => {}); logoutLocal(); return; }
      go(a.dataset.go);
    };
    ({ orders: viewOrders, create: viewCreate, ship: viewShip, reminders: viewReminders, prices: viewPrices, staff: viewStaff, account: viewAccount }[S.route] || viewOrders)();
  }
  const $main = () => document.getElementById('main');
  const $side = () => document.getElementById('side');

  async function run(btn, fn) {
    if (S.busy) return; S.busy = true; const t = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = '處理中…'; }
    try { await fn(); } catch (e) { toast(e.message); if (btn) { btn.disabled = false; btn.textContent = t; } } finally { S.busy = false; }
  }

  /* ---------- 訂單總覽 ---------- */
  function viewOrders() {
    const all = S.data.orders.slice().sort((a, b) => String(b.訂單編號).localeCompare(String(a.訂單編號)));
    const F = {
      全部: () => true, 待付款: o => o.付款狀態 === '待付款', 待出貨: o => o.出貨狀態 === '待出貨',
      配送中: o => /已出貨|配送中/.test(o.出貨狀態), B2B: o => o.類型 === 'B2B'
    };
    const q = S.q.trim().toLowerCase();
    const list = all.filter(F[S.filter]).filter(o => !q || [o.客戶, o.客戶電話, o.收件人, o.物流單號, o.訂單編號].join(' ').toLowerCase().includes(q));
    $main().innerHTML = `
      <header class="head"><h1>訂單</h1>
        <label class="search">${svg('search', 16)}<input type="search" id="q" placeholder="搜尋客戶、電話、物流單號" value="${esc(S.q)}" aria-label="搜尋訂單"></label></header>
      <div class="pills" role="group" aria-label="篩選">${Object.keys(F).map(k => `<button class="pill ${S.filter === k ? 'on' : ''}" data-f="${k}" aria-pressed="${S.filter === k}">${k} <span class="num">${all.filter(F[k]).length}</span></button>`).join('')}</div>
      <div class="list">${list.length ? list.map(o => {
        const its = orderItems(o.訂單編號), first = its[0];
        const desc = first ? `${esc(first.商品名稱)} × ${esc(first.數量)}${its.length > 1 ? ` 外 ${its.length - 1} 項` : ''}` : '—';
        return `<button class="row ${S.sel === o.訂單編號 ? 'on' : ''}" data-o="${esc(o.訂單編號)}">
          <span class="who"><b>${esc(o.客戶)}${o.類型 === 'B2B' ? ' <span style="font-size:11px;color:var(--accent)">B2B</span>' : ''}</b><span class="meta num">${esc(o.訂單編號)}</span></span>
          <span>${desc}</span><span class="amt num">$${money(o.訂單總額)}</span>${statusTag(o)}</button>`;
      }).join('') : '<div class="empty">沒有符合的訂單</div>'}</div>`;
    $main().querySelector('.pills').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { S.filter = b.dataset.f; viewOrders(); } };
    $main().querySelector('.list').onclick = e => { const b = e.target.closest('[data-o]'); if (b) { S.sel = b.dataset.o; viewOrders(); } };
    const qi = document.getElementById('q'); qi.oninput = () => { S.q = qi.value; const p = qi.selectionStart; viewOrders(); const n2 = document.getElementById('q'); n2.focus(); n2.setSelectionRange(p, p); };
    sideOrder(S.sel ? S.data.orders.find(o => o.訂單編號 === S.sel) : null);
  }

  function sideOrder(o) {
    const side = $side();
    if (!o) { side.innerHTML = ''; return; }
    const its = orderItems(o.訂單編號);
    const ships = S.data.shipments.filter(s => s.訂單編號 === o.訂單編號);
    const pays = S.data.payments.filter(p => p.訂單編號 === o.訂單編號);
    const ev = [];
    ships.forEach(s => ev.push([s.出貨日期, `已出貨（${s.物流商} ${s.物流單號 || ''}）`]));
    pays.forEach(p => ev.push([p.收款日期, '已收款']));
    ev.push([o.訂單日期, '建單']);
    ev.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    const quotes = S.data.quotes.filter(q => q.客戶ID === o.客戶ID).slice(-5).reverse();
    const reminders = (S.data.reminders || []).filter(r => r.訂單編號 === o.訂單編號 && r.預計喝完日);
    side.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="display:flex;flex-direction:column;gap:4px"><span class="sub num">${esc(o.訂單編號)} · ${esc(o.來源 || '')}</span><span style="font-size:20px;font-weight:700">${esc(o.客戶)}</span><span class="sub num">${esc(o.客戶電話 || '')}</span></div>
        <button class="close" data-act="close" aria-label="關閉">×</button></div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${its.map(i => `<div class="kv"><span style="color:var(--ink)">${esc(i.商品名稱)} × ${esc(i.數量)}${i.贈品 ? '（贈品）' : ''}</span><span class="num">${money(i.小計)}</span></div>`).join('')}
        <div class="kv" style="border-top:1px solid var(--bg);padding-top:10px"><b>訂單總額</b><b class="num">$${money(o.訂單總額)}</b></div>
        <div class="kv"><span>收件</span><span style="text-align:right">${esc(o.收件人 || '')} · ${esc(o['收件地址/門市'] || '')}</span></div>
        <div class="kv"><span>付款</span><span>${esc(o.付款方式 || '')} · ${esc(o.付款狀態 || '')}</span></div>
      </div>
      <div class="timeline"><div class="sec-title" style="margin-bottom:12px">貨況</div>
        ${ev.map(([d, t]) => `<div class="t"><div class="dot"><i></i><s></s></div><div class="body"><span>${esc(t)}</span><span class="sub num">${esc(String(d || '').slice(5))}</span></div></div>`).join('')}</div>
      ${reminders.length ? `<div class="box">${reminders.map(r => `<div class="kv"><span>奶水預計喝完</span><b class="num">${esc(r.預計喝完日)}</b></div>`).join('')}</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--bg);padding-top:18px">
        <span class="sec-title">這位客人的報價紀錄</span>
        ${quotes.length ? quotes.map(q => `<div style="display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:8px;font-size:13px"><span>${esc(q.商品名稱)}</span><span class="num" style="text-align:right;font-weight:600">${money(q.單價)}</span><span class="num sub" style="text-align:right">${esc(q.日期)}</span></div>`).join('') : '<span class="sub">尚無紀錄</span>'}
        <div class="box" style="flex-direction:row;justify-content:space-between;padding:12px 14px"><span>本單毛利</span><b class="num" style="color:var(--accent-ink)">${o.毛利 === '' ? '[成本待補]' : '$' + money(o.毛利) + '（' + pct(n(o.毛利率)) + '）'}</b></div>
      </div>
      <div class="btns">
        ${o.出貨狀態 === '待出貨' ? `<button class="btn" data-act="toShip">出貨</button>` : `<a class="btn" style="display:flex;align-items:center;justify-content:center;text-decoration:none;color:var(--ink)" href="${trackUrl(o)}" target="_blank" rel="noopener">查詢貨況</a>`}
        ${o.付款狀態 !== '已付款' ? `<button class="btn dark" data-act="paid">標記已收款</button>` : `<button class="btn dark" disabled>已收款</button>`}
      </div>`;
    side.onclick = e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'close') { S.sel = null; viewOrders(); }
      if (b.dataset.act === 'toShip') go('ship', o.訂單編號);
      if (b.dataset.act === 'paid') run(b, async () => { await api('markPaid', { payment: { orderNo: o.訂單編號 } }); await load(); toast('已標記收款'); render(); });
    };
  }
  function trackUrl(o) {
    const c = o.物流商 || '';
    if (/新竹/.test(c)) return 'https://www.hct.com.tw/search/searchgoods_n.aspx';
    if (/郵/.test(c)) return 'https://postserv.post.gov.tw/pstmail/main_mail.html';
    if (/7-11|賣貨便/.test(c)) return 'https://eservice.7-11.com.tw/e-tracking/search.aspx';
    if (/全家|好賣/.test(c)) return 'https://fmec.famiport.com.tw/FP_Entrance/QueryBox';
    return '#';
  }

  /* ---------- 建單 ---------- */
  function newDraft() {
    return { type: '零售', source: (S.data.settings.來源 || ['LINE 私訊'])[0], date: todayStr(), customer: { id: '', name: '', phone: '', lineName: '' }, sameRecipient: true,
      recipient: { name: '', phone: '', address: '' }, shippingMethod: '7-11賣貨便', items: [blankItem()], discount: 0, shipping: 0,
      paymentMethod: '匯款', paid: false, last5: '', note: '', makeQuote: false, cansPerDay: 1 };
  }
  function blankItem() { return { sku: '', name: '', qty: 1, price: '', unitCost: '', gift: false, cans: 0, costSource: '', priceSource: '' }; }

  function viewCreate() {
    const d = S.draft || (S.draft = newDraft());
    loadProdIdx();
    const pastOrders = d.customer.id ? S.data.orders.filter(o => o.客戶ID === d.customer.id).length : 0;
    const set = S.data.settings;
    $main().innerHTML = `
      <header class="head"><div style="display:flex;flex-direction:column;gap:4px"><h1>建單</h1><span class="sub">手動建立 LINE、電話、批發訂單；確認後才寫入資料庫</span></div>
        <div class="pills" role="group" aria-label="訂單類型">${['零售', 'B2B'].map(t => `<button class="pill ${d.type === t ? 'on' : ''}" data-type="${t}" aria-pressed="${d.type === t}">${t === 'B2B' ? 'B2B 批發／機構' : '零售'}</button>`).join('')}</div></header>
      <div style="display:flex;flex-wrap:wrap;gap:14px">
        <div class="card" style="flex:1 1 300px;display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:center"><span class="sec-title">客戶</span>
            ${d.customer.id ? `<span class="tag t-ship">回購 · 第 ${pastOrders + 1} 次 · ${esc(d.customer.id)}</span> ` : (d.customer.name || d.customer.phone ? '<span class="tag t-wait">新客</span>' : '')}</div>
          <div class="grid2"><label class="field"><span>姓名</span><input data-k="customer.name" value="${esc(d.customer.name)}" placeholder="輸入姓名、電話或 LINE 名稱找舊客戶" autocomplete="off"></label>
            <label class="field"><span>電話</span><input data-k="customer.phone" inputmode="tel" value="${esc(d.customer.phone)}" autocomplete="off"></label></div>
          ${d.customer.id ? '<button class="btn" style="min-height:40px" data-act="unlinkCust">改為新客戶</button>' : ''}
          <div class="grid2"><label class="field"><span>來源</span><select data-k="source">${(set.來源 || ['LINE 官方帳號', 'LINE 私訊', '電話', '批發／機構']).map(x => `<option ${d.source === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
            <label class="field"><span>訂單日期</span><input type="date" data-k="date" value="${esc(d.date)}"></label></div>
        </div>
        <div class="card" style="flex:1 1 300px;display:flex;flex-direction:column;gap:12px">
          <span class="sec-title">收件與寄送</span>
          <label class="switch"><span>收件人同訂購人</span><input type="checkbox" data-k="sameRecipient" ${d.sameRecipient ? 'checked' : ''}></label>
          ${d.sameRecipient ? '' : `<div class="grid2"><label class="field"><span>收件人</span><input data-k="recipient.name" value="${esc(d.recipient.name)}"></label><label class="field"><span>收件電話</span><input data-k="recipient.phone" value="${esc(d.recipient.phone)}"></label></div>`}
          <label class="field"><span>寄送方式</span><select data-k="shippingMethod">${['7-11賣貨便', '全家好賣+', '全家店到店', '新竹物流', '宅配', '郵寄', '自取'].map(x => `<option ${d.shippingMethod === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label class="field"><span>地址／取件門市</span><input data-k="recipient.address" value="${esc(d.recipient.address)}"></label>
        </div>
      </div>
      <div class="list" style="padding:12px;position:relative">
        <table class="items"><thead><tr><th style="width:34%">品項</th><th>數量</th><th>單價</th><th>小計</th><th>成本/單位</th><th>奶水罐數</th><th>贈品</th><th></th></tr></thead>
        <tbody>${d.items.map((it, i) => `<tr>
          <td><input data-i="${i}" data-f="name" value="${esc(it.name)}" placeholder="輸入品名或貨號搜尋" aria-label="品項 ${i + 1}">${it.priceSource || it.costSource ? `<div class="sub" style="font-size:11px;margin-top:3px;color:var(--accent)">${esc([it.priceSource, it.costSource].filter(Boolean).join(' · '))}</div>` : ''}</td>
          <td><input class="num" data-i="${i}" data-f="qty" inputmode="numeric" value="${esc(it.qty)}" aria-label="數量"></td>
          <td><input class="num" data-i="${i}" data-f="price" inputmode="decimal" value="${esc(it.price)}" aria-label="單價"></td>
          <td class="num" style="text-align:right;font-weight:600">${money(n(it.qty) * n(it.price))}</td>
          <td><input class="num" data-i="${i}" data-f="unitCost" inputmode="decimal" value="${esc(it.unitCost)}" aria-label="單位成本"></td>
          <td><input class="num" data-i="${i}" data-f="cans" inputmode="numeric" value="${it.cans ? esc(it.cans) : ''}" placeholder="非奶水" aria-label="奶水總罐數"></td>
          <td style="text-align:center"><input type="checkbox" data-i="${i}" data-f="gift" ${it.gift ? 'checked' : ''} aria-label="贈品" style="width:20px;height:20px;accent-color:var(--accent)"></td>
          <td><button class="del" data-del="${i}" aria-label="刪除品項">×</button></td></tr>`).join('')}</tbody></table>
        <button class="btn soft" style="align-self:flex-start;margin:6px" data-act="addItem">＋ 新增品項</button>
        <div id="sug" class="suggest" hidden></div>
      </div>`;
    sideCreate();
    bindCreate();
  }

  function draftTotals(d) {
    let goods = 0, cost = 0, missing = 0;
    d.items.forEach(i => { goods += n(i.qty) * n(i.price); cost += n(i.qty) * n(i.unitCost); if (i.name && i.unitCost === '') missing++; });
    const net = goods - n(d.discount); const profit = net - cost;
    return { goods, cost, total: net + n(d.shipping), profit, rate: net ? profit / net : NaN, missing };
  }

  function sideCreate() {
    const d = S.draft, t = draftTotals(d), set = S.data.settings;
    const milkItems = d.items.filter(i => n(i.cans) > 0 && !i.gift);
    const warns = [];
    if (!d.customer.name) warns.push('請填客戶姓名');
    if (!d.items.some(i => i.name)) warns.push('至少要有一個品項');
    if (t.missing) warns.push(`${t.missing} 個品項沒有成本，毛利會偏高`);
    const noPrice = d.items.filter(i => i.name && !i.gift && i.price === '').length;
    if (noPrice) warns.push(`${noPrice} 個品項還沒填單價`);
    $side().innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px"><span class="sub">新訂單 · ${esc(d.type)}</span><span style="font-size:20px;font-weight:700">建單預覽</span></div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="kv"><span>商品金額</span><b class="num">${money(t.goods)}</b></div>
        <label class="kv" style="align-items:center"><span>折扣</span><input class="num" data-k="discount" inputmode="decimal" value="${esc(d.discount)}" style="width:110px;min-height:40px;border:0;border-radius:12px;background:var(--bg);text-align:right;padding:0 10px"></label>
        <label class="kv" style="align-items:center"><span>運費</span><input class="num" data-k="shipping" inputmode="decimal" value="${esc(d.shipping)}" style="width:110px;min-height:40px;border:0;border-radius:12px;background:var(--bg);text-align:right;padding:0 10px"></label>
        <div class="kv" style="border-top:1px solid var(--bg);padding-top:12px"><b>訂單總額</b><b class="num" style="font-size:20px">$${money(t.total)}</b></div>
      </div>
      <div class="box"><div class="kv"><span>成本合計</span><span class="num">${money(t.cost)}</span></div>
        <div class="kv"><span>毛利</span><b class="num" style="color:var(--accent-ink)">${money(t.profit)}</b></div>
        <div class="kv"><span>毛利率</span><b class="num" style="color:var(--accent-ink)">${pct(t.rate)}</b></div></div>
      ${milkItems.length ? `<div class="box" style="background:var(--s-wait-bg)"><span class="sec-title" style="color:var(--s-wait)">奶水回購提醒</span>
        <label class="kv" style="align-items:center"><span>客人每天喝幾罐</span><input class="num" data-k="cansPerDay" inputmode="decimal" value="${esc(d.cansPerDay)}" style="width:80px;min-height:40px;border:0;border-radius:12px;background:#fff;text-align:right;padding:0 10px"></label>
        <span style="font-size:13px;color:var(--s-wait)">共 ${milkItems.reduce((a, i) => a + n(i.cans), 0)} 罐，約可喝 ${Math.floor(milkItems.reduce((a, i) => a + n(i.cans), 0) / (n(d.cansPerDay) || 1))} 天；出貨後開始計算，喝完前 ${S.data.remindDaysBefore || 5} 天提醒</span></div>` : ''}
      <div style="display:flex;flex-direction:column;gap:10px">
        <label class="field"><span>付款方式</span><select data-k="paymentMethod">${(set.付款方式 || ['匯款', '貨到付款', '取貨付款', '月結']).map(x => `<option ${d.paymentMethod === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        ${d.paymentMethod === '匯款' ? `<label class="field"><span>匯款末五碼</span><input class="num" data-k="last5" maxlength="5" inputmode="numeric" value="${esc(d.last5)}"></label>` : ''}
        <label class="switch"><span>已收到款項</span><input type="checkbox" data-k="paid" ${d.paid ? 'checked' : ''}></label>
        <label class="switch"><span style="display:flex;flex-direction:column;gap:2px"><b>產生客戶報價單</b><span class="sub" style="font-size:12px">隱藏成本與毛利，可另存 PDF</span></span><input type="checkbox" role="switch" data-k="makeQuote" ${d.makeQuote ? 'checked' : ''}></label>
        <label class="field"><span>備註</span><textarea data-k="note">${esc(d.note)}</textarea></label>
      </div>
      ${warns.length ? `<div class="warnbox"><b>建單前請確認</b><br>${warns.map(esc).join('<br>')}</div>` : ''}
      <div class="btns"><button class="btn" data-act="reset">清空</button><button class="btn dark" data-act="submit" ${!d.customer.name || !d.items.some(i => i.name) ? 'disabled' : ''}>確認建單</button></div>`;
  }

  function setPath(obj, path, val) { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach(k => { o = o[k]; }); o[ks[ks.length - 1]] = val; }

  function bindCreate() {
    const d = S.draft;
    const rerender = (focusSel) => {
      const a = document.activeElement, sel = focusSel || (a && (a.dataset.k ? `[data-k="${a.dataset.k}"]` : a.dataset.f ? `[data-i="${a.dataset.i}"][data-f="${a.dataset.f}"]` : null));
      const pos = a && a.selectionStart; viewCreate();
      if (sel) { const el = document.querySelector(sel); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { } } }
    };
    const onField = e => {
      const el = e.target;
      if (el.dataset.k) {
        const v = el.type === 'checkbox' ? el.checked : el.value; setPath(d, el.dataset.k, v);
        if (el.dataset.k === 'customer.name' || el.dataset.k === 'customer.phone') { if (d.customer.id && e.type === 'input') { /* 已綁定舊客戶時只改顯示 */ } }
        if (e.type === 'input' && (el.dataset.k === 'customer.name' || el.dataset.k === 'customer.phone')) {
          // 打字時不重畫整頁（避免注音輸入被打斷），只更新新客標籤、右側預覽與下拉選單
          const tag = el.closest('.card').querySelector('.tag.t-wait, .tag.t-ship');
          if (!d.customer.id) { const has = d.customer.name || d.customer.phone; if (tag && !has) tag.remove(); else if (!tag && has) el.closest('.card').querySelector('.sec-title').insertAdjacentHTML('afterend', '<span class="tag t-wait">新客</span>'); }
          sideCreate(); custSuggest(el); return;
        }
        if (el.type === 'checkbox' || el.tagName === 'SELECT' || e.type === 'input') rerender();
      } else if (el.dataset.f) {
        const it = d.items[+el.dataset.i], f = el.dataset.f;
        it[f] = el.type === 'checkbox' ? el.checked : el.value;
        if (f === 'gift' && it.gift) it.price = 0;
        if (f === 'qty') { const r = milkRule(it.name); if (r && it.autoCans) it.cans = n(it.qty) * n(r.每箱罐數); }
        if (f === 'cans') it.autoCans = false;
        if (f === 'name') { suggest(el, +el.dataset.i); sideCreate(); return; }
        if (el.type === 'checkbox') return rerender();
        // 數字欄：只更新小計與右側，避免打字時跳動
        const tr = el.closest('tr'); tr.children[3].textContent = money(n(it.qty) * n(it.price));
        if (f === 'qty') { const c = tr.querySelector('[data-f="cans"]'); c.value = it.cans || ''; }
        sideCreate();
      }
    };
    const main = $main(), side = $side();
    main.oninput = onField; main.onchange = e => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox' || e.target.type === 'date') onField(e); };
    side.oninput = e => { const el = e.target; if (!el.dataset.k || el.type === 'checkbox' || el.tagName === 'SELECT') return; setPath(d, el.dataset.k, el.value); const sel = `[data-k="${el.dataset.k}"]`, pos = el.selectionStart; sideCreate(); const x = $side().querySelector(sel); if (x) { x.focus(); try { x.setSelectionRange(pos, pos); } catch (e2) { } } };
    side.onchange = e => { const el = e.target; if (el.dataset.k && (el.type === 'checkbox' || el.tagName === 'SELECT')) { setPath(d, el.dataset.k, el.type === 'checkbox' ? el.checked : el.value); sideCreate(); } };
    main.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.type) { d.type = b.dataset.type; viewCreate(); }
      if (b.dataset.cust) pickCustomer(b.dataset.cust);
      if (b.dataset.act === 'unlinkCust') { d.customer.id = ''; viewCreate(); }
      if (b.dataset.act === 'addItem') { d.items.push(blankItem()); rerender(`[data-i="${d.items.length - 1}"][data-f="name"]`); }
      if (b.dataset.del != null) { d.items.splice(+b.dataset.del, 1); if (!d.items.length) d.items.push(blankItem()); viewCreate(); }
    };
    side.onclick = e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'reset') { if (confirm('確定清空這張草稿？')) { S.draft = null; viewCreate(); } }
      if (b.dataset.act === 'submit') run(b, submitOrder);
    };
  }

  function pickCustomer(id) {
    const d = S.draft, c = S.data.customers.find(x => x.客戶ID === id); if (!c) return;
    d.customer = { id: c.客戶ID, name: c.姓名, phone: c.電話, lineName: c.LINE名稱 || '' };
    const last = S.data.reminders.filter(r => r.客戶ID === c.客戶ID && n(r.每日罐數)).pop(); if (last) d.cansPerDay = n(last.每日罐數);
    d.items.forEach(it => applyLastPrice(it)); viewCreate();
  }
  /** 客戶姓名／電話欄的下拉選單：比對姓名、LINE 名稱、電話數字 */
  function custSuggest(input) {
    const box = document.getElementById('sug'), d = S.draft;
    const k = input.value.trim();
    if (!k || d.customer.id) { box.hidden = true; return; }
    const kn = norm(k), kd = k.replace(/\D/g, '');
    const stats = {}; S.data.orders.forEach(o => { const s0 = stats[o.客戶ID] || (stats[o.客戶ID] = { cnt: 0, last: '' }); s0.cnt++; if (String(o.訂單日期) > s0.last) s0.last = String(o.訂單日期); });
    const hits = S.data.customers.map(c => {
      const nm = norm(c.姓名), ln = norm(c.LINE名稱), ph = String(c.電話 || '').replace(/\D/g, '');
      let sc = -1;
      if (nm.startsWith(kn) || ln.startsWith(kn)) sc = 0; else if (nm.includes(kn) || ln.includes(kn)) sc = 1;
      else if (kd.length >= 3 && ph.includes(kd)) sc = ph.endsWith(kd) || ph.startsWith(kd) ? 0 : 1;
      return [sc, c];
    }).filter(x => x[0] >= 0)
      .sort((a, b) => a[0] - b[0] || ((stats[b[1].客戶ID] || {}).last || '').localeCompare((stats[a[1].客戶ID] || {}).last || ''))
      .slice(0, 30).map(x => x[1]);
    if (!hits.length) { box.innerHTML = `<div class="sug-note">沒有相符的舊客戶，建單時會建立為新客戶</div>`; box.hidden = false; placeSug(box, input); input.onblur = () => setTimeout(() => { box.hidden = true; }, 150); return; }
    box.innerHTML = hits.map((c, j) => { const st = stats[c.客戶ID] || { cnt: 0, last: '' };
      return `<button type="button" data-h="${j}" class="${j === 0 ? 'on' : ''}"><span class="sug-l"><b>${hilite(c.姓名, k)}${c.LINE名稱 && c.LINE名稱 !== c.姓名 ? ` <span class="sub">（LINE：${hilite(c.LINE名稱, k)}）</span>` : ''}</b><span class="sub num">${hilite(c.電話, kd.length >= 3 ? kd : k)} · ${esc(c.客戶ID)}${c.類型 ? ' · ' + esc(c.類型) : ''}</span></span><span class="sug-r"><span>${st.cnt ? '訂過 ' + st.cnt + ' 次' : '尚無訂單'}</span>${st.last ? `<span class="sub">最近 ${esc(st.last)}</span>` : ''}</span></button>`; }).join('');
    box.hidden = false; placeSug(box, input);
    let cur = 0;
    const mark = j => { const bs = box.querySelectorAll('[data-h]'); bs.forEach(x => x.classList.remove('on')); cur = (j + bs.length) % bs.length; bs[cur].classList.add('on'); bs[cur].scrollIntoView({ block: 'nearest' }); };
    box.onmousedown = e => { const b = e.target.closest('[data-h]'); if (!b) return; e.preventDefault(); box.hidden = true; pickCustomer(hits[+b.dataset.h].客戶ID); };
    input.onkeydown = e => {
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); mark(cur + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mark(cur - 1); }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); box.hidden = true; pickCustomer(hits[cur].客戶ID); }
      else if (e.key === 'Escape') { box.hidden = true; }
    };
    input.onblur = () => setTimeout(() => { box.hidden = true; }, 150);
  }

  function applyLastPrice(it) {
    const d = S.draft; if (!it.name || !d.customer.id) return;
    const q = S.data.quotes.filter(x => x.客戶ID === d.customer.id && ((it.sku && x.商品貨號 === it.sku) || x.商品名稱 === it.name)).pop();
    if (q) { it.price = n(q.單價); it.priceSource = '上次報價 ' + String(q.日期).slice(5); }
  }

  let sugTimer;
  /** 下拉選單固定在視窗上（不被表格外框裁切）；下方空間不足時往上展開 */
  function placeSug(box, input) {
    const r = input.getBoundingClientRect(), gap = 4, margin = 12;
    const below = window.innerHeight - r.bottom - gap - margin, above = r.top - gap - margin;
    const up = below < 200 && above > below;
    const h = Math.max(140, Math.min(360, up ? above : below));
    box.style.maxHeight = h + 'px';
    box.style.width = Math.max(r.width, 420) + 'px';
    box.style.left = Math.max(margin, Math.min(r.left, window.innerWidth - Math.max(r.width, 420) - margin)) + 'px';
    box.style.top = up ? Math.max(margin, r.top - gap - Math.min(h, box.scrollHeight)) + 'px' : (r.bottom + gap) + 'px';
  }
  window.addEventListener('scroll', e => { const b = document.getElementById('sug'); if (b && !b.hidden && e.target !== b) b.hidden = true; }, true);
  window.addEventListener('resize', () => { const b = document.getElementById('sug'); if (b) b.hidden = true; });
  /* ---------- 品項搜尋：報價表＋商品別名＋商品主檔，全部在瀏覽器即時比對 ---------- */
  // 全形轉半形、轉小寫、去空白與符號，讓「金補體 100」「金補體素(鉻100)」都比得到
  const norm = v => String(v == null ? '' : v).replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase().replace(/[\s　()（）\[\]【】「」.,，。、\-_/+*:：;；'"·]/g, '');
  async function loadProdIdx() {
    if (S.prodIdx || S.prodIdxLoading) return S.prodIdxLoading;
    S.prodIdxLoading = (async () => {
      let rows = [];
      try { rows = await api('productIndex'); }
      catch (e) { try { rows = (await api('searchProducts', { keyword: '' })) || []; } catch (e2) { rows = []; } }
      S.prodIdx = rows.map(r => Array.isArray(r) ? r : [r.商品貨號 || '', r.商品名稱 || r.品名 || '', r.成本 || '', r.品牌 || '', r.規格 || '']);
      S.prodIdxLoading = null; S.searchIdx = null;
    })();
    return S.prodIdxLoading;
  }
  function buildSearchIdx() {
    if (S.searchIdx && S.searchIdx.v === S.data) return S.searchIdx.list;
    const list = [], bySku = {};
    const add = (h, rank) => {
      const key = (h.sku ? 'S' + h.sku : 'N' + norm(h.name)) + '|' + norm(h.name);
      const old = bySku[key];
      if (old) { if (old.cost === '' && h.cost !== '') old.cost = h.cost; if (!old.price && h.price) old.price = h.price; if (h.alias) old.text += ' ' + norm(h.alias); return; }
      h.rank = rank; h.text = norm([h.name, h.sku, h.brand, h.spec, h.alias].join(' ')); h.nn = norm(h.name);
      bySku[key] = h; list.push(h);
    };
    (S.data.priceTable || []).forEach(p => add({ name: pName(p), sku: p.對應蝦皮貨號 || '', cost: pCost(p), price: pPrice(p), brand: p.品牌 || '', spec: p.組合 || '', src: '報價表' }, 0));
    const master = {}; (S.prodIdx || []).forEach(r => { master[r[0]] = r; });
    (S.data.aliases || []).forEach(a => {
      const m = master[a.商品貨號] || [];
      add({ name: a.常用名稱 || m[1] || '', alias: m[1] || '', sku: a.商品貨號 || '', cost: m[2] != null ? m[2] : '', price: '', brand: m[3] || '', spec: '', src: '常用名稱' }, 1);
    });
    (S.prodIdx || []).forEach(r => add({ name: r[1] || r[0], sku: r[0], cost: r[2] == null ? '' : r[2], price: '', brand: r[3] || '', spec: r[4] || '', src: '商品主檔' }, 2));
    S.searchIdx = { v: S.data, list };
    return list;
  }
  function searchItems(k) {
    const words = k.split(/\s+/).map(norm).filter(Boolean); if (!words.length) return [];
    const whole = norm(k), out = [];
    for (const h of buildSearchIdx()) {
      if (!words.every(w => h.text.includes(w))) continue;
      const score = h.rank * 10 + (h.nn.startsWith(whole) ? 0 : h.nn.includes(whole) ? 2 : 4) + Math.min(h.nn.length, 60) / 100;
      out.push([score, h]);
    }
    return out.sort((x, y) => x[0] - y[0]).slice(0, 50).map(x => x[1]);
  }
  function hilite(text, k) {
    const t = String(text || ''); const ws = k.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!ws.length) return esc(t);
    const re = new RegExp('(' + ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    return t.split(re).map((part, i) => i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part)).join('');
  }
  function suggest(input, idx) {
    clearTimeout(sugTimer);
    const box = document.getElementById('sug'); const k = input.value.trim();
    if (!k) { box.hidden = true; return; }
    if (!S.prodIdx) loadProdIdx().then(() => { if (document.activeElement === input && input.value.trim()) suggest(input, idx); });
    sugTimer = setTimeout(() => {
      const hits = searchItems(k);
      if (document.activeElement !== input) return;
      const loading = !S.prodIdx ? '<div class="sug-note">商品主檔載入中，完整結果稍後出現…</div>' : '';
      if (!hits.length) {
        box.innerHTML = loading || `<div class="sug-note">找不到「${esc(k)}」。可試試只打品牌或部分品名，或直接輸入品名後自行填單價與成本</div>`;
        box.hidden = false; placeSug(box, input); return;
      }
      box.innerHTML = hits.map((h, j) => `<button type="button" data-h="${j}" class="${j === 0 ? 'on' : ''}"><span class="sug-l"><b>${hilite(h.name, k)}</b><span class="sub">${[h.brand, h.spec].filter(Boolean).map(esc).join(' · ')}${h.brand || h.spec ? ' · ' : ''}<span class="num">${hilite(h.sku, k)}</span></span></span><span class="sug-r">${h.price ? `<span>售 ${money(h.price)}</span>` : ''}${h.cost !== '' && h.cost != null ? `<span class="sub">成本 ${money(h.cost)}</span>` : ''}<span class="tag t-${h.rank}">${h.src}</span></span></button>`).join('') + loading;
      box.hidden = false; placeSug(box, input);
      let cur = 0;
      const pick = j => {
        const h = hits[j], it = S.draft.items[idx];
        it.name = h.name; it.sku = h.sku; it.costSource = '';
        if (h.cost !== '' && h.cost != null) { it.unitCost = n(h.cost); it.costSource = '成本：' + h.src; }
        it.priceSource = ''; if (h.price) { it.price = n(h.price); it.priceSource = '報價表標準價'; }
        applyLastPrice(it);
        const rule = milkRule(it.name); if (rule && !it.gift) { it.cans = n(it.qty) * n(rule.每箱罐數); it.autoCans = true; }
        box.hidden = true; viewCreate();
        const q = document.querySelector(`[data-i="${idx}"][data-f="qty"]`); if (q) { q.focus(); q.select(); }
      };
      const mark = j => { const bs = box.querySelectorAll('[data-h]'); bs.forEach(x => x.classList.remove('on')); cur = (j + bs.length) % bs.length; bs[cur].classList.add('on'); bs[cur].scrollIntoView({ block: 'nearest' }); };
      box.onmousedown = e => { const b = e.target.closest('[data-h]'); if (!b) return; e.preventDefault(); pick(+b.dataset.h); };
      input.onkeydown = e => {
        if (box.hidden) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); mark(cur + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); mark(cur - 1); }
        else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); pick(cur); }
        else if (e.key === 'Escape') { box.hidden = true; }
      };
    }, 120);
    input.onblur = () => setTimeout(() => { box.hidden = true; }, 150);
  }

  async function submitOrder() {
    const d = S.draft;
    const items = d.items.filter(i => i.name).map(i => ({ sku: i.sku, name: i.name, qty: n(i.qty), price: n(i.price), unitCost: i.unitCost === '' ? '' : n(i.unitCost), gift: !!i.gift, cans: n(i.cans), costSource: i.costSource.replace('成本：', '') }));
    const rec = d.sameRecipient ? { name: d.customer.name, phone: d.customer.phone, address: d.recipient.address } : d.recipient;
    const order = { type: d.type, source: d.source, date: d.date, customer: d.customer, recipient: rec, shippingMethod: d.shippingMethod, items, discount: n(d.discount), shipping: n(d.shipping), paymentMethod: d.paymentMethod, paid: d.paid, last5: d.last5, note: d.note, cansPerDay: n(d.cansPerDay) || 1 };
    const r = await api('createOrder', { order });
    if (d.makeQuote) openQuote(r.orderNo, order);
    S.draft = null; await load(); toast('已建立訂單 ' + r.orderNo); go('orders', r.orderNo);
  }

  /* 客戶報價單：另開視窗，瀏覽器列印另存 PDF；不含成本與毛利 */
  function openQuote(orderNo, o) {
    const w = window.open('', '_blank'); if (!w) { toast('瀏覽器擋住了報價單視窗，請允許彈出視窗'); return; }
    const rows = o.items.map(i => `<tr><td>${esc(i.name)}${i.gift ? '（贈品）' : ''}</td><td class="r">${i.qty}</td><td class="r">${money(i.price)}</td><td class="r">${money(i.qty * i.price)}</td></tr>`).join('');
    const goods = o.items.reduce((a, i) => a + i.qty * i.price, 0);
    w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>報價單 ${esc(orderNo)}</title>
      <style>body{font-family:'Noto Sans TC',sans-serif;color:#1C1B22;margin:40px}h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:10px;border-bottom:1px solid #DCD6FB;font-size:14px;text-align:left}.r{text-align:right;font-variant-numeric:tabular-nums}.sub{color:#5D5B6A;font-size:13px}.tot{font-size:18px;font-weight:700}@media print{button{display:none}}</style></head><body>
      <h1>信男藥局 報價單</h1><p class="sub">單號 ${esc(orderNo)} · 日期 ${esc(o.date)}</p>
      <p>客戶：${esc(o.customer.name)}</p>
      <table><thead><tr><th>品項</th><th class="r">數量</th><th class="r">單價</th><th class="r">小計</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="r">商品金額 ${money(goods)}${o.discount ? `　折扣 -${money(o.discount)}` : ''}${o.shipping ? `　運費 ${money(o.shipping)}` : ''}</p>
      <p class="r tot">合計 $${money(goods - o.discount + o.shipping)}</p>
      <button onclick="print()" style="padding:12px 20px;border:0;border-radius:14px;background:#1C1B22;color:#fff;font-size:14px">列印／另存 PDF</button></body></html>`);
    w.document.close();
  }

  /* ---------- 出貨 ---------- */
  function viewShip() {
    const wait = S.data.orders.filter(o => o.出貨狀態 === '待出貨').sort((a, b) => String(a.訂單編號).localeCompare(String(b.訂單編號)));
    $main().innerHTML = `
      <header class="head"><div style="display:flex;flex-direction:column;gap:4px"><h1>出貨</h1><span class="sub">物流 KEY 單完成後，選訂單填入物流單號，狀態會改為「已出貨」</span></div></header>
      <div class="list">${wait.length ? wait.map(o => {
        const its = orderItems(o.訂單編號);
        return `<button class="row ${S.sel === o.訂單編號 ? 'on' : ''}" data-o="${esc(o.訂單編號)}"><span class="who"><b>${esc(o.收件人 || o.客戶)}</b><span class="meta num">${esc(o.訂單編號)} · ${esc(o.寄送方式 || '')}</span></span>
          <span>${its.map(i => esc(i.商品名稱) + ' × ' + esc(i.數量)).join('、')}</span><span class="amt num">$${money(o.訂單總額)}</span>${statusTag(o)}</button>`;
      }).join('') : '<div class="empty">目前沒有待出貨訂單</div>'}</div>`;
    $main().querySelector('.list').onclick = e => { const b = e.target.closest('[data-o]'); if (b) { S.sel = b.dataset.o; viewShip(); } };
    const o = S.sel && wait.find(x => x.訂單編號 === S.sel);
    if (!o) { $side().innerHTML = ''; return; }
    const carriers = S.data.settings.物流商 && S.data.settings.物流商.length ? S.data.settings.物流商 : ['7-11 賣貨便', '全家 好賣+', '全家 店到店', '新竹物流', '中華郵政', '自取'];
    const guess = carriers.find(c => (o.寄送方式 || '').replace(/\s/g, '').includes(c.replace(/\s/g, '').slice(0, 4))) || carriers[0];
    $side().innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px"><span class="sub num">${esc(o.訂單編號)}</span><span style="font-size:20px;font-weight:700">確認出貨</span></div>
      <div class="box"><div class="kv"><span>收件人</span><b>${esc(o.收件人)} <span class="num" style="font-weight:400">${esc(o.收件電話 || '')}</span></b></div>
        <div class="kv"><span>地址／門市</span><span style="text-align:right">${esc(o['收件地址/門市'] || '')}</span></div>
        <div class="kv"><span>${/取貨付款|貨到付款/.test(o.付款方式) ? '代收金額' : '訂單總額'}</span><b class="num">$${money(o.訂單總額)}</b></div></div>
      <form id="shipForm" style="display:flex;flex-direction:column;gap:12px">
        <label class="field"><span>物流商</span><select name="carrier">${carriers.map(c => `<option ${c === guess ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="field"><span>物流單號／物流條碼</span><input name="trackingNo" class="num" required autocomplete="off"></label>
        <span class="sub" style="font-size:12px">郵局特約戶編號 600047000519 不是物流單號</span>
        <label class="field"><span>出貨日期</span><input name="date" type="date" value="${todayStr()}"></label>
        <div class="btns" style="margin-top:8px"><button type="button" class="btn" data-act="cancel">取消</button><button class="btn dark" type="submit">確認出貨</button></div>
      </form>`;
    const f = document.getElementById('shipForm');
    f.querySelector('[data-act="cancel"]').onclick = () => { S.sel = null; viewShip(); };
    f.onsubmit = e => {
      e.preventDefault();
      const fd = new FormData(f), tn = String(fd.get('trackingNo')).trim();
      if (tn.replace(/\D/g, '') === '600047000519') { toast('這是郵局特約戶編號，請填掛號／託運單號'); return; }
      run(f.querySelector('[type="submit"]'), async () => {
        await api('shipOrder', { shipment: { orderNo: o.訂單編號, carrier: fd.get('carrier'), trackingNo: tn, date: fd.get('date'), cod: /取貨付款|貨到付款/.test(o.付款方式) ? o.訂單總額 : 0 } });
        await load(); S.sel = null; toast('已出貨：' + o.訂單編號); viewShip();
      });
    };
  }

  /* ---------- 奶水回購提醒 ---------- */
  function viewReminders() {
    const t = todayStr(), all = S.data.reminders || [];
    const tabs = {
      today: ['今天要聯繫', r => r.狀態 === '待聯繫' && r.提醒日 && r.提醒日 <= t],
      soon: ['追蹤中', r => r.狀態 === '待聯繫' && r.提醒日 > t],
      contacted: ['已聯繫', r => r.狀態 === '已聯繫'],
      waiting: ['尚未出貨', r => r.狀態 === '未出貨'],
      done: ['已結案', r => /已回購|暫不需要|已過期/.test(r.狀態)]
    };
    const list = all.filter(tabs[S.remindTab][1]).sort((a, b) => String(a.預計喝完日 || '9').localeCompare(String(b.預計喝完日 || '9')));
    $main().innerHTML = `
      <header class="head"><div style="display:flex;flex-direction:column;gap:4px"><h1>奶水回購提醒</h1><span class="sub">依出貨日、罐數與每日飲用量估算喝完日，提前 ${S.data.remindDaysBefore || 5} 天提醒主動詢問</span></div></header>
      <div class="pills" role="group" aria-label="提醒分類">${Object.keys(tabs).map(k => `<button class="pill ${S.remindTab === k ? 'on' : ''}" data-tab="${k}" aria-pressed="${S.remindTab === k}">${tabs[k][0]} <span class="num">${all.filter(tabs[k][1]).length}</span></button>`).join('')}</div>
      <div class="list">${list.length ? list.map(r => {
        const left = r.預計喝完日 ? daysBetween(t, r.預計喝完日) : null;
        const tag = /已回購|暫不需要|已過期/.test(r.狀態) ? `<span class="tag t-done">${esc(r.狀態)}</span>` : left == null ? '<span class="tag t-done">出貨後計算</span>' : left < 0 ? `<span class="tag t-pay">已喝完 ${-left} 天</span>` : left <= 5 ? `<span class="tag t-pay">剩 ${left} 天</span>` : `<span class="tag t-wait">剩 ${left} 天</span>`;
        return `<button class="row ${S.sel === r.提醒ID ? 'on' : ''}" data-r="${esc(r.提醒ID)}"><span class="who"><b>${esc(r.客戶)}</b><span class="meta num">${esc(r.電話 || '')}</span></span>
          <span>${esc(r.商品)} · <span class="num">${esc(r.總罐數)}</span> 罐 · 每天 <span class="num">${esc(r.每日罐數)}</span> 罐</span>
          <span class="amt num" style="font-weight:500">${esc(r.預計喝完日 ? String(r.預計喝完日).slice(5) + ' 喝完' : '—')}</span>${tag}</button>`;
      }).join('') : '<div class="empty">這個分類目前沒有提醒</div>'}</div>`;
    $main().querySelector('.pills').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { S.remindTab = b.dataset.tab; S.sel = null; viewReminders(); } };
    $main().querySelector('.list').onclick = e => { const b = e.target.closest('[data-r]'); if (b) { S.sel = b.dataset.r; viewReminders(); } };
    const r = S.sel && all.find(x => x.提醒ID === S.sel);
    if (!r) { $side().innerHTML = ''; return; }
    const history = S.data.orders.filter(o => o.客戶ID === r.客戶ID).sort((a, b) => String(b.訂單日期).localeCompare(String(a.訂單日期))).slice(0, 4);
    $side().innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start"><div style="display:flex;flex-direction:column;gap:4px"><span class="sub num">${esc(r.提醒ID)} · ${esc(r.訂單編號)}</span><span style="font-size:20px;font-weight:700">${esc(r.客戶)}</span>
        ${r.電話 && !/\*/.test(r.電話) ? `<a class="num" href="tel:${esc(String(r.電話).replace(/\D/g, ''))}">${esc(r.電話)}</a>` : `<span class="sub num">${esc(r.電話 || '')}</span>`}</div>
        <button class="close" data-act="close" aria-label="關閉">×</button></div>
      <div class="box"><div class="kv"><span>商品</span><b>${esc(r.商品)}</b></div>
        <div class="kv"><span>總罐數</span><span class="num">${esc(r.總罐數)}</span></div>
        <div class="kv"><span>起算日（出貨）</span><span class="num">${esc(r.起算日 || '尚未出貨')}</span></div>
        <div class="kv"><span>預計喝完</span><b class="num" style="color:var(--accent-ink)">${esc(r.預計喝完日 || '—')}</b></div>
        <label class="kv" style="align-items:center"><span>每天喝幾罐</span><span style="display:flex;gap:6px"><input class="num" id="perDay" inputmode="decimal" value="${esc(r.每日罐數)}" style="width:70px;min-height:40px;border:0;border-radius:12px;background:#fff;text-align:right;padding:0 10px"><button class="btn" style="min-height:40px;background:#fff" data-act="perDay">重算</button></span></label></div>
      <div style="display:flex;flex-direction:column;gap:8px"><span class="sec-title">最近訂單</span>
        ${history.map(o => `<div class="kv"><span class="num">${esc(o.訂單日期)}</span><span>${orderItems(o.訂單編號).map(i => esc(i.商品名稱) + '×' + esc(i.數量)).join('、')}</span></div>`).join('')}</div>
      <label class="field"><span>聯繫紀錄</span><textarea id="rnote" placeholder="例：11/14 LINE 詢問，客人說下週再訂">${esc(r.備註 || '')}</textarea></label>
      ${r.處理人 ? `<span class="sub">上次處理：${esc(r.處理人)} ${esc(r.處理時間 || '')}</span>` : ''}
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:auto">
        <div class="btns"><button class="btn" data-st="暫不需要">暫不需要</button><button class="btn" data-st="已聯繫">已聯繫，等回覆</button></div>
        <button class="btn dark" data-act="reorder">客人要回購 → 建單</button></div>`;
    $side().onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      const note = document.getElementById('rnote').value;
      if (b.dataset.act === 'close') { S.sel = null; viewReminders(); }
      if (b.dataset.st) run(b, async () => { await api('updateReminder', { reminder: { id: r.提醒ID, status: b.dataset.st, note } }); await load(); toast('已更新'); viewReminders(); render(); });
      if (b.dataset.act === 'perDay') run(b, async () => { await api('updateReminder', { reminder: { id: r.提醒ID, cansPerDay: document.getElementById('perDay').value, note } }); await load(); toast('已重新計算'); viewReminders(); });
      if (b.dataset.act === 'reorder') {
        const c = S.data.customers.find(x => x.客戶ID === r.客戶ID) || { 客戶ID: r.客戶ID, 姓名: r.客戶, 電話: r.電話 };
        const lastItems = orderItems(r.訂單編號).filter(i => !i.贈品);
        S.draft = newDraft(); S.draft.customer = { id: c.客戶ID, name: c.姓名, phone: c.電話, lineName: c.LINE名稱 || '' }; S.draft.cansPerDay = n(r.每日罐數) || 1;
        S.draft.note = '奶水回購（提醒 ' + r.提醒ID + '）';
        if (lastItems.length) S.draft.items = lastItems.map(i => { const it = blankItem(); Object.assign(it, { sku: i.商品貨號 || '', name: i.商品名稱, qty: n(i.數量), price: n(i.單價), unitCost: i.成本 !== '' && n(i.數量) ? n(i.成本) / n(i.數量) : '' }); const rule = milkRule(it.name); if (rule) { it.cans = it.qty * n(rule.每箱罐數); it.autoCans = true; } applyLastPrice(it); return it; });
        go('create');
      }
    };
  }

  // 報價表一列 = 一個可賣的組合：建單成本用整組進價（沒有才用單位成本），售價用門市售價（沒有才用定價）
  function pName(p) { return [String(p.品名 || '').includes(p.品牌 || '\u0000') ? '' : p.品牌, p.品名, p.組合].filter(Boolean).join(' '); }
  function pCost(p) { return p['進價（整組）'] !== '' && p['進價（整組）'] != null ? p['進價（整組）'] : p.單位成本; }
  // 網頁用去背小圖：img/products/<品項ID>.webp（原始去背檔在雲端硬碟「商品圖/去背」）
  // 商品圖不放在公開網站：登入後由後端從雲端硬碟「私下訂單系統/商品圖/網頁」讀出（<品項ID>.webp）
  function pImg(p) { return (S.imgs && S.imgs[p.品項ID]) || ''; }
  async function loadImgs() {
    if (S.imgs || S.imgsLoading) return; S.imgsLoading = true;
    try { S.imgs = await api('productImages'); } catch (e) { S.imgs = {}; }
    S.imgsLoading = false; if (S.view === 'prices' || location.hash === '#prices') viewPrices();
  }
  function pPrice(p) { return p.門市售價 !== '' && p.門市售價 != null ? p.門市售價 : p.定價; }
  /* ---------- 成本報價表 ---------- */
  function viewPrices() {
    const all = S.data.priceTable || [];
    if (all.some(p => p.圖片路徑)) loadImgs();
    if (!all.length) {
      $main().innerHTML = `<header class="head"><h1>成本報價表</h1></header><div class="card empty">報價表還沒建立。<br>任務 B 把「產品成本.xlsx」整理進資料庫的「報價表」分頁後，這裡就會顯示商品圖、成本與各級售價。</div>`;
      $side().innerHTML = ''; return;
    }
    // 依品牌分頁顯示，不一次列出全部；有輸入搜尋字時才跨品牌搜尋
    const brands = [...new Set(all.map(p => p.品牌).filter(Boolean))];
    if (!brands.includes(S.brand)) S.brand = brands[0];
    const cnt = b => all.filter(p => p.品牌 === b).length;
    const q = S.q.trim();
    const list = q ? all.filter(p => [p.品名, p.品牌, p.組合, p.對應蝦皮貨號].join(' ').includes(q)) : all.filter(p => p.品牌 === S.brand);
    $main().innerHTML = `
      <header class="head"><div style="display:flex;flex-direction:column;gap:4px"><h1>成本報價表</h1><span class="sub">${q ? `搜尋「${esc(q)}」· 找到 ${list.length} 個品項` : `${esc(S.brand)} · ${list.length} 個品項（共 ${brands.length} 個品牌）`}</span></div>
        <label class="search">${svg('search', 16)}<input type="search" id="pq" placeholder="搜尋品名、蝦皮貨號" value="${esc(S.q)}" aria-label="搜尋報價表"></label></header>
      <div class="pills" role="group" aria-label="品牌">${brands.map(b => `<button class="pill ${!q && S.brand === b ? 'on' : ''}" data-b="${esc(b)}" aria-pressed="${!q && S.brand === b}">${esc(b)} <span class="num" style="opacity:.6">${cnt(b)}</span></button>`).join('')}</div>
      <div class="pgrid">${list.map(p => `<button class="pcard ${S.sel === p.品項ID ? 'on' : ''}" data-p="${esc(p.品項ID)}">
        <div class="pimg">${pImg(p) ? `<img src="${pImg(p)}" alt="${esc(p.品名)}" loading="lazy">` : (p.圖片路徑 && !S.imgs ? '圖片載入中' : '尚無商品圖')}</div>
        <span style="display:flex;flex-direction:column;gap:2px"><span class="sub" style="font-size:12px">${esc(p.品牌)}${p.組合 ? ' · ' + esc(p.組合) : ''}</span><b style="font-size:15px">${esc(p.品名)}${p.狀態 === '待確認' ? ' <span class="tag t-pay" style="font-size:11px">待確認</span>' : ''}</b></span>
        <span class="kv" style="font-size:13px"><span>進價</span><b class="num">${money(pCost(p))}</b></span>
        <span class="kv" style="font-size:13px"><span>售價</span><b class="num">${money(pPrice(p))}</b></span></button>`).join('')}</div>`;
    $main().querySelector('.pills').onclick = e => { const b = e.target.closest('[data-b]'); if (b) { S.brand = b.dataset.b; S.q = ''; S.sel = null; viewPrices(); } };
    $main().querySelector('.pgrid').onclick = e => { const b = e.target.closest('[data-p]'); if (b) { S.sel = b.dataset.p; viewPrices(); } };
    const qi = document.getElementById('pq'); qi.oninput = () => { S.q = qi.value; const p = qi.selectionStart; viewPrices(); const x = document.getElementById('pq'); x.focus(); x.setSelectionRange(p, p); };
    const p = S.sel && all.find(x => x.品項ID === S.sel);
    if (!p) { $side().innerHTML = ''; return; }
    const f = k => `<div class="kv"><span>${k}</span><b class="num">${p[k] === '' || p[k] == null ? '—' : (k === '毛利率' && isFinite(n(p[k])) ? (n(p[k]) * 100).toFixed(1) + '%' : isFinite(n(p[k])) && /價|成本|運費|毛利$/.test(k) ? money(p[k]) : esc(p[k]))}</b></div>`;
    $side().innerHTML = `
      <div style="display:flex;gap:16px;align-items:center"><div class="pimg" style="width:96px;flex:none">${pImg(p) ? `<img src="${pImg(p)}" alt="">` : ''}</div>
        <div style="display:flex;flex-direction:column;gap:4px"><span class="sub">${esc(p.品牌)} · ${esc(p.分類 || '')}</span><span style="font-size:20px;font-weight:700">${esc(p.品名)}</span><span class="sub num">${esc(p.組合 || '')}${p.一箱罐數 ? ' · 一箱 ' + esc(p.一箱罐數) + ' 罐' : ''}</span></div></div>
      <div style="display:flex;flex-direction:column;gap:10px"><span class="sec-title">成本（內部，報價單不顯示）</span>${f('進價（整組）')}${f('單位成本')}</div>
      <div class="box"><span class="sec-title">售價</span>${f('門市售價')}${f('定價')}${f('導外價(tina/kuo)')}${f('導外價(星郡)')}${f('兩箱含運價')}${f('毛利率')}</div>
      <div style="display:flex;flex-direction:column;gap:8px">${f('對應蝦皮貨號')}${f('搭贈說明')}${p.備註 ? `<div class="sub">${esc(p.備註)}</div>` : ''}</div>
      <div class="btns"><button class="btn dark" data-act="use">用此價格建單</button></div>`;
    $side().onclick = e => {
      if (!e.target.closest('[data-act="use"]')) return;
      S.draft = S.draft || newDraft();
      const it = blankItem(); Object.assign(it, { name: pName(p), sku: p.對應蝦皮貨號 || '', price: n(pPrice(p)), unitCost: n(pCost(p)), priceSource: '報價表標準價', costSource: '成本：報價表' });
      const rule = milkRule(it.name); if (rule || /奶水/.test(p.分類 || '')) { it.cans = n(p.一箱罐數) || n(rule && rule.每箱罐數) || 24; it.autoCans = true; }
      if (S.draft.items.length === 1 && !S.draft.items[0].name) S.draft.items = [it]; else S.draft.items.push(it);
      go('create');
    };
  }

  /* ---------- 人員管理（管理者） ---------- */
  async function viewStaff() {
    $main().innerHTML = '<header class="head"><h1>人員管理</h1></header><div class="card empty">載入中…</div>'; $side().innerHTML = '';
    try { S.staffList = await api('listStaffAdmin'); } catch (e) { toast(e.message); return; }
    $main().innerHTML = `<header class="head"><div style="display:flex;flex-direction:column;gap:4px"><h1>人員管理</h1><span class="sub">登入頁只會顯示「啟用」的人員</span></div></header>
      <div class="list">${S.staffList.map(s => `<div class="row" style="grid-template-columns:1.4fr 1fr auto auto"><b>${esc(s.姓名)}</b><span class="sub">${esc(s.角色 || '一般')}</span>
        <button class="btn" style="min-height:40px" data-reset="${esc(s.姓名)}">重設密碼</button>
        <button class="btn" style="min-height:40px" data-active="${esc(s.姓名)}" data-v="${String(s.啟用) === 'false' || s.啟用 === false ? '1' : '0'}">${String(s.啟用) === 'false' || s.啟用 === false ? '啟用' : '停用'}</button></div>`).join('')}</div>`;
    $side().innerHTML = `<span style="font-size:20px;font-weight:700">新增人員</span>
      <form id="addStaff" style="display:flex;flex-direction:column;gap:12px">
        <label class="field"><span>姓名</span><input name="name" required></label>
        <label class="field"><span>角色</span><select name="role"><option>一般</option><option>管理者</option></select></label>
        <label class="field"><span>初始密碼（至少 6 碼）</span><input name="password" type="password" minlength="6" required autocomplete="new-password"></label>
        <button class="btn dark">新增</button></form>`;
    $main().querySelector('.list').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.reset) { const pw = prompt('輸入 ' + b.dataset.reset + ' 的新密碼（至少 6 碼）'); if (pw) run(b, async () => { await api('resetPassword', { name: b.dataset.reset, password: pw }); toast('已重設'); viewStaff(); }); }
      if (b.dataset.active) run(b, async () => { await api('setStaffActive', { name: b.dataset.active, active: b.dataset.v === '1' }); toast('已更新'); viewStaff(); });
    };
    const f = document.getElementById('addStaff');
    f.onsubmit = e => { e.preventDefault(); const fd = new FormData(f); run(f.querySelector('button'), async () => { await api('addStaff', { name: fd.get('name'), role: fd.get('role'), password: fd.get('password') }); toast('已新增'); viewStaff(); }); };
  }

  function viewAccount() {
    $main().innerHTML = `<header class="head"><div style="display:flex;flex-direction:column;gap:4px"><h1>我的帳號</h1><span class="sub">${esc(S.user.name)} · ${esc(S.user.role)}</span></div></header>
      <form class="card" id="pwForm" style="display:flex;flex-direction:column;gap:12px;max-width:420px">
        <span class="sec-title">變更密碼</span>
        <label class="field"><span>目前密碼</span><input name="old" type="password" required autocomplete="current-password"></label>
        <label class="field"><span>新密碼（至少 6 碼）</span><input name="new1" type="password" minlength="6" required autocomplete="new-password"></label>
        <label class="field"><span>再輸入一次新密碼</span><input name="new2" type="password" minlength="6" required autocomplete="new-password"></label>
        <button class="btn dark">更新密碼</button></form>`;
    $side().innerHTML = '';
    const f = document.getElementById('pwForm');
    f.onsubmit = e => { e.preventDefault(); const fd = new FormData(f); if (fd.get('new1') !== fd.get('new2')) { toast('兩次輸入的新密碼不同'); return; } run(f.querySelector('button'), async () => { await api('changePassword', { oldPassword: fd.get('old'), newPassword: fd.get('new1') }); toast('密碼已更新'); f.reset(); f.querySelector('button').disabled = false; f.querySelector('button').textContent = '更新密碼'; }); };
  }

  /* ---------- 啟動 ---------- */
  window.addEventListener('hashchange', () => { const r = location.hash.slice(1); if (r && r !== S.route && S.user) { S.route = r; S.sel = null; render(); } });
  const h = location.hash.slice(1); if (h) S.route = h;
  if (S.user) render(); else renderLogin();
})();
