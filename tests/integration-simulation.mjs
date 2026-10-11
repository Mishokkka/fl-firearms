import assert from 'node:assert/strict';
const once = new Map(); const on = new Map();
globalThis.Hooks = {
  once(n,f){once.set(n,f)}, on(n,f){if(!on.has(n))on.set(n,[]);on.get(n).push(f)},
  call(){return true}, callAll(){}
};
class AppV2 { constructor(o={}){this.options=o} async _prepareContext(){return{}} async _onRender(){} async _onClose(){} render(){this.rendered=true;return this;} }
function getProperty(o,p){return p.split('.').reduce((a,k)=>a?.[k],o)}
function setProperty(o,p,v){const ks=p.split('.');let c=o;for(const k of ks.slice(0,-1)) c=c[k]??={};c[ks.at(-1)]=v;}
function deepMerge(a,b){for(const [k,v] of Object.entries(b)){if(v&&typeof v==='object'&&!Array.isArray(v)){a[k]??={};deepMerge(a[k],v)}else a[k]=v}return a}
globalThis.foundry={applications:{api:{ApplicationV2:AppV2,HandlebarsApplicationMixin:B=>class extends B{}}},utils:{randomID:()=>Math.random().toString(36).slice(2),getProperty,setProperty,mergeObject:deepMerge}};
const vals=new Map();
const settings={register(s,k,c){if(!vals.has(`${s}.${k}`))vals.set(`${s}.${k}`,c.default)},registerMenu(){},get(s,k){return vals.get(`${s}.${k}`)},async set(s,k,v){vals.set(`${s}.${k}`,v)}};
class ItemCollection { constructor(items=[]){this.contents=items;this.map=new Map(items.map(i=>[i.id,i]));} has(id){return this.map.has(id)} get(id){return this.map.get(id)} filter(fn){return this.contents.filter(fn)} some(fn){return this.contents.some(fn)} [Symbol.iterator](){return this.contents[Symbol.iterator]()} }
const uuidMap=new Map(); globalThis.fromUuidSync=u=>uuidMap.get(u)??null;
class FakeItem { constructor(current){this.id='gun1';this.uuid='Actor.a1.Item.gun1';this.name='Pistol';this.type='weapon';this.system={category:'ranged'};this.flags={'isFirearm':true,'reloadType':'MAG','magCapacity':6,'magCurrent':current,'feat_Upor':true,'feat_kamora':true};this.documentName='Item';this.isOwner=true;} getFlag(_m,k){return this.flags[k]} async setFlag(_m,k,v){this.flags[k]=v;return this} async update(up){for(const [p,v] of Object.entries(up)){const key=p.split('.').at(-1);this.flags[key]=v}return this;} }
let originalRolls=0; let messages=[]; let chatMessageFlagWrites=0;
class FakeMessage { constructor(data){this.id='m'+(messages.length+1);this.uuid='ChatMessage.'+this.id;this.speaker=data.speaker;this.content=data.content;this.rolls=data.rolls??[];this.flags=data.flags??{};this.author={id:'u1'};} getFlag(m,k){return this.flags?.[m]?.[k]} async setFlag(m,k,v){chatMessageFlagWrites++;this.flags[m]??={};this.flags[m][k]=v;return this;} updateSource(update){deepMerge(this,update);} }
async function dispatchCreate(msg){for(const fn of on.get('createChatMessage')??[]) fn(msg,{},'u1'); await new Promise(resolve=>setImmediate(resolve));}
const ChatMessage={
 getSpeaker:({actor}={})=>({actor:actor?.id??'a1'}), getSpeakerActor:s=>actor,
 async create(data){const m=new FakeMessage(data);messages.push(m);await dispatchCreate(m);return m;}
};
globalThis.ChatMessage=ChatMessage;
globalThis.Roll=class {constructor(formula){this.formula=formula;this.total=formula==='1d6'?4:2;this.terms=[]}async evaluate(){return this}};
globalThis.AudioHelper={play(){}};
globalThis.ui={notifications:{warn(){},error(){},info(){}}};
globalThis.$=()=>({length:0}); globalThis.HTMLElement=class{};globalThis.NodeFilter={SHOW_TEXT:4};
globalThis.document={createTreeWalker(){return{nextNode(){return false}}}};
const empty={contents:[],getName(){return null},get(){return null},[Symbol.iterator](){return this.contents[Symbol.iterator]()}};
const tooltipJournals = new Map([
  ['Огнестрел', {name:'Огнестрел', pages:[{name:'Упор', text:{content:'WRONG_JOURNAL'}}]}],
  ['Rich Info Tooltips', {name:'Rich Info Tooltips', pages:[{name:'Упор', text:{content:'UPOR_FROM_INFO'}}]}]
]);
let journalLookups=0;
const journals={contents:[...tooltipJournals.values()],getName(name){journalLookups++;return tooltipJournals.get(name)??null},get(){return null},[Symbol.iterator](){return this.contents[Symbol.iterator]()}};
let embeddedBatchCalls=0;
let item=new FakeItem(0); const actor={id:'a1',uuid:'Actor.a1',name:'Hero',documentName:'Actor',items:new ItemCollection([item]),async updateEmbeddedDocuments(type,updates){assert.equal(type,'Item');embeddedBatchCalls++;for(const update of updates){const target=this.items.get(update._id);for(const [path,value] of Object.entries(update)){if(path==='_id')continue;const key=path.split('.').at(-1);if(key.startsWith('-='))delete target.flags[key.slice(2)];else target.flags[key]=value;}}return updates.map(update=>this.items.get(update._id));}};item.actor=actor;item.parent=actor;uuidMap.set(item.uuid,item);uuidMap.set(actor.uuid,actor);
class Sheet {constructor(){this.actor=actor} async rollGear(itemId){originalRolls++;const data={speaker:{actor:'a1'},content:'<div class="fbl-chat-roll dice-roll"></div>',rolls:[{options:{itemId,isAttack:true}}]};const m=new FakeMessage(data);for(const fn of on.get('preCreateChatMessage')??[]) fn(m,data,{},'u1');messages.push(m);await dispatchCreate(m);return m;} async rollAction(_a,itemId){return this.rollGear(itemId)} }
const moduleRecord={};
globalThis.game={settings,user:{id:'u1',isGM:true},system:{id:'forbidden-lands',title:'Forbidden Lands',version:'13.0.5'},modules:{get:id=>id==='fl-firearms'?moduleRecord:null},items:empty,actors:{contents:[actor],[Symbol.iterator](){return this.contents[Symbol.iterator]()}},tables:empty,journal:journals,playlists:empty};
globalThis.CONFIG={Actor:{sheetClasses:{character:{default:{cls:Sheet}}}}};
globalThis.renderTemplate=async(_p,d)=>`CARD:${d.itemName??''}`;
await import(`file://${process.cwd()}/scripts/main.js?integration=${Date.now()}`);
await once.get('init')(); vals.set('fl-firearms.warnSetupProblems',false); await once.get('ready')();
assert.equal(embeddedBatchCalls,1,'owned item migration should use one embedded-document batch');
assert.equal(item.flags.feat_Kamora,true,'legacy Kamora flag must migrate');
assert.equal(item.flags.feat_kamora,undefined,'legacy Kamora flag must be removed');
let treeWalkerCalls=0; let observerCreates=0; let observerDisconnects=0;
globalThis.document.createTreeWalker=()=>{treeWalkerCalls++;return{currentNode:null,nextNode(){return false}}};
globalThis.MutationObserver=class{constructor(cb){observerCreates++;this.cb=cb}observe(){}disconnect(){observerDisconnects++}takeRecords(){return[]}};
const actorRoot=new HTMLElement(); actorRoot.isConnected=true; actorRoot.querySelector=()=>null; actorRoot.querySelectorAll=()=>[];
const actorApp={document:actor,element:actorRoot};
for(const fn of on.get('renderActorSheet')??[]) fn(actorApp,actorRoot,{});
for(const fn of on.get('renderApplication')??[]) fn(actorApp,actorRoot,{});
await Promise.resolve();
assert.equal(treeWalkerCalls,0,'consumable patch must not walk biography text');
assert.equal(observerCreates,1,'one actor root must have one MutationObserver');
for(const fn of on.get('closeApplication')??[]) fn(actorApp);
assert.equal(observerDisconnects,1,'closing a tracked actor sheet must disconnect its observer');
const tooltipData = moduleRecord.api.getFirearmTooltipData(item);
assert.equal(tooltipData.isFirearm, true, 'legacy tooltip contract must expose isFirearm');
assert.equal(tooltipData.magCapacity, 6, 'legacy tooltip contract must expose magCapacity');
assert.equal(tooltipData.apOp, '*', 'legacy tooltip contract must expose apOp');
assert.ok(Array.isArray(tooltipData.features), 'legacy tooltip contract must expose features');
assert.equal(tooltipData.features.find(feature=>feature.key==='Upor')?.descriptionHtml, 'UPOR_FROM_INFO', 'tooltip lookup must use only Rich Info Tooltips');
moduleRecord.api.getFirearmTooltipData(item);
assert.equal(journalLookups,1,'tooltip journal and pages must be cached after the first lookup');
const sheet=new Sheet();
await sheet.rollGear('gun1');
assert.equal(originalRolls,0,'empty magazine must block original roll');
assert.ok(messages.some(m=>m.getFlag('fl-firearms','emptyMagazineNotice')),'dry-fire message expected');
item.flags.magCurrent=2;messages=[];
await sheet.rollGear('gun1');
assert.equal(originalRolls,1,'loaded weapon must call original roll');
assert.equal(item.flags.magCurrent,1,'one cartridge must be spent');
const attack=messages.find(m=>m.getFlag('fl-firearms','isFirearmAttack'));
assert.ok(attack,'attack context must attach');
assert.equal(attack.getFlag('fl-firearms','emptyMagazineAttack'),false,'loaded magazine is not an empty attack');
assert.equal(chatMessageFlagWrites,0,'ordinary shot must not persist internal dedupe flags to ChatMessage');
await dispatchCreate(attack);
assert.equal(item.flags.magCurrent,1,'duplicate create hook dispatch must not spend ammo twice');
assert.equal(chatMessageFlagWrites,0,'duplicate create hook dispatch must remain local-only');
console.log('FL Firearms integration simulation: OK');
