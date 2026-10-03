'use strict';
/* 多网关控制台 · 纯静态 UI v0.2.0
 * 布局参考 ZcodeKnight（深色/卡片/胶囊导航/状态色条），
 * 交互参考 sub2api（工具条搜索筛选/批量操作/危险操作确认）。
 */
const $ = id => document.getElementById(id);
const state = {
  base: '', token: '', view: 'monitor', gateway: null,
  gateways: [], caps: {}, settings: {}, kill: true,
  epoch: 0, busy: false, backendVersion: '', updateState: 'unknown',
  accounts: [], search: '', filter: ''
};
const names = { 'a-cn': 'A-1 腾讯国内', 'a-intl': 'A-2 腾讯国际', b: 'B TRAE CN', c: 'C Zcode' };
const GWS = ['a-cn', 'a-intl', 'b', 'c'];

/* ---------- 工具 ---------- */
const safe = value => {
  const blocked = /^(token|password|authorization|secret|access_token|refresh_token|proxy_url|endpoint)$/i;
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, blocked.test(k) ? '[redacted]' : safe(v)]));
  return value;
};
const json = value => JSON.stringify(safe(value), null, 2);
function notice(id, text, type = 'bad') { const el = $(id); if (!el) return; el.textContent = text || ''; el.hidden = !text; if (type) el.className = 'notice ' + type; }
function toast(text, type = '') {
  const el = $('toast'); el.textContent = text || ''; el.hidden = !text;
  el.className = 'toast ' + type;
  if (text) { clearTimeout(toast._t); toast._t = setTimeout(() => { el.hidden = true; }, 3200); }
}
function cell(value) { const td = document.createElement('td'); td.textContent = value ?? '—'; return td; }
function date(value) { return value ? new Date(typeof value === 'number' ? value * 1000 : value).toLocaleString() : '—'; }
function button(label, action, className = 'ghost') { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = className; b.addEventListener('click', action); return b; }
function kpi(label, value, cls = '') {
  const d = document.createElement('div'); d.className = 'kpi';
  const p = document.createElement('p'); p.textContent = label;
  const s = document.createElement('strong'); if (cls) s.className = cls; s.textContent = value;
  d.append(p, s); return d;
}
function baseUrl(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || !['', '/'].includes(u.pathname)) throw Error('地址须为无路径和凭据的 HTTP(S) BaseURL');
  return u.origin;
}
function isLocalBase(base) {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname); }
  catch { return false; }
}
async function api(path, method = 'GET', data) {
  if (!state.base || !state.token) throw Error('请先连接');
  const response = await fetch(state.base + path, {
    method, headers: { Authorization: 'Bearer ' + state.token, ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(20000), cache: 'no-store', credentials: 'omit'
  });
  let result; try { result = await response.json(); } catch { throw Error('后端返回非 JSON，HTTP ' + response.status); }
  if (!response.ok) { const e = result.error || {}; throw Error('HTTP ' + response.status + ' · ' + (e.code || 'request_failed') + ' · ' + (e.message || '') + '\n' + json(e.missing_evidence || [])); }
  return result;
}
const gwPath = () => '/api/v1/gateways/' + encodeURIComponent(state.gateway);
async function wrap(id, action) { notice(id, ''); try { await action(); } catch (e) { notice(id, e.message); } }
function enabled(yes) { document.querySelectorAll('.backend-write').forEach(b => b.disabled = !yes); }

/* ---------- 视图与页签切换 ---------- */
function showView(name) {
  state.view = name;
  document.querySelectorAll('#nav .pill').forEach(p => p.classList.toggle('on', p.dataset.view === name));
  $('view-monitor').hidden = name !== 'monitor';
  $('view-gateway').hidden = !(name in names);
  $('view-settings').hidden = name !== 'settings';
  if (name in names && state.gateway !== name) select(name).catch(e => toast(e.message || '加载失败', 'bad'));
}
$('nav').addEventListener('click', e => {
  const b = e.target.closest('.pill'); if (b) showView(b.dataset.view);
});
document.querySelectorAll('#gw-tabs .pill').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#gw-tabs .pill').forEach(t => t.classList.toggle('on', t === b));
  ['accounts', 'models', 'tasks', 'settings', 'caps'].forEach(tab => { $('pane-' + tab).hidden = tab !== b.dataset.tab; });
  if (b.dataset.tab === 'settings') $('settings-fields').disabled = !state.base;
}));
function setTab(tab) { const b = document.querySelector('#gw-tabs .pill[data-tab="' + tab + '"]'); if (b) b.click(); }

