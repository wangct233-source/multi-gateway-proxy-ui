'use strict';
const $ = id => document.getElementById(id);
const state = {base: '', token: '', gateway: null, gateways: [], caps: {}, settings: {}, kill: true, epoch: 0, backendVersion: '', updateState: 'unknown'};
const names = {'a-cn': 'G1 · A 国内', 'a-intl': 'G2 · A 国际', b: 'G3 · B', c: 'G4 · C'};
const safe = value => {
  const blocked = /^(token|password|authorization|secret|access_token|refresh_token|proxy_url|endpoint)$/i;
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, blocked.test(k) ? '[redacted]' : safe(v)]));
  return value;
};
const json = value => JSON.stringify(safe(value), null, 2);
function notice(id, text, type='danger') { const el=$(id); el.textContent=text||''; el.hidden=!text; if(type) el.className='notice '+type; }
function cell(value) {const td=document.createElement('td'); td.textContent=value ?? '—'; return td;}
function date(value) { return value ? new Date(typeof value==='number' ? value*1000 : value).toLocaleString() : '—'; }
function button(label, action, className='subtle') {const b=document.createElement('button'); b.type='button'; b.textContent=label; b.className=className; b.addEventListener('click',action); return b;}
function baseUrl(value) {const u=new URL(value); if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname)) throw Error('地址须为无路径和凭据的 HTTP(S) BaseURL'); if(u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname)) throw Error('远端必须 HTTPS；测试请使用 SSH 本机端口转发'); return u.origin;}
async function api(path, method='GET', data) {
  if(!state.base||!state.token) throw Error('请先连接');
  const response=await fetch(state.base+path,{method,headers:{Authorization:'Bearer '+state.token,...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(20000),cache:'no-store',credentials:'omit'});
  let result; try {result=await response.json();} catch {throw Error('后端返回非 JSON，HTTP '+response.status);}
  if(!response.ok) {const e=result.error||{}; throw Error('HTTP '+response.status+' · '+(e.code||'request_failed')+' · '+(e.message||'')+'\n'+json(e.missing_evidence||[]));}
  return result;
}
const gwPath=()=>'/api/v1/gateways/'+encodeURIComponent(state.gateway);
async function wrap(id, action) {notice(id,''); try {await action();} catch(e) {notice(id,e.message);} }
function enabled(yes) {document.querySelectorAll('.backend-write').forEach(b=>b.disabled=!yes); ['refresh-all','refresh-gateway'].forEach(id=>$(id).disabled=!yes);}
function drawKill(data) {state.kill=data.enabled!==false; $('kill-summary').textContent=state.kill?'杀开关打开：所有真实任务禁止执行。':'杀开关关闭；仍受网关开关、窗口、额度及证据限制。'; $('kill-badge').textContent=state.kill?'阻断':'已关闭';}
function drawGateways(data) {
  state.gateways=data.gateways||[]; $('gateway-list').replaceChildren();
  state.gateways.forEach(g=>{const b=button((names[g.id]||g.name)+' · '+g.status,()=>select(g.id),'gateway-item'); if(g.id===state.gateway)b.classList.add('selected'); $('gateway-list').append(b);});
  $('gateway-status').textContent=state.gateways.length+' 个网关；并发不等于 QPS。';
}
function drawMetrics(g) {
  $('selected-name').textContent=names[g.id]||g.name; $('gateway-raw').textContent=json(g); $('gateway-metrics').replaceChildren();
  [['状态',g.status],['在途 / 配置并发',g.active+' / '+g.concurrency],['排队 / 上限',g.queued+' / '+g.queue_limit],['账号',g.accounts]].forEach(([label,value])=>{const d=document.createElement('div'); const p=document.createElement('p'); p.textContent=label; const s=document.createElement('strong');s.textContent=value;d.append(p,s);$('gateway-metrics').append(d);});
  notice('gateway-last-error',g.last_error);
}
let loginTimer=null;
function stopLoginPoll(){if(loginTimer){clearTimeout(loginTimer);loginTimer=null;}}
async function pollLogin(gid,st){
  try{
    const r=await api(gwPath()+'/accounts/login-status?state='+encodeURIComponent(st));
    if(r.status==='ok'){notice('login-status','登录成功，账号已入库。','success');stopLoginPoll();await refreshSelected();return;}
    if(r.status==='expired'){notice('login-status','链接已过期，请重新生成。','warning');stopLoginPoll();return;}
    if(r.status==='error'){notice('login-status','登录失败：'+(r.message||'未知错误'),'danger');stopLoginPoll();return;}
    notice('login-status','等待浏览器登录…（链接 10 分钟内有效）','neutral');
  }catch(e){notice('login-status','查询失败：'+e.message,'danger');stopLoginPoll();return;}
  loginTimer=setTimeout(()=>pollLogin(gid,st),3000);
}
function drawAccounts(data) {
  $('accounts-body').replaceChildren(); const choice=$('task-account');choice.replaceChildren();const all=document.createElement('option');all.value='';all.textContent='全部账号';choice.append(all);
  (data.accounts||[]).forEach(a=>{const tr=document.createElement('tr');tr.append(cell(a.id+' / '+a.provider_account_id),cell(a.status+(a.enabled?' · 启用':' · 停用')),cell(a.source),cell(a.in_flight),cell(date(a.cooldown_until)));const td=cell('');td.append(button(a.enabled?'停用':'启用',()=>wrap('accounts-error',async()=>{await api(gwPath()+'/accounts/'+encodeURIComponent(a.id),'PATCH',{enabled:!a.enabled});await refreshSelected();})));tr.append(td);$('accounts-body').append(tr);const o=document.createElement('option');o.value=a.id;o.textContent=a.id;choice.append(o);}); $('accounts-status').textContent=(data.accounts||[]).length+' 个账号；密钥值不会显示。';
  // 登录区仅 CodeBuddy 网关显示
  $('login-zone').style.display=(state.gateway==='a-cn'||state.gateway==='a-intl')?'':'none';
  if(state.gateway!=='a-cn'&&state.gateway!=='a-intl')stopLoginPoll();
}
function drawEgress(data) { $('egress-body').replaceChildren();(data.egress||[]).forEach(e=>{const tr=document.createElement('tr');[e.id,e.role,e.configured?'是':'否',e.healthy?'健康':'不可用',e.error].forEach(v=>tr.append(cell(v)));$('egress-body').append(tr);});$('egress-status').textContent='固定本网关主出口和可选备用，不能挪用其他网关出口。'; }
function drawSettings(data) {state.settings=data;const mapping={concurrency:'setting-concurrency',queue_limit:'setting-queue-limit',queue_timeout:'setting-queue-timeout',task_daily_limit:'setting-task-daily-limit',task_window_start:'setting-task-window-start',task_window_end:'setting-task-window-end'};Object.entries(mapping).forEach(([k,id])=>$(id).value=data[k]??'');$('setting-tasks-enabled').checked=!!data.tasks_enabled;$('settings-fields').disabled=false;$('settings-status').textContent='队列超时单位：秒。HTTP 连接池须不小于配置并发。';guard();}
function drawCaps(data) {state.caps=data.capabilities||{};$('capabilities-list').replaceChildren();Object.entries(state.caps).forEach(([name,c])=>{const d=document.createElement('div');const h=document.createElement('h3');h.textContent=name+' · '+c.status;const pre=document.createElement('pre');pre.textContent=json(c);d.append(h,pre);$('capabilities-list').append(d);});$('capabilities-status').textContent='源码能力与当前 Python 实现分别验收，缺证据不伪成功。';guard();}
function drawRuns(data) {$('tasks-body').replaceChildren();(data.runs||[]).forEach(r=>{const tr=document.createElement('tr');[r.id+' / '+r.gateway_id,r.task_type+' / '+r.status,date(r.started_at),date(r.finished_at),typeof r.result_json==='string'?r.result_json:json(r.result_json)].forEach(v=>tr.append(cell(v)));$('tasks-body').append(tr);});$('tasks-status').textContent=(data.runs||[]).length+' 条记录（含 dry-run，不等于成功领取）。';}
function guard() {const c=state.caps[$('task-type').value]||{};const allowed=!state.kill&&state.settings.tasks_enabled&&c.status==='supported'&&Array.isArray(c.evidence)&&c.evidence.length;const dry=$('task-dry-run').checked;$('run-task').disabled=!state.gateway||(!dry&&!allowed);$('run-task').textContent=dry?'运行 dry-run 预检':'请求真实执行';$('task-guard').textContent=dry?'只发送预检，不触发上游。':allowed?'仍须后端检查窗口、额度与幂等。':'缺少开关/证据授权，真实执行已阻断。';}
async function select(id) {state.gateway=id;const epoch=++state.epoch;state.caps={};state.settings={};['accounts-body','egress-body','tasks-body','capabilities-list'].forEach(key=>$(key).replaceChildren());$('settings-fields').disabled=true;$('task-result').hidden=true;guard();drawGateways({gateways:state.gateways});const g=state.gateways.find(g=>g.id===id);if(g)drawMetrics(g);await refreshSelected(epoch);}
async function refreshSelected(epoch=state.epoch) {if(!state.gateway)return;const base=gwPath();await Promise.all([['accounts',drawAccounts],['egress',drawEgress],['settings',drawSettings],['capabilities',drawCaps],['tasks',drawRuns]].map(async([r,draw])=>{notice(r+'-error','');try{const data=await api(base+'/'+r);if(epoch===state.epoch)draw(data);}catch(e){if(epoch===state.epoch)notice(r+'-error',e.message);}}));}
async function refreshAll() {const data=await api('/api/v1/gateways');drawGateways(data);drawKill(await api('/api/v1/tasks/kill-switch'));drawBackendUpdate(await api('/api/v1/version'));if(!state.gateway&&state.gateways.length)await select(state.gateways[0].id);else {const g=state.gateways.find(x=>x.id===state.gateway);if(g)drawMetrics(g);await refreshSelected();}}
const UPDATE_STATES=['disabled','idle','up_to_date','available','pending','draining','applying','applied','rolled_back','failed'];
const UPDATE_LABELS={disabled:'未启用',idle:'未配置',up_to_date:'已是最新',available:'有新版本',pending:'更新中',draining:'排空中',applying:'应用中',applied:'已更新',rolled_back:'已回滚',failed:'检查失败'};
const UPDATE_NOTES={pending:'更新已确认：正在排空在途请求并切换代码，期间服务可能短暂中断，请勿关闭页面。',draining:'正在排空在途请求…',applying:'正在切换到候选版本…',applied:'更新完成，数据已刷新。',rolled_back:'候选版本验证失败，已自动回滚到之前的版本。',failed:'检查失败：'+'' ,disabled:'后端未启用更新（UPDATES_ENABLED=false）。',idle:'更新已启用但后端未配置仓库。',up_to_date:'当前已是最新版本。'};
let updatePoll=null;
function scheduleUpdatePoll(){if(updatePoll)clearTimeout(updatePoll);updatePoll=setTimeout(runUpdatePoll,2500);}
async function runUpdatePoll(){updatePoll=null;let info;try{info=await api('/api/v1/version');}catch(e){notice('update-error',e.message);return;}drawBackendUpdate(info);if(['pending','draining','applying'].includes(state.updateState))scheduleUpdatePoll();else if(['applied','rolled_back'].includes(state.updateState)){try{await refreshAll();}catch(e){notice('update-error',e.message);}}}
function drawBackendUpdate(info) {
  const u=info.updates||{};const st=UPDATE_STATES.includes(u.state)?u.state:'unknown';state.backendVersion=info.version;state.updateState=st;
  const short=v=>typeof v==='string'&&v.length>=7?v.slice(0,7):'';
  const cur=short(u.commit||u.previous);
  $('backend-version-big').textContent='v'+info.version+(cur?' · '+cur:'');
  const cand=short(u.candidate);
  $('backend-latest').textContent=cand?('最新版本：'+cand+(u.candidate_subject?' · '+u.candidate_subject:'')):(st==='up_to_date'?'最新版本：与远端 main 一致':'最新版本：尚未检查');
  const badge=$('update-state-badge');badge.textContent=UPDATE_LABELS[st]||st;badge.className='badge '+({available:'warning',pending:'warning',draining:'warning',applying:'warning',applied:'success',up_to_date:'success',rolled_back:'danger',failed:'danger'}[st]||'neutral');
  $('update-available-box').hidden=st!=='available';
  if(st==='available')$('update-available-text').textContent='有新版本可用！'+cand+(u.candidate_subject?' · '+u.candidate_subject:'');
  $('apply-backend-update').hidden=st!=='available';
  const note=$('update-state-note');
  if(UPDATE_NOTES[st]){note.textContent=st==='failed'?'检查失败：'+(u.last_error||'原因未知，稍后重试'):UPDATE_NOTES[st];note.hidden=false;note.className='notice '+({available:'warning',pending:'warning',draining:'warning',applying:'warning',applied:'success',up_to_date:'success',rolled_back:'danger',failed:'danger'}[st]||'neutral');}
  else note.hidden=true;
  const link=$('backend-update-log');
  if(u.repo_slug&&short(u.previous)&&short(u.candidate)&&st!=='disabled'&&st!=='idle'&&st!=='up_to_date'&&st!=='failed'){link.href='https://github.com/'+u.repo_slug+'/compare/'+u.previous.slice(0,12)+'...'+u.candidate.slice(0,12);link.hidden=false;}
  else link.hidden=true;
  $('backend-update-json').textContent=json(info);
}
$('connection-form').addEventListener('submit',e=>{e.preventDefault();wrap('connection-error',async()=>{const raw=$('base-url').value.trim();state.base=raw?baseUrl(raw):location.origin;state.token=$('api-token').value.trim();await refreshAll();enabled(true);$('connection-status').textContent='已连接';if($('remember-config').checked){localStorage.setItem('mgp.connection',JSON.stringify({base:state.base,token:state.token}));$('storage-status').textContent='已保存到 localStorage；共享电脑结束后清除。';}else{localStorage.removeItem('mgp.connection');}});});
$('clear-storage').addEventListener('click',()=>{localStorage.removeItem('mgp.connection');state.token='';$('api-token').value='';enabled(false);$('connection-status').textContent='已清除';$('storage-status').textContent='已移除本地 Token。';});
$('refresh-all').addEventListener('click',()=>wrap('gateway-error',refreshAll));$('refresh-gateway').addEventListener('click',()=>wrap('gateway-error',refreshSelected));
['kill-on','kill-off'].forEach(id=>$(id).addEventListener('click',()=>wrap('kill-error',async()=>{if(id==='kill-off'&&!confirm('关闭全局任务杀开关？缺证据能力仍不能执行。'))return;drawKill(await api('/api/v1/tasks/kill-switch','POST',{enabled:id==='kill-on'}));guard();})));
$('account-login').addEventListener('click',()=>wrap('login-status',async()=>{
  stopLoginPoll();
  const r=await api(gwPath()+'/accounts/login-link','POST',{});
  const link=$('login-link');link.href=r.auth_url;link.hidden=false;
  notice('login-status','链接已生成：请点击「打开登录页」完成登录，本页会自动检测。','neutral');
  loginTimer=setTimeout(()=>pollLogin(state.gateway,r.state),3000);
}));
$('settings-form').addEventListener('submit',e=>{e.preventDefault();wrap('settings-error',async()=>{const values={concurrency:Number($('setting-concurrency').value),queue_limit:Number($('setting-queue-limit').value),queue_timeout:Number($('setting-queue-timeout').value),task_daily_limit:Number($('setting-task-daily-limit').value),task_window_start:$('setting-task-window-start').value.slice(0,5),task_window_end:$('setting-task-window-end').value.slice(0,5),tasks_enabled:$('setting-tasks-enabled').checked};if(values.tasks_enabled&&!state.settings.tasks_enabled&&!confirm('开启本网关任务配置？仅有证据且显式运行的任务可以执行。'))return;drawSettings(await api(gwPath()+'/settings','PATCH',values));});});
['task-type','task-dry-run'].forEach(id=>$(id).addEventListener('change',guard));
$('task-form').addEventListener('submit',e=>{e.preventDefault();wrap('tasks-error',async()=>{const dry=$('task-dry-run').checked;const kind=$('task-type').value;if(!dry){drawKill(await api('/api/v1/tasks/kill-switch'));drawSettings(await api(gwPath()+'/settings'));drawCaps(await api(gwPath()+'/capabilities'));guard();if($('run-task').disabled||!confirm('仅限本人或获授权账号，确认真实执行？'))return;}const result=await api(gwPath()+'/tasks/'+kind+'/run','POST',{dry_run:dry,account_id:$('task-account').value||null});$('task-result').hidden=false;$('task-result-json').textContent=json(result);$('task-result-summary').textContent=result.dry_run?(result.allowed?'预检允许；尚未执行':'预检未允许；没有执行'):'后端真实结果，需核对服务端状态';drawRuns(await api(gwPath()+'/tasks'));});});
$('import-form').addEventListener('submit',e=>{e.preventDefault();wrap('accounts-error',async()=>{
  const text=$('import-text').value.trim();
  let items=[];
  if(text){
    try{const parsed=JSON.parse(text);items=Array.isArray(parsed)?parsed:[parsed];}
    catch{throw Error('粘贴的内容不是合法 JSON');}
  }
  const files=$('import-file').files;
  for(const f of files){
    const content=await f.text();
    try{const parsed=JSON.parse(content);items=items.concat(Array.isArray(parsed)?parsed:[parsed]);}
    catch{throw Error('文件 '+f.name+' 不是合法 JSON');}
  }
  if(!items.length)throw Error('请选择文件或粘贴 JSON');
  if(items.length>100)throw Error('单次最多导入 100 个账号');
  const r=await api(gwPath()+'/accounts/import','POST',{items});
  const detail=(r.errors||[]).map(x=>'#'+x.index+':'+x.reason).join('；');
  notice('accounts-error',r.imported?('导入成功 '+r.imported+' 个'+(r.skipped?('，跳过 '+r.skipped+' 个（'+(detail||'重复')+'）'):'')+'。'):'全部跳过：'+(detail||'没有可识别的凭据'),'warning');
  await refreshSelected();
});});
$('batch-checkin').addEventListener('click',()=>wrap('batch-status',async()=>{
  if(!confirm('对全部网关执行批量签到？各网关按自己的策略间隔错峰执行，仍受证据与限额约束。'))return;
  const r=await api('/api/v1/tasks/batch-run','POST',{task_type:'checkin'});
  const parts=Object.entries(r.results||{}).map(([g,x])=>{
    if(x.status==='blocked')return g+'：被门禁阻断';
    if(x.status==='evidence_required')return g+'：证据不足';
    if(x.status==='failed')return g+'：失败';
    const ok=(x.results||[]).filter(y=>y.ok).length, total=(x.results||[]).length;
    return g+'：'+ok+'/'+total+' 成功';
  });
  notice('batch-status','批量签到完成（执行 '+r.executed_gateways+' 个网关）：'+parts.join('；'),'neutral');
  await refreshSelected();
}));
$('check-backend-update').addEventListener('click',()=>wrap('update-error',async()=>{drawBackendUpdate({version:state.backendVersion||'0.0.0',updates:await api('/api/updates/check','POST',{})});}));
$('apply-backend-update').addEventListener('click',()=>wrap('update-error',async()=>{if(!confirm('立即更新到候选版本？期间会优雅排空在途请求并切换代码，服务可能短暂中断；失败会自动回滚。'))return;drawBackendUpdate({version:state.backendVersion||'0.0.0',updates:await api('/api/updates/apply','POST',{})});}));
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(t=>{const active=t===b;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;$('panel-'+t.dataset.tab).hidden=!active;});}));
async function checkUi() {const repo=$('ui-repository').value.trim();if(!repo){notice('ui-update-status','未配置仓库，不向 GitHub 请求。','neutral');return;}if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw Error('仓库必须 owner/repo');localStorage.setItem('mgp.uiRepo',repo);const response=await fetch('https://api.github.com/repos/'+repo+'/releases/latest',{headers:{Accept:'application/vnd.github+json'},credentials:'omit',signal:AbortSignal.timeout(10000)});if(response.status===404){notice('ui-update-status','公开仓库未发布 Release。','warning');return;}if(!response.ok)throw Error('GitHub HTTP '+response.status);const release=await response.json();notice('ui-update-status','最新 '+release.tag_name+'；当前 v0.1.0。仅提示，不自动执行。','neutral');const link=$('ui-release-link');const url=new URL(release.html_url);if(url.origin==='https://github.com'){link.href=url.href;link.hidden=false;}}
$('ui-update-form').addEventListener('submit',e=>{e.preventDefault();wrap('ui-update-status',checkUi);});$('clear-ui-repository').addEventListener('click',()=>{localStorage.removeItem('mgp.uiRepo');$('ui-repository').value='';$('ui-release-link').hidden=true;notice('ui-update-status','已清除仓库配置。','neutral');});
try{const saved=JSON.parse(localStorage.getItem('mgp.connection')||'null');if(saved){$('base-url').value=baseUrl(saved.base);$('api-token').value=saved.token;$('remember-config').checked=true;}const repo=localStorage.getItem('mgp.uiRepo');if(repo){$('ui-repository').value=repo;checkUi().catch(e=>notice('ui-update-status',e.message));}}catch{localStorage.removeItem('mgp.connection');}
enabled(false);guard();
