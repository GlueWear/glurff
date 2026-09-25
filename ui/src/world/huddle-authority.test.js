import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import { CallController } from '../lib/call-controller.js';
import { createRoommates } from '../lib/roommates.js';
import { createNoteCall } from '../lib/notecall.js';
import { createModeration } from '../lib/moderation-session.js';
import { createRecorder, canRecord } from '../lib/recording.js';
import * as CallMod from '../lib/moderation.js';
import * as H from '../lib/huddle.js';

const source=fs.readFileSync(new URL('../lib/rooms.js',import.meta.url),'utf8')
  .replace(/^import [^;]*;/gm,'').replace(/^export /gm,'');

function pair(){
  const clock={t:8_000_000},queue=[],clients=new Map();
  class FakeDate extends Date{static now(){return clock.t;}}
  class Sfu{constructor(o){this.o=o;}connect(){}close(){}publish(){return 1;}unpublish(){}
    others(){return new Set();}setPositions(){}setFlatGain(){}setSilenced(){}audioTracks(){return [];}}
  const make=(our)=>{
    const operations=[];
    const context=vm.createContext({CallController,createRoommates,createNoteCall,createModeration,createRecorder,canRecord,
      ...CallMod,...H,diagnostic:()=>{},console,performance,structuredClone,setTimeout:()=>0,clearTimeout(){},
      setInterval:()=>0,clearInterval(){},Date:FakeDate,Map,Set,Promise,JSON,Number,Math,String,Object,Array,
      navigator:{mediaDevices:{}},processMicrophone:async s=>({stream:s,cleanup(){}}),SfuSession:Sfu,
      our,displayName:x=>x,palStatus:()=>'mutual',visiblePeers:()=>[...clients.keys()].filter(s=>s!==our),
      noteVisibility:()=>'private',requestRemoteNotes:async()=>{},subscribeRaw:async()=>({}),nbAction:async()=>{},
      onNoltbook:()=>()=>{},nb:{calls:{},callMods:{},noteAdmins:{},notes:{}},noteCallRole:()=>null,
      noteCallMuted:()=>false,noteCallBooted:()=>false,noteCallRecording:()=>null,noteModerate:async()=>{},
      noteCreator:()=>null,regionAt:()=>0,COMMONS:0,micConstraints:()=>({}),camConstraints:()=>({}),refreshDevices(){},
      G:{watchCallAccess:()=>Promise.resolve(),claimRoom:async()=>{},releaseRoom:async()=>{},
        sendPresence:async(to,event)=>queue.push({from:our,to,event:structuredClone(event)}),
        callOperation:async(op,place,who,attempt)=>operations.push({op,place,who,attempt})}});
    vm.runInContext(source+'\nglobalThis.app={initRooms,refresh,updateHuddle,currentHuddle,receiveCallEvent,receiveRoomEvent,setPositionGate,closeTab};',context);
    const client={app:context.app,operations};clients.set(our,client);return client;
  };
  const a=make('~aaa'),b=make('~bbb');
  const peers=(who,x,host=null)=>new Map([[who,{spot:{x,y:10,dir:'down',scene:'main'},host}]]);
  const drain=()=>{let n=0;while(queue.length && n++<100){const m=queue.shift(),c=clients.get(m.to);if(!c)continue;
    if(m.event.kind.startsWith('call-'))c.app.receiveCallEvent(m.from,m.event);
    else if(m.event.kind.startsWith('room-'))c.app.receiveRoomEvent(m.from,m.event);}
    assert.ok(n<100,'control messages stay bounded');};
  return {clock,a,b,peers,drain};
}

test('the elected host publishes one authoritative huddle session to its guest',async()=>{
  const p=pair();await Promise.all([p.a.app.initRooms(),p.b.app.initRooms()]);
  try{
    const ap=p.peers('~bbb',11),bp=p.peers('~aaa',9);
    p.a.app.refresh(ap);p.b.app.refresh(bp);
    p.a.app.updateHuddle({x:10,y:10},ap);p.b.app.updateHuddle({x:10,y:10},bp);
    p.clock.t+=2999;
    p.a.app.updateHuddle({x:10,y:10},ap);
    assert.equal(p.a.app.currentHuddle(),null,'a passer-by does not start a call before three seconds');
    p.clock.t+=2;
    p.a.app.updateHuddle({x:10,y:10},ap);
    p.b.app.updateHuddle({x:10,y:10},bp);
    p.drain();
    const ah=p.a.app.currentHuddle(),bh=p.b.app.currentHuddle();
    assert.ok(ah && bh);
    assert.equal(ah.host,'~aaa');
    assert.equal(bh.host,'~aaa');
    assert.equal(bh.session,ah.session);
    assert.equal(bh.rev,ah.rev);
    assert.deepEqual([...bh.members],['~aaa','~bbb']);
  }finally{p.a.app.closeTab();p.b.app.closeTab();}
});

test('stalled movement freezes an established roster; confirmed distance ends it after grace',async()=>{
  const p=pair();await Promise.all([p.a.app.initRooms(),p.b.app.initRooms()]);
  try{
    let ap=p.peers('~bbb',11),bp=p.peers('~aaa',9);
    p.a.app.refresh(ap);p.b.app.refresh(bp);
    p.a.app.updateHuddle({x:10,y:10},ap);p.b.app.updateHuddle({x:10,y:10},bp);
    p.clock.t+=3001;p.a.app.updateHuddle({x:10,y:10},ap);p.drain();
    assert.ok(p.a.app.currentHuddle() && p.b.app.currentHuddle());

    ap=p.peers('~bbb',30);
    p.a.app.setPositionGate({reliable:()=>true,confidence:()=> 'stalled'});
    p.a.app.refresh(ap);p.a.app.updateHuddle({x:10,y:10},ap);
    p.clock.t+=30000;p.a.app.updateHuddle({x:10,y:10},ap);
    assert.ok(p.a.app.currentHuddle(),'delay alone cannot split a working huddle');

    p.a.app.setPositionGate({reliable:()=>true,confidence:()=> 'live-moving'});
    p.a.app.updateHuddle({x:10,y:10},ap);
    p.clock.t+=8001;p.a.app.updateHuddle({x:10,y:10},ap);p.drain();
    assert.equal(p.a.app.currentHuddle(),null);
    assert.equal(p.b.app.currentHuddle(),null);
  }finally{p.a.app.closeTab();p.b.app.closeTab();}
});