/* ---------- 登录（管理密码） ---------- */
function setConnected(ok, text) { const el = $('connection-status'); el.textContent = text; el.className = 'badge ' + (ok ? 'ok' : 'off'); }
function setDefaultBadge(isDefault) {
  const el = $('admin-pass-badge'); if (!el) return;
  el.hidden = !isDefault;
  if (isDefault) { el.textContent = '默认密码 admin，请修改'; el.className = 'badge warn'; }
}
async function login(password) {
  let r;
  try { r = await api('/api/v1/auth/login', 'POST', { password }); }
  catch (e) {
    const m = e.message || '';
    if (m.includes('Wrong password')) throw Error('密码错误');
    if (m.includes('too_many_attempts')) throw Error('失败次数过多，请 1 分钟后再试');
    throw e;
  }
  setDefaultBadge(!!r.default_password);
  if (r.default_password) toast('你还在用默认密码 admin，请到「全局设置与更新」修改', 'bad');
  return r;
}
$('connection-form').addEventListener('submit', e => {
  e.preventDefault();
  wrap('connection-error', async () => {
    const raw = $('base-url').value.trim();
    state.base = raw ? baseUrl(raw) : location.origin;
    state.token = $('api-token').value.trim();
    if (!state.token) throw Error('请填写管理密码');
    await login(state.token);
    await refreshAll();
    enabled(true);
    setConnected(true, '已登录');
    toast('登录成功', 'ok');
    if (/^http:\/\//.test(state.base) && !isLocalBase(state.base))
      toast('注意：HTTP 未加密，管理密码会明文传输', 'bad');
    if ($('remember-config').checked) localStorage.setItem('mgp.connection', JSON.stringify({ base: state.base, token: state.token }));
    else localStorage.removeItem('mgp.connection');
  });
});
$('clear-storage').addEventListener('click', () => {
  localStorage.removeItem('mgp.connection');
  state.token = ''; $('api-token').value = '';
  enabled(false); setConnected(false, '未登录');
  toast('已移除本地保存的密码');
});

/* ---------- 修改管理密码 ---------- */
$('admin-pass-form').addEventListener('submit', e => {
  e.preventDefault();
  wrap('pass-error', async () => {
    const oldp = $('pass-old').value, p1 = $('pass-new').value, p2 = $('pass-new2').value;
    if (p1 !== p2) throw Error('两次输入的新密码不一致');
    if (p1.length < 6) throw Error('新密码至少 6 位');
    if (p1 === oldp) throw Error('新密码不能和当前密码相同');
    let r;
    try { r = await api('/api/v1/auth/password', 'POST', { old_password: oldp, new_password: p1 }); }
    catch (err) {
      const m = err.message || '';
      if (m.includes('wrong_old_password')) throw Error('当前密码不正确');
      if (m.includes('weak_password')) throw Error('新密码须 6-128 位');
      throw err;
    }
    state.token = p1;
    $('pass-old').value = ''; $('pass-new').value = ''; $('pass-new2').value = '';
    setDefaultBadge(!!r.default_password);
    if ($('remember-config').checked) localStorage.setItem('mgp.connection', JSON.stringify({ base: state.base, token: p1 }));
    notice('pass-status', '密码已修改并立即生效；其他设备需用新密码重新登录。', 'neutral');
    toast('管理密码已修改', 'ok');
  });
});

/* ---------- 全局监控 ---------- */
function gwCardClass(g) {
  if (g.status !== 'ok') return 'bad';
  if ((g.cooldowns || 0) > 0 || (g.queued || 0) >= (g.queue_limit || 0)) return 'warn';
  return 'ok';
}
function drawMonitorCard(g) {
  const d = document.createElement('div'); d.className = 'gwcard ' + gwCardClass(g);
  const head = document.createElement('div'); head.className = 'head';
  const h = document.createElement('h3'); h.textContent = names[g.id] || g.name;
  const badge = document.createElement('span'); badge.className = 'badge ' + (g.status === 'ok' ? 'ok' : 'bad'); badge.textContent = g.status;
  head.append(h, badge); d.append(head);
  const mono = document.createElement('p'); mono.className = 'mono'; mono.textContent = '出口 /' + (g.path || g.id); d.append(mono);
  const grid = document.createElement('div'); grid.className = 'grid kpis';
  grid.append(kpi('在途/并发', g.active + ' / ' + g.concurrency), kpi('排队/上限', g.queued + ' / ' + g.queue_limit), kpi('账号', g.accounts));
  d.append(grid);
  if (g.last_error) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = String(g.last_error).slice(0, 120); d.append(p); }
  d.style.cursor = 'pointer';
  d.addEventListener('click', () => showView(g.id));
  return d;
}
function drawGateways(data) {
  state.gateways = data.gateways || [];
  $('monitor-grid').replaceChildren(...state.gateways.map(drawMonitorCard));
}
function drawKill(data) {
  state.kill = data.enabled !== false;
  const b = $('kill-badge');
  b.textContent = state.kill ? '杀开关：阻断' : '杀开关：关闭';
  b.className = 'badge ' + (state.kill ? 'bad' : 'ok');
}
$('kill-on').addEventListener('click', () => wrap('gateway-error', async () => { drawKill(await api('/api/v1/tasks/kill-switch', 'POST', { enabled: true })); guard(); toast('杀开关已打开，真实任务被阻断', 'ok'); }));
$('kill-off').addEventListener('click', () => wrap('gateway-error', async () => {
  if (!confirm('关闭全局任务杀开关？缺证据能力仍不能执行。')) return;
  drawKill(await api('/api/v1/tasks/kill-switch', 'POST', { enabled: false })); guard(); toast('杀开关已关闭');
}));
$('batch-checkin').addEventListener('click', () => wrap('batch-status', async () => {
  if (!confirm('对全部网关执行批量签到？各网关按自己的策略间隔错峰执行，仍受证据与限额约束。')) return;
  const r = await api('/api/v1/tasks/batch-run', 'POST', { task_type: 'checkin' });
  const label = { 'A-1 腾讯国内': 'A-1', 'A-2 腾讯国际': 'A-2', 'B TRAE CN': 'B', 'C Zcode': 'C' };
  const parts = Object.entries(r.results || {}).map(([g, x]) => {
    const tag = label[g] || g;
    if (x.status === 'blocked') return tag + '：被门禁阻断';
    if (x.status === 'evidence_required') return tag + '：证据不足';
    if (x.status === 'failed') return tag + '：失败';
    const ok = (x.results || []).filter(y => y.ok).length, total = (x.results || []).length;
    return tag + '：' + ok + '/' + total + ' 成功';
  });
  notice('batch-status', '批量签到完成（执行 ' + r.executed_gateways + ' 个网关）：' + parts.join('；'), 'neutral');
  await refreshCurrent();
}));

