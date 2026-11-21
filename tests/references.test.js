import test from 'node:test';
import assert from 'node:assert/strict';
import { cardGreetings, bookEntries, normalizeReferences } from '../references.js';
import { DEFAULT_FORM, makeTemplate, buildPrompt, parseImport, toNativeBackup } from '../core.js';

test('read V1, V2, and V3 greetings without mixing alternate and group indices', () => {
    const result = cardGreetings({
        first_mes: 'legacy',
        data: {first_mes: 'main', alternate_greetings: ['', 'second'], group_only_greetings: ['group']},
    });
    assert.deepEqual(result.map(({id, content}) => [id, content]), [['main', 'main'], ['alt:1', 'second'], ['group:0', 'group']]);
    assert.deepEqual(cardGreetings({first_mes: 'legacy'}).map(item => item.content), ['legacy']);
});

test('embedded and native book entries retain source ids and labels', () => {
    const embedded = bookEntries({entries: [{id: 7, keys: ['阿芷'], content: '正文'}, {id: 9, content: ''}]});
    assert.deepEqual(embedded, [{id: '7', title: '阿芷', keys: ['阿芷'], content: '正文'}]);
    const native = bookEntries({entries: {42: {uid: 42, key: ['走廊'], comment: '药铺', content: '条目正文'}}});
    assert.equal(native[0].id, '42');
    assert.equal(native[0].title, '药铺');
});

test('separate NPC relationships survive template and native backup while reference excerpts stay out', () => {
    const source = {book: 'world:青岚城', entry: '7', label: '青岚城 / 药铺'};
    const npcs = [
        {name: '柳掌柜', relation: '药材供货人', source},
        {name: '阿芷', relation: '从小认识的邻居', source},
        {name: '未填完', relation: ''},
    ];
    const character = {name: '云霁', description: 'CARD_PROSE'};
    const greeting = {label: '备选开场白 2', content: 'GREETING_PROSE'};
    const refs = {character, greeting, npcs, lore: [{...source, content: 'BOOK_PROSE'}]};
    const result = makeTemplate({...DEFAULT_FORM, relation: '同行者'}, refs);
    const [restored] = parseImport(JSON.stringify(toNativeBackup(result)));
    assert.match(restored.description,/与\{\{char\}\}（云霁）的关系：同行者/);
    assert.match(restored.description,/柳掌柜：药材供货人\n与阿芷：从小认识的邻居/);
    assert.doesNotMatch(restored.description,/未填完|CARD_PROSE|GREETING_PROSE|BOOK_PROSE/);
    const prompt = buildPrompt(DEFAULT_FORM, null, character, refs);
    for (const fact of ['CARD_PROSE','GREETING_PROSE','BOOK_PROSE','柳掌柜','阿芷']) assert.ok(prompt.includes(fact));
    assert.doesNotMatch(prompt,/未填完/);
    assert.ok(!('content' in normalizeReferences({lore: refs.lore}).lore[0]));
});
