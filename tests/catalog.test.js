import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, WORLD_GROUPS, CHOICE_GROUPS, getChoiceOptions, toggleTrait } from '../catalog.js';
import { DEFAULT_FORM, getTheme, makeTemplate, buildPrompt } from '../core.js';

test('world categories cover 64 distinct themes plus a custom world with usable templates', () => {
    const keys = WORLD_GROUPS.flatMap(group => group.themes);
    assert.equal(keys.length, 64);
    assert.equal(new Set(keys).size, 64);
    assert.deepEqual([...keys, 'custom'].sort(), Object.keys(THEMES).sort());
    const form = {...DEFAULT_FORM, theme: 'custom', themeCustom: '海底古城 × 蒸汽机械'};
    assert.equal(getTheme(form)[0], form.themeCustom);
    assert.ok(makeTemplate(form).description.includes(form.themeCustom));
    assert.ok(buildPrompt(form).includes(form.themeCustom));
    assert.equal(getTheme({...form, themeCustom:''})[0], THEMES.custom[0]);
});

test('catalogues contain distinct meaningful identity, trait and relationship options', () => {
    for (const [kind, count] of [['identity',192],['traits',120],['relation',120]]) {
        const options = getChoiceOptions(kind);
        assert.equal(options.length,count);
        assert.equal(new Set(options.map(option => option.value)).size,count);
        assert.ok(options.every(option => option.value.trim().length > 1 && option.group && option.groupId));
        const groupIds = CHOICE_GROUPS[kind].map(group => group.id);
        assert.equal(new Set(groupIds).size,groupIds.length);
        for (const group of CHOICE_GROUPS[kind]) assert.equal(getChoiceOptions(kind,{category:group.id}).length,group.items.length);
    }
});

test('recommendations follow theme family and search/category filtering does not mutate choices', () => {
    const before = JSON.stringify(CHOICE_GROUPS);
    const modern = getChoiceOptions('identity',{theme:'modern',category:'recommended'}).map(option=>option.value);
    const space = getChoiceOptions('identity',{theme:'space',category:'recommended'}).map(option=>option.value);
    assert.ok(modern.includes('咖啡师'));
    assert.ok(!modern.includes('飞船领航员'));
    assert.ok(space.includes('飞船领航员'));
    assert.ok(!space.includes('咖啡师'));
    assert.equal(getChoiceOptions('identity',{theme:'custom',category:'recommended'}).length,192);
    assert.ok(getChoiceOptions('identity',{query:'星际 领航'}).some(option=>option.value==='飞船领航员'));
    assert.equal(getChoiceOptions('traits',{query:'does-not-exist'}).length,0);
    assert.deepEqual(getChoiceOptions('unknown'),[]);
    assert.equal(JSON.stringify(CHOICE_GROUPS),before);
});

test('trait toggles preserve custom terms, remove duplicates and refuse overflow without mutation', () => {
    const custom = '自定义气质，慢热;慢热';
    assert.equal(toggleTrait(custom,'温和'),'自定义气质、慢热、温和');
    assert.equal(toggleTrait(custom,'慢热'),'自定义气质');
    assert.equal(toggleTrait('温和、慢热','温和'),'慢热');
    assert.throws(()=>toggleTrait('a'.repeat(500),'慢热'),/最多500/);
    assert.equal(toggleTrait('','温和'),'温和');
});