/* ---------- 网关视图 ---------- */
async function select(id) {
  state.gateway = id; const epoch = ++state.epoch;
  state.caps = {}; state.settings = {}; state.accounts = []; state.search = ''; state.filter = '';
  $('account-search').value = ''; $('account-filter').value = '';
  $('gw-title').textContent = names[id];
  $('gw-sub').textContent = '出口：服务器 /' + ({ 'a-cn': 'v1', 'a-intl': 'v2', b: 'v3', c: 'v4' }[id] || '?') + ' → 本网关独立账号池';
  $('gw-kpis').replaceChildren();
  ['accounts-grid', 'usage-recent-body', 'tasks-body', 'models-chips', 'credits-bars', 'usage-kpis', 'egress-body', 'capabilities-list'].forEach(k => $(k).replaceChildren());
  $('settings-fields').disabled = true;
  $('task-result-json').textContent = '';
  notice('login-status', ''); stopLoginPoll(); $('login-link').hidden = true;
  updateCreditsVisibility();
  updateLoginVisibility();
  guard();
  setTab('accounts');
  await refreshSelected(epoch);
}
function updateCreditsVisibility() {
  $('credits-note').textContent = {
    'a-cn': '查询走腾讯计费域 www.codebuddy.cn（5 分钟缓存）。',
    'a-intl': '查询走国际计费域 www.workbuddy.ai（5 分钟缓存）。',
    'b': '查询走 api.trae.cn：签到状态 + 套餐总限额/已用/剩余。',
    'c': '需要 start-plan JWT（导入时 metadata 含 jwt 字段）；纯 apiKey 凭据无余额接口。'
  }[state.gateway] || '';
}
function updateLoginVisibility() {
  const isA = state.gateway === 'a-cn' || state.gateway === 'a-intl';
  $('account-login').hidden = !isA;
  if (!isA) { stopLoginPoll(); $('login-link').hidden = true; notice('login-status', ''); }
}

/* 登录链接（仅 A 两网关） */
let loginTimer = null;
function stopLoginPoll() { if (loginTimer) { clearTimeout(loginTimer); loginTimer = null; } }
async function pollLogin(gid, st) {
  if (state.gateway !== gid) return;
  try {
    const r = await api(gwPath() + '/accounts/login-status?state=' + encodeURIComponent(st));
    if (r.status === 'ok') { notice('login-status', '登录成功，账号已入库。', 'neutral'); stopLoginPoll(); await refreshSelected(); return; }
    if (r.status === 'expired') { notice('login-status', '链接已过期，请重新生成。', 'warn'); stopLoginPoll(); return; }
    if (r.status === 'error') { notice('login-status', '登录失败：' + (r.message || '未知错误'), 'bad'); stopLoginPoll(); return; }
    notice('login-status', '等待浏览器登录…（链接 10 分钟内有效）', 'neutral');
  } catch (e) { notice('login-status', '查询失败：' + e.message, 'bad'); stopLoginPoll(); return; }
  loginTimer = setTimeout(() => pollLogin(gid, st), 3000);
}
$('account-login').addEventListener('click', () => wrap('login-status', async () => {
  stopLoginPoll();
  const r = await api(gwPath() + '/accounts/login-link', 'POST', {});
  const link = $('login-link'); link.href = r.auth_url; link.hidden = false;
  notice('login-status', '链接已生成：点击「打开登录页」完成登录，本页会自动检测。', 'neutral');
  loginTimer = setTimeout(() => pollLogin(state.gateway, r.state), 3000);
}));

