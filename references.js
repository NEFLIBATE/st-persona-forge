import { detectCardType } from './play-context.js';

const MAX_NPCS = 20;
const MAX_LORE = 12;
const clean = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const list = value => Array.isArray(value) ? value : [];

export function cardGreetings(card) {
    const data = card?.data || {};
    return [
        { id: 'main', label: '默认开场白', content: data.first_mes || card?.first_mes },
        ...list(data.alternate_greetings ?? card?.alternate_greetings).map((content, i) => ({ id: `alt:${i}`, label: `备选开场白 ${i + 1}`, content })),
        ...list(data.group_only_greetings).map((content, i) => ({ id: `group:${i}`, label: `群聊开场白 ${i + 1}`, content })),
    ].filter(item => typeof item.content === 'string' && item.content.trim());
}

export function bookEntries(book) {
    if (!book?.entries || typeof book.entries !== 'object') return [];
    return Object.entries(book.entries).flatMap(([id, entry]) => {
        if (typeof entry?.content !== 'string' || !entry.content.trim()) return [];
        const keys = list(entry.key ?? entry.keys).filter(key => typeof key === 'string');
        const title = clean(entry.comment, 160) || clean(entry.name, 160) || clean(keys[0], 160) || `条目 ${id}`;
        const entryId = Array.isArray(book.entries) && entry.id != null ? String(entry.id) : id;
        return [{ id: entryId, title, keys, content: entry.content }];
    });
}

function sourceLink(source) {
    if (typeof source?.book !== 'string' || !source.book || typeof source.entry !== 'string' || !source.entry) return null;
    return { book: source.book.slice(0, 512), entry: source.entry.slice(0, 240), label: clean(source.label, 240) };
}

export function normalizeReferences(value) {
    return {
        card: clean(value?.card, 512),
        greeting: clean(value?.greeting, 32),
        greetingCard: clean(value?.greetingCard, 512),
        book: typeof value?.book === 'string' ? value.book.slice(0, 512) : '',
        lore: list(value?.lore).slice(0, MAX_LORE).map(sourceLink).filter(Boolean),
        npcs: list(value?.npcs).filter(row => row && typeof row === 'object').slice(0, MAX_NPCS).map(row => ({
            name: clean(row.name, 120),
            relation: clean(row.relation, 500),
            source: sourceLink(row.source),
        })),
    };
}

export function npcRelationships(npcs) {
    return normalizeReferences({ npcs }).npcs.filter(row => row.name && row.relation);
}

export function referencesPanel() {
    return `<details class="pf-details pf-reference-panel" id="pf-reference-panel">
        <summary>角色卡、开场白与世界书</summary>
        <label class="pf-field"><span>参考角色卡</span><select id="pf-ref-card"></select></label>
        <label class="pf-check" id="pf-current-card-option"><input id="pf-characterContext" type="checkbox">未指定时参考当前单人聊天角色卡</label>
        <label class="pf-field"><span>参考开场白</span><select id="pf-ref-greeting"><option value="">不参考开场白</option></select></label>
        <textarea class="pf-ref-preview" id="pf-ref-greeting-preview" rows="4" aria-label="开场白原文预览" readonly hidden></textarea>
        <p class="pf-muted" id="pf-ref-card-status" role="status"></p>
        <details class="pf-details" id="pf-ref-card-preview" hidden>
            <summary>预览角色资料</summary>
            <textarea class="pf-ref-preview" id="pf-ref-card-text" rows="4" aria-label="角色资料原文预览" readonly></textarea>
        </details>
        <label class="pf-field"><span>浏览世界书</span><select id="pf-ref-book"><option value="">选择世界书…</option></select></label>
        <div id="pf-ref-entry-picker" hidden>
            <label class="pf-field"><span>搜索世界书条目</span><input id="pf-ref-search" type="search" maxlength="120" placeholder="输入 NPC 姓名、条目标题或关键词"></label>
            <label class="pf-field"><span>选择条目</span><select id="pf-ref-entry"></select></label>
            <textarea class="pf-ref-preview" id="pf-ref-entry-preview" rows="4" aria-label="世界书条目原文预览" readonly hidden></textarea>
            <div class="pf-actions">
                <button type="button" class="pf-button pf-small" id="pf-ref-lore-add">加入世界参考</button>
                <button type="button" class="pf-button pf-small" id="pf-ref-npc-add">从此条目添加 NPC</button>
            </div>
        </div>
        <p class="pf-muted" id="pf-ref-book-status" role="status"></p>
        <div id="pf-ref-lore-list"></div>
        <div class="pf-detail-heading"><strong>NPC 关系</strong><small id="pf-ref-npc-count"></small></div>
        <p class="pf-muted" id="pf-npc-relation-hint">姓名和关系都填好后才会写入设定。</p>
        <div id="pf-ref-npcs"></div>
        <button type="button" class="pf-button pf-small" id="pf-ref-manual">手动添加 NPC</button>
        <p class="pf-muted">AI 生成会把选取的角色、开场白和条目摘录发送给当前模型。这里的选择仅用于 Persona 创作。</p>
        <button type="button" class="pf-button pf-small" id="pf-ref-refresh">重新读取角色卡与世界书</button>
    </details>`;
}

