import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FORM, THEMES, makeTemplate, parseModelResult, buildPrompt, normalizePersona, parseImport, toNativeBackup, safeFilename, requestGeneration } from '../core.js';

test('all local templates produce usable native persona backups without changing default persona', () => {
    for (const theme of Object.keys(THEMES)) {
        const p = makeTemplate({ ...DEFAULT_FORM, theme, name: '林澈' });
        const backup = toNativeBackup(p);
        assert.deepEqual(parseImport(JSON.stringify(backup)), [p]);
        assert.equal(Object.hasOwn(backup, 'default_persona'), false);
        assert.match(p.description, /\{\{user\}\}/);
        assert.match(p.description, /\{\{char\}\}/);
        const descriptor = Object.values(backup.persona_descriptions)[0];
        assert.equal(descriptor.position, 0);
    }
});
test('model output handles reasoning, JSON fences and braces in strings', () => {
    const p = { name: 'A', title: 'B', description: 'Uses {{user}}, a "quote", and {braces}.\nNext line.' };
    assert.deepEqual(parseModelResult(`<think>do not expose</think>\n\`\`\`json\n${JSON.stringify(p)}\n\`\`\``), p);
    assert.deepEqual(parseModelResult(`Here is the result: ${JSON.stringify(p)} done`), p);
});
test('plain descriptions retain macro syntax and incomplete structured output is rejected', () => {
    assert.equal(parseModelResult('{{user}} is an investigator.', 'A').description, '{{user}} is an investigator.');
    assert.throws(() => parseModelResult('{"name":"A","description":"truncated'), /不完整/);
    assert.throws(() => parseModelResult('{"name":"A","description":{}}'), /无效/);
    assert.throws(() => parseModelResult('<think>reason</think>'), /没有返回/);
});
test('bad imports and empty required fields fail without returning partial personas', () => {
    assert.throws(() => parseImport('{"name":"A","description":17}'));
    assert.throws(() => normalizePersona({ name: '', description: 'x' }));
    assert.throws(() => parseImport('{"personas":{"x":"A","y":"B"},"persona_descriptions":{"x":{"description":"ok"}}}'));
    assert.throws(() => toNativeBackup({ name: 'A', description: 'x' }, '../bad.png'));
});
test('character references are opt-in and prose remains data in the prompt', () => {
    const p = buildPrompt({ ...DEFAULT_FORM, name: 'A', keywords: 'keep this' });
    assert.match(p, /keep this/); assert.doesNotMatch(p, /SECRET CHARACTER/);
    const referenced = buildPrompt(DEFAULT_FORM, null, { name: 'SECRET CHARACTER', description: '<script>alert(1)</script>' });
    assert.match(referenced, /SECRET CHARACTER/);
    assert.equal(safeFilename('../a/b:*'), '.._a_b__');
});
test('generation adapter supports current object APIs', async () => {
    let received;
    await requestGeneration({ generateRaw: async (options = {}) => { received = options; return 'ok'; } }, 'raw', 'prompt', 900);
    assert.equal(received.prompt, 'prompt'); assert.equal(received.responseLength, 900); assert.equal(received.trimNames, false);
    await requestGeneration({ generateQuietPrompt: async (options = {}) => { received = options; } }, 'chat', 'quiet', 1800);
    assert.equal(received.quietPrompt, 'quiet');
});
test('generation adapter supports positional APIs without losing prompt or length', async () => {
    let received;
    await requestGeneration({ generateRaw: async function (prompt, api, instruct, loud, system, length, trim) { received = [...arguments]; } }, 'raw', 'old prompt', 900);
    assert.equal(received[0], 'old prompt'); assert.equal(received[5], 900); assert.equal(received[6], false);
    await requestGeneration({ generateQuietPrompt: async function (prompt, loud, skip, image, name, length) { received = [...arguments]; } }, 'chat', 'old quiet', 1800);
    assert.equal(received[0], 'old quiet'); assert.equal(received[5], 1800);
});