/* 账号池：卡片网格 + 搜索筛选 */
function accClass(a) {
  if (!a.enabled) return 'disabled';
  if (a.cooldown_until && new Date(typeof a.cooldown_until === 'number' ? a.cooldown_until * 1000 : a.cooldown_until) > new Date()) return 'cooldown';
  if (a.status === 'ok' || a.status === 'idle' || a.status === 'active') return 'ok';
  if (a.status === 'disabled') return 'disabled';
  return a.status ? 'bad' : 'ok';
}
const accClassLabel = { ok: '可用', cooldown: '冷却中', disabled: '已停用', bad: '异常' };
function drawAccounts(data) {
  state.accounts = data.accounts || [];
  $('accounts-status').textContent = state.accounts.length + ' 个';
  renderAccountGrid();
}
function renderAccountGrid() {
  const grid = $('accounts-grid'); grid.replaceChildren();
  const choice = $('task-account'); choice.replaceChildren();
  const all = document.createElement('option'); all.value = ''; all.textContent = '全部账号'; choice.append(all);
  state.accounts.forEach(a => { const o = document.createElement('option'); o.value = a.id; o.textContent = a.id; choice.append(o); });
  const kw = state.search.trim().toLowerCase();
  const list = state.accounts.filter(a => {
    if (state.filter && accClass(a) !== state.filter) return false;
    if (kw && !(String(a.id) + ' ' + String(a.provider_account_id || '')).toLowerCase().includes(kw)) return false;
    return true;
  });
  if (!list.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = state.accounts.length ? '没有匹配的账号。' : '暂无账号：导入 JSON 或使用登录获取。'; grid.append(p); }
  list.forEach(a => {
    const cls = accClass(a);
    const card = document.createElement('div'); card.className = 'acc ' + cls;
    const top = document.createElement('div'); top.className = 'top';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = a.id;
    const badge = document.createElement('span'); badge.className = 'badge ' + ({ ok: 'ok', cooldown: 'warn', disabled: 'off', bad: 'bad' }[cls]); badge.textContent = accClassLabel[cls];
    top.append(name, badge); card.append(top);
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = (a.source || '—') + ' · 在途 ' + (a.in_flight ?? 0) + (a.cooldown_until ? ' · 冷却至 ' + date(a.cooldown_until) : '');
    card.append(meta);
    if (cls === 'bad' && a.last_error) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = String(a.last_error).slice(0, 140); card.append(p); }
    const btns = document.createElement('div'); btns.className = 'btns';
    btns.append(button(a.enabled ? '停用' : '启用', () => wrap('accounts-error', async () => {
      await api(gwPath() + '/accounts/' + encodeURIComponent(a.id), 'PATCH', { enabled: !a.enabled });
      toast(a.enabled ? '已停用 ' + a.id : '已启用 ' + a.id, 'ok');
      await refreshSelected();
    })));
    card.append(btns);
    grid.append(card);
  });
}
$('account-search').addEventListener('input', e => { state.search = e.target.value; renderAccountGrid(); });
$('account-filter').addEventListener('change', e => { state.filter = e.target.value; renderAccountGrid(); });

/* 导入 JSON */
$('import-toggle').addEventListener('click', () => { $('import-zone').hidden = !$('import-zone').hidden; });
$('import-accounts').addEventListener('click', () => wrap('accounts-error', async () => {
  const text = $('import-text').value.trim();
  let items = [];
  if (text) {
    try { const parsed = JSON.parse(text); items = Array.isArray(parsed) ? parsed : [parsed]; }
    catch { throw Error('粘贴的内容不是合法 JSON'); }
  }
  for (const f of $('import-file').files) {
    const content = await f.text();
    try { const parsed = JSON.parse(content); items = items.concat(Array.isArray(parsed) ? parsed : [parsed]); }
    catch { throw Error('文件 ' + f.name + ' 不是合法 JSON'); }
  }
  if (!items.length) throw Error('请选择文件或粘贴 JSON');
  if (items.length > 100) throw Error('单次最多导入 100 个账号');
  const r = await api(gwPath() + '/accounts/import', 'POST', { items });
  const detail = (r.errors || []).map(x => '#' + x.index + ':' + x.reason).join('；');
  notice('accounts-error', r.imported ? ('导入成功 ' + r.imported + ' 个' + (r.skipped ? ('，跳过 ' + r.skipped + ' 个（' + (detail || '重复') + '）') : '') + '。') : '全部跳过：' + (detail || '没有可识别的凭据'), r.imported ? 'neutral' : 'warn');
  $('import-text').value = ''; $('import-file').value = '';
  await refreshSelected();
}));

