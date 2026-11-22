import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCardType, appliedCardType, normalizeCardTypeOverride, recentChatMessages, chatKey } from '../play-context.js';
import { buildPrompt, DEFAULT_FORM, makeTemplate } from '../core.js';

test('detect explicit world, ensemble and person cards without counting lore or alternate greetings as a cast', () => {
    assert.equal(detectCardType({data:{description:'你是世界主持人，模拟整个世界，包含多个阵营。'}}).kind, 'world');
    assert.equal(detectCardType({data:{description:'你将扮演多个角色\n角色一：白榆\n角色二：云霁'}}).kind, 'multi');
    assert.equal(detectCardType({description:'Cast of characters:\n- Clara, a bookkeeper\n- Robin, a tutor'}).kind, 'multi');
    assert.equal(detectCardType({data:{
        description:'云霁是善于辨认古代手稿的图书馆管理员。',
        character_book:{entries:Array.from({length:50})},
        alternate_greetings:['第一幕','第二幕'],
    }}).kind, 'single');
    assert.equal(detectCardType({data:{tags:['单角色'], description:'扮演多个NPC'} }).kind, 'unknown');
    assert.equal(detectCardType({name:'青岚',shallow:true,description:'截断的角色说明可能会让我们误以为这只是单人卡'}).kind, 'unknown');
    assert.equal(detectCardType(null).kind, 'unknown');
    assert.equal(detectCardType(null,true).kind, 'multi');
});

test('manual selection only applies to the card or group it was selected for', () => {
    const override = normalizeCardTypeOverride({source:'avatar:world.png',kind:'multi'});
    assert.equal(appliedCardType({source:'avatar:world.png',kind:'world'},override),'multi');
    assert.equal(appliedCardType({source:'avatar:writer.png',kind:'single'},override),'single');
    assert.equal(normalizeCardTypeOverride({source:'',kind:'invalid'}),null);
    assert.notEqual(chatKey({groupId:1,chatId:'same'}),chatKey({groupId:2,chatId:'same'}));
});

test('recent excerpts retain speaker order, skip hidden messages and obey the total budget', () => {
    const chat = [{name:'book',mes:'old'}];
    for(let i=0;i<10;i++) chat.push({name:'云霁',mes:`<think>内部推理</think>${i}`});
    chat.push({mes:'系统指令',is_system:true},{name:'玩家',mes:'调查地图',is_user:true,extra:{reasoning:'隐藏字段'}});
    const recent = recentChatMessages(chat,8);
    assert.equal(recent.length,8);
    assert.deepEqual(recent[0],{role:'角色',name:'云霁',content:'3'});
    assert.deepEqual(recent.at(-1),{role:'玩家',name:'玩家',content:'调查地图'});
    assert.doesNotMatch(JSON.stringify(recent),/内部推理|系统指令|隐藏字段/);
    const longChat = recentChatMessages(Array.from({length:32},()=>({name:'松月',mes:`${'长'.repeat(6000)}尾`})),32);
    assert.ok(longChat.reduce((sum,row)=>sum+row.content.length,0) <= 12000);
    assert.ok(longChat.every(row=>row.content.startsWith('…') && row.content.endsWith('尾')));
});

test('world rules and chat enter the prompt, while the template separates the cast from the narrator', () => {
    const refs = {cardType:'world', chat:[{role:'角色',name:'松月',content:'见过旧地图 {{user}}'}]};
    const prompt = buildPrompt(DEFAULT_FORM,null,null,refs);
    assert.match(prompt,/大世界：围绕玩家/);
    assert.match(prompt,/当前聊天摘录/);
    assert.match(prompt,/见过旧地图/);
    assert.match(prompt,/见过旧地图 \\u007b\\u007buser/);
    const persona = makeTemplate(DEFAULT_FORM,{...refs,npcs:[{name:'松月',relation:'旅伴'}]});
    assert.match(persona.description,/在世界中的身份与联系/);
    assert.match(persona.description,/与松月：旅伴/);
    assert.doesNotMatch(persona.description,/与\{\{char\}\}的关系|见过旧地图/);
});
