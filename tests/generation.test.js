import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FORM, parseGenerationResult, buildPrompt, getGenerationBudget } from '../core.js';

test('generation accepts marker blocks with ordinary paragraphs and no closing wrapper', () => {
    const parsed = parseGenerationResult('[PERSONA_NAME]\n林澈\n[PERSONA_TITLE]\n旧友\n[PERSONA_DESCRIPTION]\n第一段。\n\n他说："你好"。{{user}}带着旧笔记。');
    assert.deepEqual(parsed.persona, { name: '林澈', title: '旧友', description: '第一段。\n\n他说："你好"。{{user}}带着旧笔记。' });
    assert.equal(parsed.recovered, false);
    assert.equal(parsed.partial, false);
    const prompt = buildPrompt(DEFAULT_FORM);
    assert.match(prompt, /\[PERSONA_DESCRIPTION\]/);
    assert.doesNotMatch(prompt, /只输出一个JSON对象/);
});

test('complete legacy JSON remains supported, including macros and escaped text', () => {
    const persona = { name: 'A', title: 'B', description: 'Text {{user}} {braces} "quotes"\nnext line' };
    const parsed = parseGenerationResult(`\`\`\`json\n${JSON.stringify(persona)}\n\`\`\``);
    assert.deepEqual(parsed.persona, persona);
    assert.equal(parsed.warning, '');
});

test('recover readable text from truncated JSON without inventing a missing ending', () => {
    const raw = '{"name":"A","title":"draft","description":"第一行\\n末尾尚未';
    const parsed = parseGenerationResult(raw);
    assert.equal(parsed.persona.description, '第一行\n末尾尚未');
    assert.equal(parsed.partial, true);
    assert.equal(parsed.recovered, true);
    assert.match(parsed.warning, /可能被截断/);
    assert.equal(raw.endsWith('尚未'), true);
});

test('recover actual newlines, unescaped prose quotes, missing outer braces and trailing commas', () => {
    for (const raw of [
        '{"name":"A","description":"第一行\n第二行"}',
        '{"name":"A","description":"他说："你好"。"}',
        '{"name":"A","description":"完整正文"',
        '{"name":"A","description":"完整正文",}',
    ]) {
        const parsed = parseGenerationResult(raw);
        assert.ok(parsed.persona.description.length > 0);
        assert.equal(parsed.partial, false);
        assert.match(parsed.warning, /格式不规范/);
        assert.ok(!parsed.persona.description.endsWith('}'));
    }
    assert.equal(parseGenerationResult('{"name":"A","description":"第一行\n第二行"}').persona.description, '第一行\n第二行');
    assert.equal(parseGenerationResult('{"name":"A","description":"他说："你好"。"}').persona.description, '他说："你好"。');
});

test('recovery decodes escaped Unicode and backslashes and ignores incomplete escape tails', () => {
    const parsed = parseGenerationResult('{"name":"A","description":"\\u4f60\\u597d\\n路径C:\\\\books\\u12');
    assert.equal(parsed.persona.description, '你好\n路径C:\\books');
    assert.equal(parsed.partial, true);
    const quotedObject = parseGenerationResult('{"name":"A","description":"第一行\n示例 {"name":"inside"} 仍是正文"}');
    assert.equal(quotedObject.persona.description, '第一行\n示例 {"name":"inside"} 仍是正文');
});

test('empty and non-text bodies are rejected while plain prose and missing names are usable', () => {
    for (const raw of ['', '{}', '{"name":"A"}', '{"name":"A","description":{}}', '{"description":17}', '[PERSONA_NAME]\nA', '[PERSONA_DESCRIPTION]\n', '<think>unfinished reasoning']) {
        assert.throws(() => parseGenerationResult(raw));
    }
    assert.equal(parseGenerationResult('普通设定正文。', '表单姓名').persona.name, '表单姓名');
    assert.equal(parseGenerationResult('[PERSONA_NAME]\n[PERSONA_TITLE]\n标签\n[PERSONA_DESCRIPTION]\n正文', '表单姓名').persona.name, '表单姓名');
    assert.equal(parseGenerationResult('{"description":"可以恢复的正文"}', '表单姓名').persona.name, '表单姓名');
});

test('each length has a positive budget and larger dossiers receive more output room', () => {
    const budgets = ['short', 'standard', 'detailed', 'dossier', 'ultra'].map(getGenerationBudget);
    assert.ok(budgets.every(value => Number.isInteger(value) && value > 0));
    assert.ok(budgets.every((value, index) => index === 0 || value > budgets[index - 1]));
    assert.equal(getGenerationBudget('unknown'), getGenerationBudget('standard'));
});
