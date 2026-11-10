/* A note's link in a message (Noltbook's ~ref, which a Glurff's invite link
 * is) is drawn as that note, not as letters; addresses around it still are
 * links. See ui/media and lib/glurffs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runs } from '../ui/media.js';
import { inviteLink, noteIconUrl } from '../lib/note-link.js';

test('a note link among words and an address', () => {
  assert.deepEqual(runs('come to ~ref[note-~2026.11.05..02.48.41..5a82|~dolten-dilpun|Glurff%20dev%20world] or https://x.com/a.png.'), [
    { kind: 'text', text: 'come to ' },
    { kind: 'note', note: 'note-~2026.11.05..02.48.41..5a82', host: '~dolten-dilpun', name: 'Glurff dev world' },
    { kind: 'text', text: ' or ' },
    { kind: 'link', url: 'https://x.com/a.png' },
    { kind: 'text', text: '.' },
  ]);
});

test('a note link without a name, and one that is not a link', () => {
  assert.deepEqual(runs('~ref[abc|~zod]'), [{ kind: 'note', note: 'abc', host: '~zod', name: '' }]);
  assert.deepEqual(runs('~ref[abc]'), [{ kind: 'text', text: '~ref[abc]' }]);
});

test('an invite link reads back as its Glurff', () => {
  const link = inviteLink('note-~2026.11.05..02.48.41..5a82', '~dolten-dilpun', 'A | B ] C');
  assert.deepEqual(runs(link), [{ kind: 'note', note: 'note-~2026.11.05..02.48.41..5a82', host: '~dolten-dilpun', name: 'A | B ] C' }]);
});

test('a note\'s icon, where Noltbook finds it', () => {
  const ours = { id: 'note-a', creator: '~zod', iconUrl: '/apps/noltbook/icon/note-a' };
  assert.equal(noteIconUrl(ours, '~zod'), '/apps/noltbook/icon/note-a');
  assert.equal(noteIconUrl(ours, '~zod', 7), '/apps/noltbook/icon/note-a?v=7');
  assert.equal(noteIconUrl({ ...ours, creator: '~nec' }, '~zod'), '/apps/noltbook/note-icon/~nec/note-a');
  assert.equal(noteIconUrl({ ...ours, iconUrl: '/apps/noltbook/icon/note-b' }, '~zod'), null, 'a pointer naming another note');
  assert.equal(noteIconUrl({ ...ours, iconUrl: 'https://x.com/i.png' }, '~zod'), 'https://x.com/i.png');
  assert.equal(noteIconUrl({ ...ours, iconUrl: 'javascript:alert(1)' }, '~zod'), null);
  assert.equal(noteIconUrl({ ...ours, iconUrl: null }, '~zod'), null);
  assert.equal(noteIconUrl(undefined, '~zod'), null);
});