/* 模型与用量 */
function bar(label, remaining, total, extra) {
  const wrapEl = document.createElement('div'); wrapEl.className = 'bal';
  const l = document.createElement('span'); l.className = 'label'; l.textContent = label;
  const n = document.createElement('span'); n.className = 'num'; n.textContent = extra || (remaining + ' / ' + total);
  const track = document.createElement('div'); track.className = 'bar';
  const fill = document.createElement('i');
  const pct = (Number(remaining) > 0 && Number(total) > 0) ? Math.max(0, Math.min(100, remaining / total * 100)) : null;
  if (pct !== null) { fill.style.width = pct.toFixed(1) + '%'; if (pct < 20) fill.className = 'low'; else if (pct < 50) fill.className = 'mid'; }
  track.append(fill);
  wrapEl.append(l, n, track);
  wrapEl.style.gridTemplateColumns = 'auto 1fr';
  wrapEl.style.alignItems = 'center';
  return wrapEl;
}
$('query-credits').addEventListener('click', () => wrap('credits-result', async () => {
  const r = await api(gwPath() + '/credits');
  if (r.error) throw Error('HTTP · ' + r.error.code + ' · ' + r.error.message);
  if (!r.available) { notice('credits-result', r.note || '上游未返回套餐数据。', 'warn'); return; }
  const c = r.credits; const bars = $('credits-bars'); bars.replaceChildren();
  let text = '';
  if (c.remaining !== undefined && c.packages && c.packages[0] && c.packages[0].unit_type) {
    text = '剩余 ' + c.remaining + ' / 已用 ' + c.used + ' / 总量 ' + c.total + '（' + c.packages.length + ' 个套餐包）';
    bars.append(bar(r.account_id, c.remaining, c.total, text));
  } else if (c.remaining !== undefined) {
    text = '剩余 ' + c.remaining + ' / 已用 ' + c.used + ' / 总量 ' + c.total_limit;
    bars.append(bar(r.account_id, c.remaining, c.total_limit, text + (c.checked_in !== undefined ? '；今日' + (c.checked_in ? '已签到' : '未签到') : '')));
  } else if (Array.isArray(c.balances) && c.balances.length) {
    c.balances.forEach((b, i) => {
      const rem = b.remaining_units ?? b.remaining, tot = b.total_units ?? b.total ?? b.size;
      bars.append(bar((b.plan || b.name || '套餐') + (c.balances.length > 1 ? ' #' + (i + 1) : ''), rem, tot, rem + (tot ? ' / ' + tot : '')));
    });
    text = c.balances.length + ' 个套餐包';
  } else {
    text = '剩余 ' + c.remain + ' / 已用 ' + c.used + ' / 总量 ' + c.size + '（' + c.packages + ' 个套餐）';
    bars.append(bar(r.account_id, c.remain, c.size, text));
  }
  notice('credits-result', '查询成功（账号 ' + r.account_id + '，缓存 5 分钟）。', 'neutral');
}));
function drawUsage(data) {
  const kp = $('usage-kpis'); kp.replaceChildren();
  kp.append(
    kpi('24h 请求', data.total),
    kpi('成功', data.ok, data.ok >= data.failed ? 'ok' : ''),
    kpi('失败', data.failed, data.failed ? 'bad' : ''),
    kpi('流式', data.streamed),
    kpi('平均耗时 ms', data.avg_ms),
    kpi('成功率', data.success_rate == null ? '—' : (data.success_rate * 100).toFixed(1) + '%')
  );
  const cooling = (data.model_cooldowns || []).map(([m, s]) => m + '(' + s + 's)').join('、');
  notice('usage-error', cooling ? '模型冷却中：' + cooling : '', cooling ? 'warn' : 'bad');
  const chips = $('models-chips'); chips.replaceChildren();
  const models = data.models || [];
  if (!models.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = '（未配置模型清单：后端 *_MODELS 环境变量）'; chips.append(p); }
  else chips.replaceChildren(...models.map(m => { const s = document.createElement('span'); s.className = 'chip'; s.textContent = m; return s; }));
  const body = $('usage-recent-body'); body.replaceChildren();
  (data.recent || []).forEach(r => {
    const tr = document.createElement('tr');
    tr.append(cell(date(r.created_at)), cell(r.account_id || '—'),
      cell(r.status_code), cell(Math.round(r.duration_ms || 0)),
      cell(r.streamed ? '是' : '否'), cell(r.error_class || ''));
    body.append(tr);
  });
  if (!(data.recent || []).length) { const tr = document.createElement('tr'); const td = cell('暂无请求记录'); td.colSpan = 6; tr.append(td); body.append(tr); }
}
$('refresh-usage').addEventListener('click', () => wrap('usage-error', async () => { drawUsage(await api(gwPath() + '/usage')); toast('用量已刷新', 'ok'); }));

