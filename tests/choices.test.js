import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, GENDERS, DEFAULT_FORM, getGender, makeTemplate, buildPrompt } from '../core.js';

test('expanded world catalogue offers at least sixty-four distinct usable templates', () => {
    const labels = Object.values(THEMES).map(theme => theme[0]);
    assert.ok(labels.length >= 64);
    assert.equal(new Set(labels).size, labels.length);
    for (const [theme, data] of Object.entries(THEMES)) {
        const persona = makeTemplate({ ...DEFAULT_FORM, theme, gender: '女' });
        assert.ok(persona.description.includes(data[0]));
        assert.ok(persona.description.includes(data[4]));
        assert.match(persona.description, /性别：女/);
        assert.doesNotMatch(persona.description, /称谓/);
    }
});

test('gender choices and custom values consistently reach templates and generation requests', () => {
    for (const gender of GENDERS) {
        const form = { ...DEFAULT_FORM, gender, genderCustom: '流体性别' };
        const expected = gender === '自定义' ? '流体性别' : gender;
        assert.equal(getGender(form), expected);
        assert.ok(makeTemplate(form).description.includes(`性别：${expected}`));
        assert.ok(buildPrompt(form).includes(`"性别": "${expected}"`));
        assert.doesNotMatch(buildPrompt(form), /称谓/);
    }
    assert.equal(getGender({ gender: '自定义', genderCustom: '  ' }), '自由设定');
    assert.equal(getGender({ gender: '旧版自填内容' }), '旧版自填内容');
});
