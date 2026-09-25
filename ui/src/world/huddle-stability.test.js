import test from 'node:test';
import assert from 'node:assert/strict';

import { CallController } from '../lib/call-controller.js';
import { createMovement, PEER_GRACE_MS } from '../lib/movement.js';
import { HUDDLE_FORM_MS, HUDDLE_JOIN_MS, HUDDLE_LEAVE_MS } from '../lib/huddle.js';

test('huddle timing filters passers-by and gives established calls a leave grace', () => {
  assert.equal(HUDDLE_FORM_MS, 3000);
  assert.equal(HUDDLE_JOIN_MS, 2000);
  assert.equal(HUDDLE_LEAVE_MS, 5000);
  assert.ok(HUDDLE_LEAVE_MS > HUDDLE_FORM_MS);
});

test('a preserved call is not closed before the replacement grant arrives', () => {
  const sent=[];
  const sfu={closed:0,connected:[],close(){this.closed++;},connect(g){this.connected.push(g);}};
  const controller=new CallController({our:'~zod',sfu,accepts:()=>true,changed:()=>{},
    transport:{send:(who,event)=>sent.push({who,event}),operation:()=>{}},fresh:(()=>{let n=10;return()=>++n;})()});
  controller.select({place:1001,host:'~nec'});
  controller.phase='connected';
  const closed=sfu.closed;
  controller.select({place:1002,host:'~bud'},{preserve:true});
  assert.equal(sfu.closed,closed);
  assert.equal(controller.phase,'transitioning');
  assert.equal(controller.current.previous.place,1001);
  const attempt=controller.current.attempt;
  controller.result('call-granted',{context:`1002/~zod/${attempt}`,participant:'~zod',
    group:'next',sfu:'wss://example.test',token:'opaque',expires:Date.now()+60000,gen:1});
  assert.equal(sfu.connected.length,1);
  assert.equal(controller.current.previous,null);
  assert.ok(sent.some(({who,event})=>who==='~nec' && event.kind==='call-leave' && event.place===1001));
  controller.close();
});

test('a refused replacement falls back to the still-live call', () => {
  const sfu={close(){},connect(){}};
  const controller=new CallController({our:'~zod',sfu,accepts:()=>true,changed:()=>{},
    transport:{send:()=>{},operation:()=>{}},fresh:(()=>{let n=20;return()=>++n;})()});
  controller.select({place:1001,host:'~nec'});
  controller.phase='connected';
  controller.select({place:1002,host:'~bud'},{preserve:true});
  const attempt=controller.current.attempt;
  controller.result('call-failed',{context:`1002/~zod/${attempt}`,who:'~zod',err:'unauthorized'});
  assert.equal(controller.current.place,1001);
  assert.equal(controller.current.host,'~nec');
  assert.equal(controller.phase,'connected');
  controller.close();
});

test('movement confidence never mistakes an old moving packet for a current position', () => {
  let clock=1000,onPosition;
  const relay={live:()=>true,has:()=>true,state:()=> 'live',ships:()=>[],route(){},send(){},close(){},
    expires:()=>clock+60000,group:()=>null,stats:()=>({}),delivering:()=>true};
  const movement=createMovement({our:'~zod',now:()=>clock,visible:()=>true,apply:()=>{},
    presence:{viewers:()=>new Set(),publishTo(){}},agent:{},
    makeSession:()=>({start(){},hear(){},forget(){},tick(){},role:()=> 'guest',announce:()=>null,current:()=>null,stats:()=>({})}),
    makeRelay:(options)=>{onPosition=options.onPosition;return relay;}});
  movement.presence(new Map([['~nec',{at:clock,mv:null}]]));
  onPosition('~nec',{x:1,y:1,dir:'down',scene:'main'},{moving:true,t:clock});
  assert.equal(movement.confidence('~nec'),'live-moving');
  clock+=4000;
  assert.equal(movement.confidence('~nec'),'stalled');
  onPosition('~nec',{x:2,y:1,dir:'down',scene:'main'},{moving:false,t:clock});
  clock+=PEER_GRACE_MS*2;
  assert.equal(movement.confidence('~nec'),'live-stationary');
});