/* 任务 */
function guard() {
  const c = state.caps[$('task-type').value] || {};
  const allowed = !state.kill && state.settings.tasks_enabled && c.status === 'supported' && Array.isArray(c.evidence) && c.evidence.length;
  const dry = $('task-dry-run').checked;
  $('run-task').disabled = !state.gateway || (!dry && !allowed);
  $('run-task').textContent = dry ? '运行 dry-run 预检' : '请求真实执行';
}
['task-type', 'task-dry-run'].forEach(id => $(id).addEventListener('change', guard));
async function runGatewayTask(kind) {
  const r = await api(gwPath() + '/tasks/' + kind + '/run', 'POST', { dry_run: false, account_id: null });
  const items = (r.results || []).map(x => x.account_id + ':' + (x.status || x.reason || '?') + (x.business_code !== undefined ? ('(code=' + x.business_code + ')') : ''));
  return (r.status ? '状态=' + r.status + '；' : '') + (items.join('；') || '无账号或未执行');
}
$('gw-checkin').addEventListener('click', () => wrap('gw-task-status', async () => {
  if (!confirm('对本网关全部账号执行签到？按本上游策略间隔错峰。')) return;
  notice('gw-task-status', await runGatewayTask('checkin'), 'neutral');
  await refreshSelected();
}));
$('gw-claim').addEventListener('click', () => wrap('gw-task-status', async () => {
  if (!confirm('请求领取奖励？缺少协议证据的网关会明确返回 501，不会伪造成功。')) return;
  notice('gw-task-status', await runGatewayTask('claim'), 'neutral');
  await refreshSelected();
}));
$('task-form').addEventListener('submit', e => {
  e.preventDefault();
  wrap('gw-task-status', async () => {
    const dry = $('task-dry-run').checked;
    const kind = $('task-type').value;
    if (!dry) {
      drawKill(await api('/api/v1/tasks/kill-switch'));
      drawSettings(await api(gwPath() + '/settings'));
      drawCaps(await api(gwPath() + '/capabilities'));
      guard();
      if ($('run-task').disabled || !confirm('仅限本人或获授权账号，确认真实执行？')) return;
    }
    const result = await api(gwPath() + '/tasks/' + kind + '/run', 'POST', { dry_run: dry, account_id: $('task-account').value || null });
    $('task-result-json').textContent = json(result);
    notice('gw-task-status', result.dry_run ? (result.allowed ? '预检允许；尚未执行' : '预检未允许；没有执行') : '后端真实结果，需核对服务端状态', 'neutral');
    drawRuns(await api(gwPath() + '/tasks'));
  });
});
function drawRuns(data) {
  const body = $('tasks-body'); body.replaceChildren();
  (data.runs || []).forEach(r => {
    const tr = document.createElement('tr');
    tr.append(cell(r.id + ' / ' + r.gateway_id), cell(r.task_type + ' / ' + r.status), cell(date(r.started_at)), cell(date(r.finished_at)),
      cell(typeof r.result_json === 'string' ? r.result_json : json(r.result_json)));
    body.append(tr);
  });
  if (!(data.runs || []).length) { const tr = document.createElement('tr'); const td = cell('暂无运行记录（含 dry-run，不等于成功领取）'); td.colSpan = 5; tr.append(td); body.append(tr); }
}

/* 网关设置 */
function drawSettings(data) {
  state.settings = data;
  const mapping = { concurrency: 'setting-concurrency', queue_limit: 'setting-queue-limit', queue_timeout: 'setting-queue-timeout', task_daily_limit: 'setting-task-daily-limit', task_window_start: 'setting-task-window-start', task_window_end: 'setting-task-window-end' };
  Object.entries(mapping).forEach(([k, id]) => $(id).value = data[k] ?? '');
  $('setting-tasks-enabled').checked = !!data.tasks_enabled;
  $('settings-fields').disabled = false;
  guard();
}
$('settings-form').addEventListener('submit', e => {
  e.preventDefault();
  wrap('settings-error', async () => {
    const values = {
      concurrency: Number($('setting-concurrency').value), queue_limit: Number($('setting-queue-limit').value),
      queue_timeout: Number($('setting-queue-timeout').value), task_daily_limit: Number($('setting-task-daily-limit').value),
      task_window_start: $('setting-task-window-start').value.slice(0, 5), task_window_end: $('setting-task-window-end').value.slice(0, 5),
      tasks_enabled: $('setting-tasks-enabled').checked
    };
    if (values.tasks_enabled && !state.settings.tasks_enabled && !confirm('开启本网关任务配置？仅有证据且显式运行的任务可以执行。')) return;
    drawSettings(await api(gwPath() + '/settings', 'PATCH', values));
    toast('设置已保存', 'ok');
  });
});
function drawEgress(data) {
  const box = $('egress-body'); box.replaceChildren();
  (data.egress || []).forEach(e => {
    const s = document.createElement('span');
    s.className = 'chip';
    s.textContent = (e.id || '') + ' · ' + (e.configured ? '已配置' : '未配置') + ' · ' + (e.healthy ? '健康' : '不可用');
    if (!e.healthy) s.style.color = 'var(--red)';
    box.append(s);
  });
  if (!(data.egress || []).length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = '固定本网关主出口和可选备用，不能挪用其他网关出口。'; box.append(p); }
}
function drawCaps(data) {
  state.caps = data.capabilities || {};
  const box = $('capabilities-list'); box.replaceChildren();
  Object.entries(state.caps).forEach(([name, c]) => {
    const d = document.createElement('div'); d.className = 'cap';
    const h = document.createElement('h3');
    const badge = document.createElement('span'); badge.className = 'badge ' + (c.status === 'supported' ? 'ok' : 'off'); badge.textContent = c.status;
    h.textContent = name + ' · '; h.append(badge);
    const pre = document.createElement('pre'); pre.textContent = json(c);
    d.append(h, pre); box.append(d);
  });
  guard();
}

