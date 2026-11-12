import { THEMES, GENDERS, DETAIL_GROUPS, DETAIL_FIELDS, getDetails, DEFAULT_FORM, MAX_DESCRIPTION, uid, normalizePersona, makeTemplate, buildPrompt, parseModelResult, toNativeBackup, parseImport, safeFilename, requestGeneration } from './core.js';

const KEY = 'st_persona_forge_v1';
const context = () => globalThis.SillyTavern.getContext();
let root, state, busy = false, imageFile = null, imageURL = '', previousFocus, personaModule;
let saveTimer;
let scrollLocks = null;
let detailUndo = null;
const $ = id => root.querySelector(`#pf-${id}`);
const button = (id, label, cls = '') => `<button type="button" id="pf-${id}" class="pf-button ${cls}">${label}</button>`;
const field = (id, label, placeholder = '', max = 500) => `<label class="pf-field"><span>${label}</span><input id="pf-${id}" maxlength="${max}" placeholder="${placeholder}"></label>`;

function settings() {
    const c = context();
    const defaults = { form: { ...DEFAULT_FORM }, current: { name: '', title: '', description: '' }, drafts: [] };
    let stored = c.extensionSettings[KEY];
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = defaults;
    stored.form = { ...DEFAULT_FORM, ...stored.form };
    if (!GENDERS.includes(stored.form.gender)) {
        stored.form.genderCustom = typeof stored.form.gender === 'string' ? stored.form.gender : '';
        stored.form.gender = stored.form.genderCustom ? '自定义' : '自由设定';
    }
    stored.form.details = getDetails(stored.form);
    stored.current = { ...defaults.current, ...stored.current };
    stored.drafts = Array.isArray(stored.drafts) ? stored.drafts.slice(0, 50) : [];
    c.extensionSettings[KEY] = stored;
    return stored;
}
function syncGenderField() { $('gender-custom-field').hidden = $('gender').value !== '自定义'; }
function detailPanel() {
    return `<section class="pf-detail-panel" aria-labelledby="pf-detail-heading"><div class="pf-detail-heading"><strong id="pf-detail-heading">人物细节</strong><small id="pf-detail-count">0/${DETAIL_FIELDS.length}</small>${button('clear-details', '清空细节', 'pf-small')}</div><p class="pf-muted">按需展开填写。已填写的事实会优先保留；留空部分交给 AI 创作。</p>${DETAIL_GROUPS.map(group => `<details class="pf-details" id="pf-detail-group-${group.id}"><summary>${group.label} <small id="pf-detail-count-${group.id}"></small></summary>${group.fields.map(([key, label, placeholder]) => `<label class="pf-field"><span>${label}</span><textarea id="pf-detail-${key}" rows="2" maxlength="1000" placeholder="${placeholder}"></textarea></label>`).join('')}</details>`).join('')}</section>`;
}
function syncDetailCounter() {
    const values = getDetails(state.form);
    $('detail-count').textContent = `${Object.keys(values).length}/${DETAIL_FIELDS.length} 已填写`;
    for (const group of DETAIL_GROUPS) $('detail-count-' + group.id).textContent = `${group.fields.filter(([key]) => values[key]).length}/${group.fields.length}`;
    $('clear-details').textContent = detailUndo ? '撤销清空' : '清空细节';
}
function restoreDetailInputs() {
    for (const [key] of DETAIL_FIELDS) $('detail-' + key).value = state.form.details[key] || '';
    syncDetailCounter();
}
function persist() { context().saveSettingsDebounced(); }
function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 400); }
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('pf-error', error); }
function report(error) { console.error('[Persona Forge]', error); status(error.message || String(error), true); }
function readEditor() {
    return { name: $('out-name').value.trim(), title: $('out-title').value.trim(), description: $('description').value.trim() };
}
function syncEditor() {
    state.current = readEditor();
    $('count').textContent = `${state.current.description.length.toLocaleString()} 字符`;
    queueSave();
}
function setEditor(persona) {
    $('out-name').value = persona.name || '';
    $('out-title').value = persona.title || '';
    $('description').value = persona.description || '';
    syncEditor();
}
function snapshot(persona = state.current) {
    if (!persona?.name?.trim() || !persona?.description?.trim()) return;
    const p = normalizePersona(persona);
    const first = state.drafts[0];
    if (first && JSON.stringify(first.persona) === JSON.stringify(p)) return;
    state.drafts.unshift({ id: uid(), date: new Date().toISOString(), persona: p });
    state.drafts = state.drafts.slice(0, 50);
    persist(); renderDrafts();
}
function replaceEditor(persona) { snapshot(readEditor()); setEditor(persona); }
function setBusy(value) {
    busy = value;
    root.querySelectorAll('input,select,textarea,button').forEach(el => {
        if (!['pf-close', 'pf-open-help', 'pf-nav-create', 'pf-nav-editor', 'pf-nav-drafts'].includes(el.id)) el.disabled = value;
    });
    root.setAttribute('aria-busy', String(value));
    $('generate').textContent = value ? '正在生成…' : '✦ AI 生成／完善';
}
async function guard(action) { try { await action(); } catch (e) { report(e); } }
function download(data, name, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function loadPersonaModule() {
    if (!personaModule) personaModule = await import(new URL('../../../personas.js', import.meta.url).href);
    return personaModule;
}
async function powerSettings() { return context().powerUserSettings || (await import(new URL('../../../power-user.js', import.meta.url).href)).power_user; }
async function refreshPersonas() {
    try {
        const power = await powerSettings();
        const select = $('existing'); const previous = select.value;
        select.replaceChildren(new Option('选择已有用户设定…', ''));
        for (const [key, name] of Object.entries(power.personas || {})) select.add(new Option(String(name), key));
        if ([...select.options].some(x => x.value === previous)) select.value = previous;
    } catch { status('当前版本无法读取设定列表，仍可生成及导出 JSON。'); }
}
function renderDrafts() {
    const list = $('drafts'); list.replaceChildren();
    $('draft-count').textContent = `${state.drafts.length}/50`;
    if (!state.drafts.length) { const empty = document.createElement('p'); empty.className = 'pf-muted'; empty.textContent = '保存喜欢的版本；替换当前内容时也会自动留存。'; list.append(empty); return; }
    for (const item of state.drafts) {
        if (!item?.persona) continue;
        const row = document.createElement('div'); row.className = 'pf-draft';
        const load = document.createElement('button'); load.type = 'button'; load.className = 'pf-draft-load';
        const name = document.createElement('strong'); name.textContent = item.persona.name;
        const date = document.createElement('small'); date.textContent = new Date(item.date).toLocaleString();
        load.append(name, date); load.addEventListener('click', () => { if (busy) return; guard(() => { replaceEditor(normalizePersona(item.persona)); goToPart('editor'); status('已载入草稿。'); }); });
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'pf-button pf-small'; remove.textContent = '删除';
        remove.addEventListener('click', () => { if (busy) return; state.drafts = state.drafts.filter(x => x.id !== item.id); persist(); renderDrafts(); });
        row.append(load, remove); list.append(row);
    }
}
async function generate() {
    if (busy) return;
    const c = context();
    const fn = state.form.mode === 'chat' ? c.generateQuietPrompt : c.generateRaw;
    if (typeof fn !== 'function') throw new Error('当前酒馆版本缺少生成接口，请升级或使用本地模板。');
    if (c.onlineStatus === 'no_connection') throw new Error('请先在酒馆连接可用的模型 API，或使用免 API 模板。');
    const form = { ...state.form }, current = readEditor();
    let character = null;
    if (form.characterContext) {
        const ch = c.characters?.[c.characterId];
        if (!ch) throw new Error('请先打开一个单人角色聊天，或取消勾选角色参考。');
        character = { name: ch.name, description: ch.data?.description || ch.description, scenario: ch.data?.scenario || ch.scenario };
    }
    const prompt = buildPrompt(form, current.name && current.description ? current : null, character);
    const length = { short: 900, standard: 1800, detailed: 3000, dossier: 5000 }[form.length] || 1800;
    setBusy(true); status('正在使用酒馆当前连接生成，请稍候。可关闭窗口，结果会保留。');
    try {
        const result = await requestGeneration(c, form.mode, prompt, length);
        const persona = parseModelResult(result, form.name || current.name);
        replaceEditor(persona); snapshot(persona); revealEditor(); status('生成完成。可以继续修改，再新增到酒馆或导出。');
    } finally { setBusy(false); }
}
async function placeholderAvatar(name) {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 600;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 400, 600); gradient.addColorStop(0, '#353058'); gradient.addColorStop(1, '#151728');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 400, 600);
    ctx.fillStyle = '#e6cc9b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '140px sans-serif';
    ctx.fillText(Array.from(name)[0] || 'P', 200, 275);
    ctx.font = '20px sans-serif'; ctx.fillText('PERSONA FORGE', 200, 480);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法创建头像，请选择本地图片。')), 'image/png'));
}
async function installPersona() {
    if (busy) return;
    const p = normalizePersona(readEditor());
    const c = context(), mod = await loadPersonaModule();
    if (typeof mod.initPersona !== 'function' || typeof mod.getUserAvatars !== 'function') throw new Error('此版本不支持一键新增，请导出酒馆 JSON 后在用户设定管理中恢复。');
    const activate = $('activate').checked;
    if (activate && typeof mod.setUserAvatar !== 'function') throw new Error('此版本无法自动切换，请取消勾选“新增后切换”。');
    const id = `persona-forge-${uid()}.png`;
    const power = await powerSettings();
    if (Object.hasOwn(power.personas || {}, id)) throw new Error('标识冲突，请重试。');
    const image = imageFile || await placeholderAvatar(p.name);
    const form = new FormData(); form.append('avatar', image, id); form.append('overwrite_name', id);
    setBusy(true); status('正在新增用户设定…');
    let created = false;
    try {
        const headers = { ...c.getRequestHeaders() };
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'content-type') delete headers[key];
        const response = await fetch('/api/avatars/upload', { method: 'POST', headers, body: form });
        if (!response.ok) throw new Error(`头像上传失败（HTTP ${response.status}），设定尚未新增。`);
        const result = await response.json();
        if (result.path !== id) throw new Error('酒馆返回的头像标识与请求不符，请改用 JSON 导入。');
        // Upload succeeded first: a failed upload can never leave a phantom persona.
        await mod.initPersona(id, p.name, p.description, p.title);
        created = true;
        // Older versions ignore the fourth argument. Preserve the optional title there too.
        if (power.persona_descriptions?.[id]) power.persona_descriptions[id].title = p.title;
        persist(); snapshot(p);
        await mod.getUserAvatars(true, id);
        if (activate) await mod.setUserAvatar(id);
        await refreshPersonas();
        status(`已新增“${p.name}”${activate ? '并切换为当前用户设定' : '，可在酒馆用户设定管理中选择'}。`);
    } catch (error) {
        if (created) throw new Error(`“${p.name}”已新增，但界面刷新或切换失败。请刷新酒馆后查看，避免重复新增。${error.message}`);
        // initPersona can write data before a lifecycle listener throws.
        if (power.personas?.[id]) { persist(); throw new Error('设定已写入，但酒馆事件处理失败。请刷新后查看，避免重复新增。'); }
        throw error;
    } finally { setBusy(false); }
}
function syncViewport() {
    root.style.setProperty('--pf-viewport-height', `${Math.round(window.visualViewport?.height || window.innerHeight)}px`);
}
function goToPart(part) {
    const target = $(part === 'drafts' ? 'draft-section' : `${part}-section`);
    if (part === 'drafts') target.open = true;
    const scroller = $('page-content');
    scroller.scrollTo({ top: target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop, behavior: 'instant' });
    root.querySelectorAll('.pf-nav button').forEach(button => button.setAttribute('aria-current', String(button.id === `pf-nav-${part}`)));
}
function revealEditor() { if (window.matchMedia('(max-width: 760px)').matches) goToPart('editor'); }
function open() {
    if (root.open) return;
    previousFocus = document.activeElement;
    syncViewport();
    scrollLocks = [document.documentElement, document.body].map(element => ({ element, value: element.style.getPropertyValue('overflow'), priority: element.style.getPropertyPriority('overflow') }));
    for (const lock of scrollLocks) lock.element.style.setProperty('overflow', 'hidden', 'important');
    root.hidden = false; root.classList.remove('pf-hidden');
    if (typeof root.showModal === 'function') root.showModal();
    else root.setAttribute('open', '');
    $('page-content').scrollTop = 0;
    const connected = context().onlineStatus && context().onlineStatus !== 'no_connection';
    $('connection').textContent = connected ? '模型已连接' : '未连接模型 · 可用模板';
    refreshPersonas(); $('close').focus({ preventScroll: true });
}
function close() {
    syncEditor(); persist();
    if (typeof root.close === 'function') root.close(); else root.removeAttribute('open');
    root.hidden = true; root.classList.add('pf-hidden');
    for (const lock of scrollLocks || []) {
        if (lock.value) lock.element.style.setProperty('overflow', lock.value, lock.priority);
        else lock.element.style.removeProperty('overflow');
    }
    scrollLocks = null; previousFocus?.focus?.({ preventScroll: true });
}
function initialize() {
    if (document.getElementById('pf-host')) return;
    state = settings();
    const pageHost = document.createElement('div'); pageHost.id = 'pf-host';
    const shadow = pageHost.attachShadow({ mode: 'open' });
    const sheet = document.createElement('link'); sheet.rel = 'stylesheet'; sheet.href = new URL('./style.css?v=1.3.0', import.meta.url).href;
    const critical = document.createElement('style');
    critical.textContent = ':host{all:initial}:where(dialog#pf-overlay){position:fixed;inset:0;margin:0;padding:0;border:0;max-width:none;max-height:none;width:100%;height:100dvh;background:#151722;color:#efedf5}dialog#pf-overlay[hidden]{display:none!important}';
    shadow.append(critical, sheet);
    root = document.createElement('dialog'); root.id = 'pf-overlay'; root.className = 'pf-hidden'; root.hidden = true;
    root.setAttribute('aria-labelledby', 'pf-heading');
    shadow.append(root); document.body.append(pageHost);
    window.visualViewport?.addEventListener('resize', syncViewport);
    window.addEventListener('resize', syncViewport);
    root.addEventListener('cancel', event => { event.preventDefault(); close(); });
    root.innerHTML = `<section class="pf-window">
      <header class="pf-header"><div><div class="pf-eyebrow">PERSONA FORGE / 用户设定工坊</div><h2 id="pf-heading">用户设定工坊</h2><p>创建自己的故事身份 <span id="pf-connection" class="pf-connection"></span></p></div>${button('close', '返回酒馆 ×', 'pf-close')}</header>
      <nav class="pf-nav" aria-label="页面导航">${button('nav-create', '01 创作设定')}${button('nav-editor', '02 编辑与导出')}${button('nav-drafts', '草稿架')}</nav>
      <div class="pf-body" id="pf-page-content"><div class="pf-controls" id="pf-create-section">
      <div class="pf-section-heading"><span>01 / 创作方向</span><small>空白项交给 AI</small></div>
      <div class="pf-grid"><label class="pf-field"><span>世界题材</span><select id="pf-theme"></select></label>${field('name', '姓名', '留空则自动取名', 120)}${field('age', '年龄', '例如：25', 80)}<label class="pf-field"><span>性别</span><select id="pf-gender"></select></label></div>
      <label class="pf-field" id="pf-gender-custom-field" hidden><span>自定义性别</span><input id="pf-genderCustom" maxlength="100" placeholder="填写性别，或留空由 AI 设定"></label>
      ${field('identity', '身份／职业', '例如：隐瞒身份的旅行医师')}${field('traits', '性格关键词', '例如：慢热、嘴硬心软、警惕心强')}${field('relation', '与对方角色的关系', '例如：失联后重逢的旧友')}
      <label class="pf-field"><span>背景、能力与其他要求</span><textarea id="pf-keywords" rows="3" maxlength="4000" placeholder="想保留的经历、弱点、目标、世界规则…"></textarea></label>
      ${detailPanel()}
      <div class="pf-grid"><label class="pf-field"><span>输出语言</span><select id="pf-language"><option>简体中文</option><option>繁體中文</option><option>English</option></select></label><label class="pf-field"><span>设定篇幅</span><select id="pf-length"><option value="short">精简</option><option value="standard">标准</option><option value="detailed">详细</option><option value="dossier">完整档案</option></select></label></div>
      <details class="pf-details"><summary>生成参考与连接</summary><label class="pf-field"><span>生成模式</span><select id="pf-mode"><option value="raw">独立创作（不读取聊天）</option><option value="chat">沿用当前聊天上下文与预设</option></select></label><label class="pf-check"><input id="pf-characterContext" type="checkbox">参考当前单人聊天的角色卡</label><p class="pf-muted">AI 使用酒馆当前连接和模型参数。上下文模式会把当前聊天、用户设定等参考内容发送给该模型；独立模式不会主动读取聊天。</p></details>
      <div class="pf-actions">${button('generate', '✦ AI 生成／完善', 'pf-primary')}${button('template', '免 API 中文模板')}</div>
      <p class="pf-muted">AI 生成会参考编辑器已有内容。想从头创作时，先点“新建设定”。</p>
      <details class="pf-details"><summary>从酒馆读取已有用户设定</summary><select id="pf-existing" aria-label="已有用户设定"></select><div class="pf-actions">${button('load-existing', '读取到编辑器')}${button('refresh', '刷新列表')}</div><p class="pf-muted">读取后可完善并保存为新设定。</p></details>
      <details class="pf-details" id="pf-draft-section"><summary>草稿架 <span id="pf-draft-count">0/50</span></summary><div id="pf-drafts"></div></details>
      </div><div class="pf-editor" id="pf-editor-section">
      <div class="pf-section-heading"><span>02 / 你的用户设定</span>${button('new', '新建设定', 'pf-small')}</div>
      <div class="pf-grid">${field('out-name', '设定姓名', '用于酒馆显示', 120)}${field('out-title', '列表标签', '可选，例如：现代 · 旧友', 160)}</div>
      <label class="pf-field pf-description-field"><span>设定描述 <small id="pf-count">0 字符</small></span><textarea id="pf-description" maxlength="${MAX_DESCRIPTION}" placeholder="生成的设定会出现在这里，也可以直接粘贴或手动编写。支持 {{user}} 和 {{char}} 宏。"></textarea></label>
      <div class="pf-avatar-row"><img id="pf-avatar-preview" alt="待新增的用户头像" hidden><label class="pf-field"><span>头像（可选，本地图片）</span><input id="pf-avatar" type="file" accept="image/png,image/jpeg,image/webp"></label>${button('clear-avatar', '移除', 'pf-small')}</div>
      <label class="pf-check"><input id="pf-activate" type="checkbox">新增后切换为当前用户设定</label>
      <div class="pf-actions">${button('install', '新增到酒馆', 'pf-primary')}${button('save', '保存草稿')}${button('copy', '复制描述')}</div>
      <div class="pf-actions pf-export">${button('export', '导出酒馆 JSON')}${button('txt', '导出 TXT')}${button('import', '导入 JSON')}<input id="pf-file" type="file" accept=".json,application/json" hidden></div>
      <details class="pf-details"><summary id="pf-open-help">使用说明</summary><p>生成后检查姓名和描述，点击“新增到酒馆”即可创建独立用户设定。无头像时会自动创建姓名首字头像。JSON 可在酒馆“用户设定管理 → 恢复”中导入；头像不包含在 JSON 内。模板按钮提供中文起稿，AI 按所选语言创作。</p><p>草稿保存在酒馆设置内，头像只保留到关闭或刷新页面前；需要迁移时请导出 JSON。新增后切换可能触发酒馆自身的首条消息刷新或自动锁定行为。</p></details>
      </div></div><footer><span class="pf-status" id="pf-status" role="status" aria-live="polite">准备好开始一个新身份。</span><span class="pf-version">v1.3.0</span></footer>
    </section>`;
    for (const [key, theme] of Object.entries(THEMES)) $('theme').add(new Option(theme[0], key));
    for (const gender of GENDERS) $('gender').add(new Option(gender === '自由设定' ? '不指定' : gender, gender));
    for (const key of Object.keys(DEFAULT_FORM)) {
        const el = $(key); if (!el) continue;
        if (el.type === 'checkbox') el.checked = Boolean(state.form[key]); else el.value = state.form[key];
        el.addEventListener('input', () => { state.form[key] = el.type === 'checkbox' ? el.checked : el.value; if (key === 'gender') syncGenderField(); queueSave(); });
    }
    syncGenderField();
    for (const [key] of DETAIL_FIELDS) {
        const el = $('detail-' + key);
        el.addEventListener('input', () => { state.form.details[key] = el.value; detailUndo = null; syncDetailCounter(); queueSave(); });
    }
    restoreDetailInputs();
    for (const id of ['out-name', 'out-title', 'description']) $(id).addEventListener('input', syncEditor);
    setEditor(state.current); renderDrafts();
    const on = (id, action) => $(id).addEventListener('click', () => guard(action));
    on('close', close);
    on('clear-details', () => {
        if (detailUndo) { state.form.details = { ...detailUndo }; detailUndo = null; status('已恢复清空前的人物细节。'); }
        else {
            if (!Object.keys(getDetails(state.form)).length) { status('人物细节尚未填写。'); return; }
            detailUndo = { ...state.form.details }; state.form.details = {}; status('已清空细节，点击“撤销清空”可以恢复。编辑器内容已保留。');
        }
        restoreDetailInputs(); persist();
    });
    for (const part of ['create', 'editor', 'drafts']) on(`nav-${part}`, () => goToPart(part));
    on('generate', generate); on('install', installPersona);
    on('template', () => { replaceEditor(makeTemplate(state.form)); revealEditor(); status('已载入中文模板，可编辑后保存，或让 AI 进一步完善。'); });
    on('new', () => { snapshot(readEditor()); setEditor({}); $('name').value = ''; state.form.name = ''; clearAvatar(); persist(); goToPart('create'); status('已新建，上一份有效内容已存入草稿。'); });
    on('save', () => { snapshot(normalizePersona(readEditor())); status('已保存草稿。'); });
    on('refresh', refreshPersonas);
    on('load-existing', async () => {
        const key = $('existing').value; if (!key) throw new Error('请先选择一个用户设定。');
        const power = await powerSettings(); const descriptor = power.persona_descriptions?.[key] || {};
        replaceEditor({ name: power.personas[key], title: descriptor.title || '', description: descriptor.description || '' });
        $('name').value = power.personas[key]; state.form.name = power.personas[key]; queueSave(); clearAvatar(); revealEditor();
        status('已读取为草稿；新增时会创建另一份用户设定。头像可另行选择。');
    });
    on('copy', async () => {
        const p = normalizePersona(readEditor());
        if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(p.description); status('已复制描述。'); }
        else { $('description').focus(); $('description').select(); if (!document.execCommand('copy')) throw new Error('浏览器不允许自动复制，请长按描述框手动复制。'); status('已复制描述。'); }
    });
    on('export', () => { const p = normalizePersona(readEditor()); download(JSON.stringify(toNativeBackup(p), null, 2), `${safeFilename(p.name)}_persona.json`, 'application/json'); status('已导出，可在酒馆用户设定管理中“恢复”。'); });
    on('txt', () => { const p = normalizePersona(readEditor()); download(`${p.name}\n${p.title}\n\n${p.description}`, `${safeFilename(p.name)}_persona.txt`, 'text/plain;charset=utf-8'); });
    on('import', () => $('file').click());
    $('file').addEventListener('change', () => guard(async () => {
        const file = $('file').files[0]; $('file').value = ''; if (!file) return;
        if (file.size > 2 * 1024 * 1024) throw new Error('JSON 文件请小于2 MB。');
        const items = parseImport(await file.text()); if (!items.length) throw new Error('文件中没有可导入设定。');
        snapshot(readEditor());
        for (const p of items.slice().reverse()) snapshot(p);
        setEditor(items[0]); clearAvatar(); revealEditor(); status(`已读取${items.length}条设定到草稿（最多保留50条），首条已载入编辑器。尚未新增到酒馆。`);
    }));
    $('avatar').addEventListener('change', () => guard(async () => {
        const file = $('avatar').files[0]; if (!file) return;
        clearAvatar();
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('请选择不超过5 MB的PNG、JPEG或WebP图片。');
        const test = new Image(), url = URL.createObjectURL(file);
        try { test.src = url; await test.decode(); } catch { URL.revokeObjectURL(url); throw new Error('图片无法解码，请重新选择。'); }
        imageFile = file; imageURL = url; $('avatar-preview').src = url; $('avatar-preview').hidden = false;
    }));
    on('clear-avatar', clearAvatar);
    root.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        if (e.key === 'Tab') {
            const focusable = [...root.querySelectorAll('button,input,textarea,select,summary')].filter(el => !el.disabled && el.getClientRects().length);
            const first = focusable[0], last = focusable.at(-1);
            if (e.shiftKey && root.getRootNode().activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && root.getRootNode().activeElement === last) { e.preventDefault(); first?.focus(); }
        }
    });
    const host = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (host) {
        const entry = document.createElement('div'); entry.className = 'pf-entry';
        const title = document.createElement('strong'); title.textContent = '用户设定工坊 · Persona Forge';
        const launch = document.createElement('button'); launch.type = 'button'; launch.className = 'menu_button'; launch.textContent = '打开用户设定生成器'; launch.addEventListener('click', open);
        entry.append(title, launch); host.append(entry);
    }
    const c = context();
    if (c.SlashCommandParser && c.SlashCommand) c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({ name: 'persona-forge', callback: async () => { open(); return ''; }, helpString: '打开用户设定生成器。' }));
}
function clearAvatar() {
    imageFile = null; if (imageURL) URL.revokeObjectURL(imageURL); imageURL = ''; $('avatar').value = ''; $('avatar-preview').removeAttribute('src'); $('avatar-preview').hidden = true;
}
// APP_READY replays for late subscribers; a single mount guard supports both loader generations.
if (globalThis.SillyTavern?.getContext) {
    const c = context(), events = c.eventTypes || c.event_types;
    if (c.eventSource && events?.APP_READY) c.eventSource.on(events.APP_READY, initialize);
    else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
}
