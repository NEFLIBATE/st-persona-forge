import test from 'node:test';
import assert from 'node:assert/strict';
import { DETAIL_GROUPS, DETAIL_FIELDS, DEFAULT_FORM, getDetails, makeTemplate, buildPrompt, toNativeBackup, parseImport } from '../core.js';

test('all optional facts survive the generated dossier and native export round trip', () => {
    assert.equal(DETAIL_GROUPS.length, 5);
    assert.equal(DETAIL_FIELDS.length, 25);
    assert.equal(new Set(DETAIL_FIELDS.map(([key]) => key)).size, DETAIL_FIELDS.length);
    const details = Object.fromEntries(DETAIL_FIELDS.map(([key]) => [key, `Fact-${key} {{user}}` ]));
    const persona = makeTemplate({ ...DEFAULT_FORM, name: '林澈', details });
    for (const value of Object.values(details)) assert.ok(persona.description.includes(value));
    assert.deepEqual(parseImport(JSON.stringify(toNativeBackup(persona))), [persona]);
    assert.doesNotMatch(persona.description, /undefined|\[object Object\]/);
});

test('generation includes user detail values as data, without unfilled placeholders', () => {
    const details = { features: '灰瞳，左眉有疤', secret: '一封写着"旧友"的信\n尚未寄出', skills: '   ', unknown: 'UNSUPPORTED FIELD' };
    const form = { ...DEFAULT_FORM, details, length: 'dossier' };
    const prompt = buildPrompt(form);
    assert.ok(prompt.includes(JSON.stringify(details.features)));
    assert.ok(prompt.includes(JSON.stringify(details.secret)));
    assert.match(prompt, /约1800至2200字/);
    assert.match(prompt, /以本次要求为准/);
    assert.doesNotMatch(prompt, /UNSUPPORTED FIELD|例如：|"技能与擅长领域"/);
});

test('old forms and malformed optional detail collections remain usable', () => {
    for (const details of [undefined, null, [], 'not an object']) {
        assert.deepEqual(getDetails({ details }), {});
        assert.ok(makeTemplate({ ...DEFAULT_FORM, details }).description.length > 200);
    }
    const form = { details: { features: '  原样保留  ', secret: 'x'.repeat(1100) } };
    assert.deepEqual(getDetails(form), { features: '原样保留', secret: 'x'.repeat(1000) });
    assert.equal(form.details.features, '  原样保留  ');
    assert.deepEqual(DEFAULT_FORM.details, {});
});