/* ---------- 刷新 ---------- */
async function refreshSelected(epoch = state.epoch) {
  if (!state.gateway) return;
  const base = gwPath();
  await Promise.all([['accounts', drawAccounts], ['egress', drawEgress], ['settings', drawSettings], ['capabilities', drawCaps], ['tasks', drawRuns], ['usage', drawUsage]].map(async ([r, draw]) => {
    notice(r + '-error', '');
    try { const data = await api(base + '/' + r); if (epoch === state.epoch) draw(data); }
    catch (e) { if (epoch === state.epoch) notice(r + '-error', e.message); }
  }));
}
async function refreshCurrent() {
  if (state.view === 'monitor') {
    drawGateways(await api('/api/v1/gateways'));
    drawKill(await api('/api/v1/tasks/kill-switch'));
  } else if (state.view in names) {
    await refreshSelected();
    const g = state.gateways.find(x => x.id === state.gateway);
    if (g) drawGwKpis(g);
  } else if (state.view === 'settings') {
    drawBackendUpdate(await api('/api/v1/version'));
  }
}
function drawGwKpis(g) {
  const kp = $('gw-kpis'); kp.replaceChildren();
  kp.append(
    kpi('状态', g.status, g.status === 'ok' ? 'ok' : 'bad'),
    kpi('在途 / 并发', g.active + ' / ' + g.concurrency),
    kpi('排队 / 上限', g.queued + ' / ' + g.queue_limit),
    kpi('账号', g.accounts)
  );
}
async function refreshAll() {
  const data = await api('/api/v1/gateways');
  drawGateways(data);
  drawKill(await api('/api/v1/tasks/kill-switch'));
  drawBackendUpdate(await api('/api/v1/version'));
  if (!state.gateway && state.gateways.length) await select(state.gateways[0].id);
  else {
    const g = state.gateways.find(x => x.id === state.gateway);
    if (g) drawGwKpis(g);
    if (state.view in names) await refreshSelected();
  }
}

/* 5s 可见轮询（仅当前视图，防重入） */
setInterval(async () => {
  if (document.visibilityState !== 'visible' || !state.base || !state.token || state.busy) return;
  state.busy = true;
  try { await refreshCurrent(); } catch { /* 轮询失败静默，连接条不打断 */ }
  finally { state.busy = false; }
}, 5000);

