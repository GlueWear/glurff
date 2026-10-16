import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerState, playbackPosition, validPlayerState } from '../lib/player-state.js';

test('a theater screen can point at one live screen-capture incarnation', () => {
  const sent=[];
  const store=createPlayerState({our:'~mignes-magtel',now:()=>1234,send:e=>sent.push(e)});
  const state=store.write('amphitheatre',{
    provider:'screen',ref:'~mignes-magtel|capture-1',positionMs:0,paused:false,
  },{newItem:true});
  assert.equal(validPlayerState(state),true);
  assert.equal(playbackPosition(state,999999),0,'live media has no synthetic playback clock');
  assert.equal(state.startedBy,'~mignes-magtel');
  assert.equal(sent.length,1);
});

test('a later capture is a distinct shared-screen item', () => {
  const store=createPlayerState({our:'~mignes-magtel',now:()=>1234});
  const first=store.write('movie',{provider:'screen',ref:'~mignes-magtel|capture-1',paused:false},{newItem:true});
  const second=store.write('movie',{provider:'screen',ref:'~mignes-magtel|capture-2',paused:false},{newItem:true});
  assert.ok(second.rev>first.rev);
  assert.notEqual(second.ref,first.ref);
});
