import test from 'node:test';
import assert from 'node:assert/strict';
import { bioHtml, externalAvatar } from '../lib/profile-text.js';

test('profile bios link only http(s), escape markup, and leave sentence punctuation outside', () => {
  const html = bioHtml('Hi <b>x</b> https://example.com/a?q=1&x=2. javascript:alert(1)');
  assert.match(html, /Hi &lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /href="https:\/\/example\.com\/a\?q=1&amp;x=2"/);
  assert.match(html, /<\/a>\./);
  assert.doesNotMatch(html, /href="javascript:/);
});

test('profile picture URLs allow only absolute http(s) addresses', () => {
  assert.equal(externalAvatar('https://example.com/me.png'), 'https://example.com/me.png');
  assert.equal(externalAvatar('http://example.com/me.png'), 'http://example.com/me.png');
  assert.equal(externalAvatar('data:image/png;base64,abc'), null);
  assert.equal(externalAvatar('javascript:alert(1)'), null);
  assert.equal(externalAvatar('/relative.png'), null);
});
