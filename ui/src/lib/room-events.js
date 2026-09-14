/* Session-only room chat and casual shared dice. No history is replayed. */
export function createRoomEvents({our, room, peers, send, random = crypto}) {
  let messages = [];
  const listeners = new Set();
  const changed = () => listeners.forEach(f => f());
  const ordinary = () => room() > 0 && room() < 8 && room() !== 5;
  const prune = () => { messages = messages.filter(m => Date.now()-m.at < 300000).slice(-100); };
  function receive(who, place, event) {
    if (!ordinary() || place !== room() || (who !== our && !peers().includes(who))) return false;
    if (!event || typeof event.id !== 'string' || event.id.length > 100 || !event.id.length) return false;
    prune();
    if (messages.some(m => m.eid === event.id)) return false;
    let text;
    if (event.kind === 'chat' && typeof event.text === 'string' && event.text.trim() && event.text.length <= 2000) text = event.text;
    else if (event.kind === 'dice' && place === 7 && Array.isArray(event.dice) && event.dice.length === 3 && event.dice.every(n => Number.isInteger(n) && n >= 1 && n <= 6)) {
      text = `rolled ${event.dice.join(' · ')} (total ${event.dice.reduce((a,b)=>a+b,0)})`;
    } else return false;
    messages.push({eid:event.id,parent:typeof event.parent === 'string' && event.parent.length <= 100 ? event.parent : null,who,text,at:Date.now()});
    prune(); changed(); return true;
  }
  async function publish(event) {
    if (!ordinary()) throw Error('Enter a room first');
    if(new TextEncoder().encode(JSON.stringify(event)).length > 8192) throw Error('Message too long');
    const place = room();
    await send(place,event,peers());
    receive(our,place,event);
  }
  return {
    receive,
    lines: () => { prune(); return [...messages]; },
    clear: () => { messages=[]; changed(); },
    onChange: f => { listeners.add(f); return () => listeners.delete(f); },
    chat: (text,parent=null) => publish({kind:'chat',id:random.randomUUID(),text,parent}),
    roll: () => {
      if (room() !== 7) return Promise.reject(Error('Enter the Game Room first'));
      const dice=[];
      while(dice.length < 3) { const b=random.getRandomValues(new Uint8Array(1))[0]; if(b<252) dice.push(b%6+1); }
      return publish({kind:'dice',id:random.randomUUID(),dice});
    },
  };
}