export function mountReferences({ get, context, state, save, guard, isBusy, onTypeChange }) {
    let card = null;
    let book = null;
    let worldNames = [];
    let cardRun = 0;
    let bookRun = 0;
    let listRun = 0;
    const refs = state.references;
    const cardSelect = get('ref-card');
    const greetingSelect = get('ref-greeting');
    const bookSelect = get('ref-book');
    const entrySelect = get('ref-entry');

    const setOptions = (select, placeholder, options, value = '') => {
        select.replaceChildren(new Option(placeholder, ''), ...options.map(({ label, id }) => new Option(label, id)));
        select.value = [...select.options].some(option => option.value === value) ? value : '';
    };
    const cardList = () => Object.entries(context().characters || {}).filter(([, item]) => item?.name || item?.data?.name)
        .map(([key, item]) => ({ id: item.avatar ? `avatar:${item.avatar}` : `slot:${key}`, key, item }));
    const isGroup = c => c.groupId != null && c.groupId !== '' && c.groupId !== false;
    const selectedCard = () => cardList().find(record => record.id === refs.card);
    const currentCard = () => {
        const c = context();
        if (!isGroup(c)) return cardList().find(record => record.key === String(c.characterId));
    };
    const activeCard = () => refs.card ? selectedCard() : (state.form.characterContext ? currentCard() : undefined);

    function profileFor(record, data) {
        const c = context();
        if (!refs.card && isGroup(c)) {
            return { ...detectCardType(null, true), source: `group:${c.groupId}` };
        }
        const item = data || record?.item;
        return {
            ...detectCardType(item),
            source: record?.id || refs.card || '',
            name: item?.data?.name || item?.name || '',
        };
    }

    function currentProfile() {
        const record = refs.card ? selectedCard() : currentCard();
        return profileFor(record, record && card?.id === record.id ? card.data : null);
    }

    async function readCard(record) {
        if (!record) throw new Error('所选角色卡不在当前列表中，请重新选择。');
        if (!record.item.shallow) return record.item;
        const response = await fetch('/api/characters/get', {
            method: 'POST',
            headers: context().getRequestHeaders(),
            body: JSON.stringify({ avatar_url: record.item.avatar }),
        });
        if (!response.ok) throw new Error('无法读取角色卡，请重新读取后再试。');
        const result = await response.json();
        if (!result?.name && !result?.data?.name) throw new Error('角色卡没有返回有效内容。');
        return result;
    }

    function refreshGreeting() {
        const selected = card?.id === refs.greetingCard && cardGreetings(card.data).find(item => item.id === refs.greeting);
        const preview = get('ref-greeting-preview');
        preview.hidden = !selected;
        preview.value = selected?.content || '';
    }

    function renderBooks() {
        const options = worldNames.map(name => ({
            id: `world:${name}`,
            label: name === card?.data?.data?.extensions?.world ? `${name}（角色关联）` : name,
        }));
        if (card?.data?.data?.character_book?.entries) {
            options.unshift({
                id: `embedded:${card.id}`,
                label: `角色内置 · ${card.data.data.character_book.name || card.data.name || card.data.data.name}`,
            });
        }
        setOptions(bookSelect, '选择世界书…', options, refs.book);
        if (refs.book && !bookSelect.value) {
            bookSelect.add(new Option('已选世界书暂不可用', refs.book));
            bookSelect.value = refs.book;
        }
    }

    async function refreshCard() {
        const run = ++cardRun;
        ++bookRun;
        book = null;
        get('ref-entry-picker').hidden = true;
        get('ref-card-preview').hidden = true;
        get('ref-card-text').value = '';
        card = null;
        setOptions(greetingSelect, '不参考开场白', []);
        refreshGreeting();
        const record = activeCard();
        onTypeChange();
        const info = get('ref-card-status');
        if (!record && !refs.card && !state.form.characterContext) {
            info.textContent = '';
        } else {
            info.textContent = '正在读取角色卡…';
            try {
                const data = await readCard(record);
                if (run !== cardRun) return;
                card = { id: record.id, data };
                const profile = [
                    ['角色描述', data.data?.description || data.description],
                    ['性格', data.data?.personality || data.personality],
                    ['场景', data.data?.scenario || data.scenario],
                ].filter(([, value]) => typeof value === 'string' && value.trim());
                get('ref-card-preview').hidden = !profile.length;
                get('ref-card-text').value = profile.map(([label, value]) => `【${label}】\n${value}`).join('\n\n');
                const greetings = cardGreetings(data);
                const belongsToCard = record.id === refs.greetingCard;
                setOptions(greetingSelect, '不参考开场白', greetings, belongsToCard ? refs.greeting : '');
                if (refs.greeting && !greetingSelect.value) {
                    const option = new Option('原选开场白不可用，请重新选择', 'unavailable');
                    option.disabled = true;
                    greetingSelect.add(option);
                    greetingSelect.value = option.value;
                }
                refreshGreeting();
                info.textContent = `已读取 ${data.data?.name || data.name} · ${greetings.length} 条开场白`;
            } catch (error) {
                if (run !== cardRun) return;
                info.textContent = error.message;
            }
        }
        if (run !== cardRun) return;
        onTypeChange();
        renderBooks();
        await refreshBook();
    }

    async function readBook(id, selectedCard = card) {
        if (id.startsWith('embedded:')) {
            const cardId = id.slice('embedded:'.length);
            const data = selectedCard?.id === cardId ? selectedCard.data : await readCard(cardList().find(record => record.id === cardId));
            if (data.data?.character_book?.entries) return data.data.character_book;
        }
        if (id.startsWith('world:')) {
            const c = context();
            const loader = typeof c.loadWorldInfo === 'function' ? c.loadWorldInfo : (await import(new URL('../../../world-info.js', import.meta.url).href)).loadWorldInfo;
            const data = await loader(id.slice('world:'.length));
            if (data?.entries) return data;
        }
        throw new Error('无法读取所选世界书，请确认它仍存在。');
    }

    const picked = () => book?.entries.find(entry => entry.id === entrySelect.value);
    function previewEntry() {
        const entry = picked();
        const preview = get('ref-entry-preview');
        preview.value = entry?.content || '';
        preview.hidden = !entry;
        for (const id of ['ref-lore-add', 'ref-npc-add']) get(id).hidden = !entry;
    }

    function filterEntries() {
        const words = get('ref-search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const entries = book?.entries || [];
        const matches = entries.filter(entry => {
            const searchText = `${entry.title} ${entry.keys.join(' ')} ${entry.content}`.toLowerCase();
            return words.every(word => searchText.includes(word));
        });
        const selected = entrySelect.value;
        setOptions(entrySelect, '选择条目…', matches.slice(0, 100).map(item => ({ label: item.title, id: item.id })), selected);
        get('ref-book-status').textContent = matches.length > 100
            ? `匹配 ${matches.length} 条，显示前 100 条。可缩小搜索范围。`
            : `匹配 ${matches.length} / ${entries.length} 条`;
        previewEntry();
    }

    async function refreshBook() {
        const run = ++bookRun;
        book = null;
        get('ref-entry-picker').hidden = true;
        const info = get('ref-book-status');
        info.textContent = refs.book ? '正在读取世界书…' : '';
        if (!refs.book) return;
        try {
            const id = refs.book;
            const data = await readBook(id);
            if (run !== bookRun) return;
            book = { id, entries: bookEntries(data) };
            entrySelect.value = '';
            filterEntries();
            get('ref-entry-picker').hidden = false;
        } catch (error) {
            if (run === bookRun) info.textContent = error.message;
        }
    }

    function renderRows() {
        const makeRemove = (label, action) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'pf-button pf-small';
            button.textContent = '移除';
            button.setAttribute('aria-label', label);
            button.addEventListener('click', () => {
                if (isBusy()) return;
                action();
                renderRows();
                save();
            });
            return button;
        };
        const lore = get('ref-lore-list');
        lore.replaceChildren(...refs.lore.map((item, i) => {
            const row = document.createElement('div');
            row.className = 'pf-ref-source';
            const title = document.createElement('span');
            title.textContent = item.label;
            row.append(title, makeRemove(`移除世界参考 ${item.label}`, () => refs.lore.splice(i, 1)));
            return row;
        }));
        get('ref-npc-count').textContent = `${refs.npcs.length}/${MAX_NPCS}`;
        get('ref-npcs').replaceChildren(...refs.npcs.map((item, i) => {
            const row = document.createElement('div');
            row.className = 'pf-ref-row';
            const header = document.createElement('div');
            header.className = 'pf-ref-source';
            const source = document.createElement('span');
            source.textContent = item.source?.label || '手动添加';
            const actions = document.createElement('div');
            actions.className = 'pf-ref-row-actions';
            if (item.source) {
                const detach = document.createElement('button');
                detach.type = 'button';
                detach.className = 'pf-button pf-small';
                detach.textContent = '解除来源';
                detach.title = '保留姓名和关系，停用此人的世界书条目摘录';
                detach.addEventListener('click', () => {
                    if (isBusy()) return;
                    item.source = null;
                    renderRows();
                    save();
                });
                actions.append(detach);
            }
            actions.append(makeRemove(`移除 NPC ${i + 1}`, () => refs.npcs.splice(i, 1)));
            header.append(source, actions);
            row.append(header);
            for (const [key, label, max, placeholder] of [
                ['name', 'NPC 姓名', 120, '姓名或称呼'],
                ['relation', '我与 TA 的关系', 500, '例如：同门师姐，曾帮我隐瞒一次失误'],
            ]) {
                const field = document.createElement('label');
                field.className = 'pf-field';
                const text = document.createElement('span');
                text.textContent = label;
                const input = document.createElement(key === 'name' ? 'input' : 'textarea');
                input.value = item[key];
                input.maxLength = max;
                input.placeholder = placeholder;
                if (key === 'relation') input.rows = 2;
                input.addEventListener('input', () => { item[key] = input.value; save(); });
                field.append(text, input);
                row.append(field);
            }
            return row;
        }));
    }

    function addNpc(source, name = '') {
        if (refs.npcs.length >= MAX_NPCS) throw new Error(`最多填写 ${MAX_NPCS} 位 NPC。`);
        refs.npcs.push({ name, relation: '', source });
        renderRows();
        get('ref-npcs').lastElementChild.querySelector('input').focus();
        save();
    }

    function selectedSource() {
        const entry = picked();
        if (!entry || !book) throw new Error('请先选择一条世界书条目。');
        const name = bookSelect.selectedOptions[0]?.textContent || '';
        return { book: book.id, entry: entry.id, label: `${name} / ${entry.title}`.slice(0, 240) };
    }

    async function refresh() {
        const run = ++listRun;
        const records = cardList();
        setOptions(cardSelect, '选择角色卡…', records.map(({ item, id }) => ({
            label: item.name || item.data.name, id,
        })), refs.card);
        if (refs.card && !cardSelect.value) {
            cardSelect.add(new Option('已选角色卡暂不可用', refs.card));
            cardSelect.value = refs.card;
        }
        get('current-card-option').hidden = Boolean(refs.card);
        const c = context();
        let listError = false;
        try {
            const names = typeof c.getWorldInfoNames === 'function' ? await c.getWorldInfoNames() : (await import(new URL('../../../world-info.js', import.meta.url).href)).world_names;
            if (run !== listRun) return;
            worldNames = [...new Set(list(names).filter(name => typeof name === 'string' && name))];
        } catch {
            if (run !== listRun) return;
            worldNames = [];
            listError = true;
        }
        await refreshCard();
        if (listError && run === listRun && !refs.book) get('ref-book-status').textContent = '未能读取酒馆世界书列表。';
    }

    cardSelect.addEventListener('change', () => {
        refs.card = cardSelect.value;
        refs.greeting = '';
        refs.greetingCard = '';
        if (refs.book.startsWith('embedded:')) refs.book = '';
        get('current-card-option').hidden = Boolean(refs.card);
        save();
        guard(refreshCard);
    });
    get('characterContext').addEventListener('change', () => {
        if (refs.card) return;
        refs.greeting = '';
        refs.greetingCard = '';
        if (refs.book.startsWith('embedded:')) refs.book = '';
        save();
        guard(refreshCard);
    });
    greetingSelect.addEventListener('change', () => {
        refs.greeting = greetingSelect.value;
        refs.greetingCard = refs.greeting ? card?.id || '' : '';
        refreshGreeting();
        save();
    });
    bookSelect.addEventListener('change', () => {
        refs.book = bookSelect.value;
        get('ref-search').value = '';
        save();
        guard(refreshBook);
    });
    get('ref-search').addEventListener('input', filterEntries);
    entrySelect.addEventListener('change', previewEntry);
    get('ref-lore-add').addEventListener('click', () => guard(() => {
        const item = selectedSource();
        if (refs.lore.some(source => source.book === item.book && source.entry === item.entry)) return;
        if (refs.lore.length >= MAX_LORE) throw new Error(`最多选择 ${MAX_LORE} 条世界参考。`);
        refs.lore.push(item);
        renderRows();
        save();
    }));
    get('ref-npc-add').addEventListener('click', () => guard(() => addNpc(selectedSource(), picked().title.slice(0, 120))));
    get('ref-manual').addEventListener('click', () => guard(() => addNpc(null)));
    get('ref-refresh').addEventListener('click', () => guard(refresh));
    get('reference-panel').addEventListener('toggle', () => {
        if (get('reference-panel').open && !isBusy()) guard(refresh);
    });
    renderRows();

    async function getLocal() {
        const record = activeCard();
        const data = record && (card?.id === record.id ? card.data : await readCard(record));
        const greeting = record?.id === refs.greetingCard
            ? cardGreetings(data).find(item => item.id === refs.greeting)
            : null;
        return {
            character: data ? { name: data.data?.name || data.name } : null,
            greeting: greeting ? { label: greeting.label } : null,
            npcs: npcRelationships(refs.npcs),
            profile: data ? profileFor(record, data) : currentProfile(),
        };
    }

    async function collect() {
        const snapshot = normalizeReferences(refs);
        const record = activeCard();
        const data = snapshot.card || (state.form.characterContext && !isGroup(context())) ? await readCard(record) : null;
        const profile = data ? profileFor(record, data) : currentProfile();
        const character = data ? {
            name: data.data?.name || data.name,
            description: data.data?.description || data.description,
            scenario: data.data?.scenario || data.scenario,
            personality: data.data?.personality || data.personality,
        } : null;
        const greeting = record?.id === snapshot.greetingCard && cardGreetings(data).find(item => item.id === snapshot.greeting);
        if (snapshot.greeting && !greeting && (record || snapshot.card)) throw new Error('找不到所选开场白，请重新选择。');
        const npcs = npcRelationships(snapshot.npcs);
        const sources = [...snapshot.lore, ...npcs.map(row => row.source).filter(Boolean)];
        const books = new Map();
        const lore = [];
        for (const item of sources) {
            if (lore.some(entry => entry.book === item.book && entry.entry === item.entry)) continue;
            if (!books.has(item.book)) {
                const info = await readBook(item.book, data ? {id: record.id, data} : null);
                books.set(item.book, bookEntries(info));
            }
            const entry = books.get(item.book).find(entry => entry.id === item.entry);
            if (!entry) throw new Error(`找不到世界书条目「${item.label}」，请移除该参考，或为对应 NPC 解除来源。`);
            lore.push({ ...item, content: entry.content.trim().slice(0, 700) });
        }
        return { character, greeting, npcs, lore, profile };
    }

    return { refresh, collect, getLocal, currentProfile };
}
