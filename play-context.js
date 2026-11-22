export const CARD_TYPES = Object.freeze({ world: '大世界', multi: '多角色', single: '单一角色' });
const CHAT_LIMITS = [8, 16, 32];
const CHAT_BUDGET = 12000;
const MESSAGE_LIMIT = 1500;
const trimText = value => typeof value === 'string' ? value.trim() : '';
const knownType = value => Object.hasOwn(CARD_TYPES, value);

export function detectCardType(card, isGroup = false) {
    if (isGroup) return { kind: 'multi', reason: '当前是酒馆群聊' };
    if (!card) return { kind: 'unknown', reason: '尚无可判断的角色卡' };
    const data = card.data || {};
    const tags = [data.tags, card.tags].flatMap(items => Array.isArray(items) ? items : []);
    const labels = [data.name, card.name, ...tags].map(trimText).filter(Boolean);
    const labelRules = [
        ['world', /^(?:大世界(?:卡|模拟器)?|世界模拟器|开放世界(?:卡|模拟器)?|world[ -]simulator|open[ -]world|sandbox)$/iu],
        ['multi', /^(?:多角色(?:卡|扮演)?|群像(?:卡)?|multi[ -]char(?:acter)?s?|ensemble(?: cast)?)$/iu],
        ['single', /^(?:单一角色(?:卡)?|单角色(?:卡)?|single[ -]character)$/iu],
    ];
    const declared = labelRules.filter(([, pattern]) => labels.some(label => pattern.test(label)));
    if (declared.length > 1) return { kind: 'unknown', reason: '角色卡标签给出多个类型' };

    if (card.shallow && !declared.length) return { kind: 'unknown', reason: '等待读取完整角色卡' };

    const parts = [data.description || card.description, data.scenario || card.scenario,
        data.system_prompt, data.creator_notes, data.first_mes || card.first_mes];
    const profile = parts.map(value => trimText(value).slice(0, 12000)).join('\n');
    const world = /(?:世界模拟器|世界引擎|世界主持人|世界叙事者|模拟整个世界|扮演整个世界|主持整个世界|扮演世界和所有NPC|simulate the (?:entire )?world|(?:you are|act as) (?:the |a )?(?:world simulator|world engine|game master)|you (?:run|narrate) the (?:entire )?world)/iu.test(profile)
        || /(?:自由探索|开放世界|free(?:ly)? explor|open.world)/iu.test(profile)
            && /(?:势力|阵营|地图|地区|派系|factions?|regions?)/iu.test(profile)
            && /(?:主持|模拟|玩家|旁白|narrat|simulat|game master)/iu.test(profile);
    const multi = /(?:扮演|饰演|控制|分别描写)(?:卡内|故事中|以下|场景中)?\s*(?:多个|多名|所有|每位|不同的|每个)\s*(?:角色|人物|NPC)|(?:portray|play|roleplay as|write for|control)\s+(?:all|several|multiple|different)\s+(?:the\s+)?(?:characters|NPCs)/iu.test(profile)
        || /(?:^|\n)\s*(?:#{1,6}\s*)?[【[]?(?:人物名册|角色列表|主要角色|登场人物|cast(?: of characters)?|character roster)[】\]]?\s*[:：]?\s*(?:\r?\n|$)/imu.test(profile)
        || (profile.match(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:角色|人物)\s*[一二三四五六七八九十\d]+\s*[:：]/gu) || []).length >= 2;
    if (declared.length === 1) {
        const [kind] = declared[0];
        if ((kind === 'single' && (world || multi)) || (kind === 'multi' && world)) {
            return { kind: 'unknown', reason: '角色卡标签与扮演说明存在不同线索' };
        }
        return { kind, reason: '根据角色卡名称或类型标签' };
    }
    if (world) return { kind: 'world', reason: '卡片包含世界主持、模拟或自由探索的线索' };
    if (multi) return { kind: 'multi', reason: '卡片包含角色名册或多人扮演说明' };
    if (trimText(data.description || card.description).length >= 12) {
        return { kind: 'single', reason: '以人物描述为主，暂按单一角色处理' };
    }
    return { kind: 'unknown', reason: '卡片资料较少，建议手动指定' };
}

export function normalizeCardTypeOverride(value) {
    if (!knownType(value?.kind) || typeof value?.source !== 'string') return null;
    return { kind: value.kind, source: value.source.slice(0, 520) };
}

export function appliedCardType(profile, override) {
    if (override?.source === profile.source && knownType(override.kind)) return override.kind;
    return profile.kind;
}

function removeThoughts(text) {
    return text.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/giu, '').trim();
}

export function recentChatMessages(chat, limit = 16) {
    const max = CHAT_LIMITS.includes(limit) ? limit : 16;
    if (!Array.isArray(chat)) return [];
    const recent = [];
    let remaining = CHAT_BUDGET;
    for (let i = chat.length - 1; i >= 0 && recent.length < max && remaining > 150; i--) {
        const message = chat[i];
        if (!message || message.is_system || message.extra?.type === 'tool_call' || message.extra?.tool_invocations?.length) continue;
        const visible = removeThoughts(trimText(message.mes));
        if (!visible) continue;
        const role = message.is_user ? '玩家' : '角色';
        const name = trimText(message.name).slice(0, 100) || role;
        const room = Math.min(MESSAGE_LIMIT, remaining - name.length - 25);
        const content = visible.length > room ? `…${visible.slice(-(room - 1))}` : visible;
        recent.unshift({ role, name, content });
        remaining -= content.length + name.length + 25;
    }
    return recent;
}