/* ---------- 后端版本与两步更新 ---------- */
const UPDATE_STATES = ['disabled', 'idle', 'up_to_date', 'available', 'pending', 'draining', 'applying', 'applied', 'rolled_back', 'failed'];
const UPDATE_LABELS = { disabled: '未启用', idle: '未配置', up_to_date: '已是最新', available: '有新版本', pending: '更新中', draining: '排空中', applying: '应用中', applied: '已更新', rolled_back: '已回滚', failed: '检查失败' };
const UPDATE_CLS = { available: 'warn', pending: 'warn', draining: 'warn', applying: 'warn', applied: 'ok', up_to_date: 'ok', rolled_back: 'bad', failed: 'bad' };
const UPDATE_NOTES = {
  pending: '更新已确认：正在排空在途请求并切换代码，期间服务可能短暂中断，请勿关闭页面。',
  draining: '正在排空在途请求…', applying: '正在切换到候选版本…',
  applied: '更新完成，数据已刷新。',
  rolled_back: '候选版本验证失败，已自动回滚到之前的版本。',
  disabled: '后端未启用更新（UPDATES_ENABLED=false）。',
  idle: '更新已启用但后端未配置仓库。',
  up_to_date: '当前已是最新版本。'
};
let updatePoll = null;
function scheduleUpdatePoll() { if (updatePoll) clearTimeout(updatePoll); updatePoll = setTimeout(runUpdatePoll, 2500); }
async function runUpdatePoll() {
  updatePoll = null; let info;
  try { info = await api('/api/v1/version'); } catch (e) { notice('update-error', e.message); return; }
  drawBackendUpdate(info);
  if (['pending', 'draining', 'applying'].includes(state.updateState)) scheduleUpdatePoll();
  else if (['applied', 'rolled_back'].includes(state.updateState)) { try { await refreshAll(); } catch (e) { notice('update-error', e.message); } }
}
function drawBackendUpdate(info) {
  const u = info.updates || {};
  const st = UPDATE_STATES.includes(u.state) ? u.state : 'unknown';
  state.backendVersion = info.version; state.updateState = st;
  const short = v => typeof v === 'string' && v.length >= 7 ? v.slice(0, 7) : '';
  const cur = short(u.commit || u.previous);
  $('backend-version-big').textContent = 'v' + info.version + (cur ? ' · ' + cur : '');
  const cand = short(u.candidate);
  $('backend-latest').textContent = cand ? ('最新版本：' + cand + (u.candidate_subject ? ' · ' + u.candidate_subject : '')) : (st === 'up_to_date' ? '最新版本：与远端 main 一致' : '最新版本：连接后检查');
  const badge = $('update-state-badge'); badge.textContent = UPDATE_LABELS[st] || st; badge.className = 'badge ' + (UPDATE_CLS[st] || 'off');
  $('update-available-box').hidden = st !== 'available';
  if (st === 'available') $('update-available-text').textContent = '有新版本可用！' + cand + (u.candidate_subject ? ' · ' + u.candidate_subject : '');
  $('apply-backend-update').hidden = st !== 'available';
  const note = $('update-state-note');
  if (UPDATE_NOTES[st]) {
    note.textContent = st === 'failed' ? '检查失败：' + (u.last_error || '原因未知，稍后重试') : UPDATE_NOTES[st];
    note.hidden = false; note.className = 'notice ' + ({ applied: 'neutral', up_to_date: 'neutral' }[st] || (UPDATE_CLS[st] === 'ok' ? 'neutral' : 'warn'));
  } else note.hidden = true;
  const link = $('backend-update-log');
  if (u.repo_slug && short(u.previous) && short(u.candidate) && !['disabled', 'idle', 'up_to_date', 'failed'].includes(st)) {
    link.href = 'https://github.com/' + u.repo_slug + '/compare/' + u.previous.slice(0, 12) + '...' + u.candidate.slice(0, 12); link.hidden = false;
  } else link.hidden = true;
  $('backend-update-json').textContent = json(info);
}
$('check-backend-update').addEventListener('click', () => wrap('update-error', async () => {
  drawBackendUpdate({ version: state.backendVersion || '0.0.0', updates: await api('/api/updates/check', 'POST', {}) });
  scheduleUpdatePoll();
}));
$('apply-backend-update').addEventListener('click', () => wrap('update-error', async () => {
  if (!confirm('立即更新到候选版本？期间会优雅排空在途请求并切换代码，服务可能短暂中断；失败会自动回滚。')) return;
  drawBackendUpdate({ version: state.backendVersion || '0.0.0', updates: await api('/api/updates/apply', 'POST', {}) });
  scheduleUpdatePoll();
}));

/* ---------- UI Release 检查 ---------- */
const UI_VERSION = 'v0.3.2';
async function checkUi() {
  const repo = $('ui-repository').value.trim();
  if (!repo) { notice('ui-update-status', '未配置仓库，不向 GitHub 请求。', 'neutral'); return; }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw Error('仓库必须 owner/repo');
  localStorage.setItem('mgp.uiRepo', repo);
  const response = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', signal: AbortSignal.timeout(10000) });
  if (response.status === 404) { notice('ui-update-status', '公开仓库未发布 Release。', 'warn'); return; }
  if (!response.ok) throw Error('GitHub HTTP ' + response.status);
  const release = await response.json();
  notice('ui-update-status', '最新 ' + release.tag_name + '；当前 ' + UI_VERSION + '。仅提示，不自动执行。', 'neutral');
}
$('ui-update-form').addEventListener('submit', e => { e.preventDefault(); wrap('ui-update-status', checkUi); });
$('clear-ui-repository').addEventListener('click', () => { localStorage.removeItem('mgp.uiRepo'); $('ui-repository').value = ''; notice('ui-update-status', '已清除仓库配置。', 'neutral'); });

/* ---------- 启动 ---------- */
try {
  const saved = JSON.parse(localStorage.getItem('mgp.connection') || 'null');
  if (saved) { $('base-url').value = baseUrl(saved.base); $('api-token').value = saved.token; $('remember-config').checked = true; }
  const repo = localStorage.getItem('mgp.uiRepo');
  if (repo) { $('ui-repository').value = repo; checkUi().catch(e => notice('ui-update-status', e.message)); }
} catch { localStorage.removeItem('mgp.connection'); }
showView('monitor');
enabled(false); guard();
