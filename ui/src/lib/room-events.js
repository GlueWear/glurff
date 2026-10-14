/* Casual shared dice, and session-only chat for any room without a note of its
 * own. No history is replayed. Since 2026-10-13 a line can be edited or
 * deleted -- by whoever wrote it, and nobody else (ui/messages).
 *
 * `rooms` and `gameRoom` come from the map: hard-coded ids meant the dice
 * turned up in whichever room happened to have the old Game Room's number. */
export function createRoomEvents({our, room, peers, send, random = crypto, trace = () => {},
  rooms = (place) => place > 0 && place < 8 && place !== 5, gameRoom = 7}) {
  let messages = [];
  const listeners = new Set();
  const changed = message => listeners.forEach(f => f(message));
  const ordinary = () => rooms(room());
  const prune = () => { messages = messages.filter(m => Date.now()-m.at < 300000).slice(-100); };
  function receive(who, place, event) {
    if (!ordinary() || place !== room() || (who !== our && !peers().includes(who))) {
      trace('room-chat-drop', {who, place, reason: place !== room() ? 'different-room' : 'not-in-room'});
      return false;
    }
    if (!event || typeof event.id !== 'string' || event.id.length > 100 || !event.id.length) return false;
    prune();
    /* An edit or a deletion: of a line its sender wrote, or nothing. */
    if (event.kind === 'chat-edit' || event.kind === 'chat-delete') {
      const target = typeof event.target === 'string' ? messages.find(m => m.eid === event.target) : null;
      if (!target || target.who !== who) return false;
      if (event.kind === 'chat-delete') messages = messages.filter(m => m !== target);
      else {
        if (typeof event.text !== 'string' || !event.text.trim() || event.text.length > 2000) return false;
        if (target.text === event.text) return false;
        messages = messages.map(m => m === target ? {...m, text: event.text, edited: true} : m);
      }
      changed(null);
      trace('room-chat-' + (event.kind === 'chat-edit' ? 'edited' : 'deleted'), {who, place});
      return true;
    }
    if (messages.some(m => m.eid === event.id)) return false;
    let text;
    if (event.kind === 'chat' && typeof event.text === 'string' && event.text.trim() && event.text.length <= 2000) text = event.text;
    else if (event.kind === 'dice' && place === gameRoom && Array.isArray(event.dice) && event.dice.length === 3 && event.dice.every(n => Number.isInteger(n) && n >= 1 && n <= 6)) {
      text = `rolled ${event.dice.join(' · ')} (total ${event.dice.reduce((a,b)=>a+b,0)})`;
    } else return false;
    const message = {eid:event.id,parent:typeof event.parent === 'string' && event.parent.length <= 100 ? event.parent : null,who,text,at:Date.now()};
    messages.push(message);
    prune(); changed(message);
    trace('room-chat-received', {who, place});
    return true;
  }
  async function publish(event) {
    if (!ordinary()) throw Error('Enter a room first');
    if(new TextEncoder().encode(JSON.stringify(event)).length > 8192) throw Error('Message too long');
    const place = room();
    const audience = peers();
    trace('room-chat-send', {place, count: audience.length});
    await send(place,event,audience);
    receive(our,place,event);
  }
  return {
    receive,
    lines: () => { prune(); return [...messages]; },
    clear: () => { messages=[]; changed(); },
    onChange: f => { listeners.add(f); return () => listeners.delete(f); },
    chat: (text,parent=null) => publish({kind:'chat',id:random.randomUUID(),text,parent}),
    edit: (target,text) => publish({kind:'chat-edit',id:random.randomUUID(),target,text}),
    remove: (target) => publish({kind:'chat-delete',id:random.randomUUID(),target}),
    roll: () => {
      if (room() !== gameRoom) return Promise.reject(Error('Enter the Game Room first'));
      const dice=[];
      while(dice.length < 3) { const b=random.getRandomValues(new Uint8Array(1))[0]; if(b<252) dice.push(b%6+1); }
      return publish({kind:'dice',id:random.randomUUID(),dice});
    },
  };
}