export function chatKey(context) {
    const id = context.getCurrentChatId?.() ?? context.chatId;
    return id == null || id === '' ? context.chat : JSON.stringify([context.groupId ?? null, context.characterId ?? null, id]);
}

export function playContextPanel() {
    return `<section class="pf-play-context">
        <label class="pf-field"><span>角色卡类型</span><select id="pf-card-type"><option value="auto">自动判断</option>${Object.entries(CARD_TYPES).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
        <p class="pf-muted" id="pf-card-type-status" role="status"></p>
        <details class="pf-details" id="pf-chat-panel">
            <summary>预览当前聊天</summary>
            <div class="pf-grid">
                <label class="pf-field"><span>最近消息</span><select id="pf-chat-count"><option value="8">最近 8 条</option><option value="16" selected>最近 16 条</option><option value="32">最近 32 条</option></select></label>
                <button class="pf-button" type="button" id="pf-chat-refresh">刷新聊天</button>
            </div>
            <p class="pf-muted" id="pf-chat-status" role="status"></p>
            <textarea id="pf-chat-preview" class="pf-ref-preview" rows="7" readonly aria-label="当前聊天预览"></textarea>
            <label class="pf-check" id="pf-chat-include-field"><input id="pf-chat-include" type="checkbox">将这段聊天用于本次会话的独立 AI 生成</label>
            <p class="pf-muted" id="pf-chat-mode-help"></p>
        </details>
    </section>`;
}

export function mountPlayContext({ get, context, state, save, isOpen, readType }) {
    const type = get('card-type');
    const preview = get('chat-preview');
    const panel = get('chat-panel');
    const count = get('chat-count');
    const include = get('chat-include');
    let allowedChat = null;

    function refreshType() {
        const profile = readType();
        const applied = appliedCardType(profile, state.cardTypeOverride);
        const manual = state.cardTypeOverride?.source === profile.source;
        type.value = manual ? applied : 'auto';
        const relationLabel = { world: '在世界中的身份与联系', multi: '在群像中的位置' };
        get('relation').previousElementSibling.textContent = relationLabel[applied] || '与对方角色的关系';
        get('npc-relation-hint').textContent = relationLabel[applied]
            ? '请在这里按姓名分别填写关系，上方关系栏可写你在世界或群像中的总体位置。'
            : '姓名和关系都填好后才会写入设定。上方关系栏对应主角色。';
        const detected = CARD_TYPES[profile.kind] || '待确认';
        const summary = manual ? `已指定：${CARD_TYPES[applied]} · 自动判断：${detected}` : `自动判断：${detected}`;
        get('card-type-status').textContent = `${summary} · ${profile.reason}${profile.name ? `（${profile.name}）` : ''}`;
    }

    function refreshChat() {
        const c = context();
        const key = chatKey(c);
        const messages = recentChatMessages(c.chat, Number(count.value));
        if (allowedChat !== key || !messages.length) allowedChat = null;
        const quietMode = state.form.mode === 'chat';
        include.checked = !quietMode && allowedChat !== null;
        get('chat-include-field').hidden = quietMode || !messages.length;
        get('chat-mode-help').textContent = quietMode
            ? '已选「沿用聊天与预设」。酒馆按当前上下文设置发送聊天。上方预览条数只用于查看。'
            : '勾选后，独立生成会把预览中的消息摘录交给当前模型。切换聊天后需重新勾选。';
        preview.hidden = !messages.length;
        preview.value = messages.map(({role, name, content}) => `${name} · ${role}\n${content}`).join('\n\n');
        get('chat-status').textContent = messages.length ? `当前聊天 · 已读取 ${messages.length} 条消息` : '当前没有可读取的聊天消息。';
        return messages;
    }

    type.addEventListener('change', () => {
        const {source} = readType();
        if (type.value === 'auto') {
            if (state.cardTypeOverride?.source === source) state.cardTypeOverride = null;
        } else {
            state.cardTypeOverride = { source, kind: type.value };
        }
        refreshType();
        save();
    });
    include.addEventListener('change', () => {
        allowedChat = include.checked ? chatKey(context()) : null;
        refreshChat();
    });
    count.addEventListener('change', refreshChat);
    panel.addEventListener('toggle', () => { if (panel.open) refreshChat(); });
    get('chat-refresh').addEventListener('click', refreshChat);
    get('mode').addEventListener('change', () => {
        allowedChat = null;
        if (panel.open) refreshChat();
    });
    const {eventSource, eventTypes, event_types} = context();
    const events = eventTypes || event_types;
    if (events && eventSource?.on) {
        for (const name of ['CHAT_CHANGED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED']) {
            if (!events[name]) continue;
            eventSource.on(events[name], () => {
                if (name === 'CHAT_CHANGED') {
                    allowedChat = null;
                    preview.value = '';
                    include.checked = false;
                    if (isOpen()) refreshType();
                }
                if (isOpen() && panel.open) refreshChat();
            });
        }
    }
    return {
        refreshType,
        onOpen() {
            refreshType();
            if (panel.open) refreshChat();
        },
        onClose() { preview.value = ''; },
        messagesForGeneration() {
            const c = context();
            if (state.form.mode !== 'raw' || allowedChat === null || allowedChat !== chatKey(c)) return [];
            return recentChatMessages(c.chat, Number(count.value));
        },
    };
}
