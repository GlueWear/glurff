/* 2026-11-13: what has the keyboard while something is on the stage
 * (ui/stage, ui/hud). The real-browser test, with real clicks and keys, is
 * implementation/stage-keyboard/drive.mjs; these keep the rules in place. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const stage = read('../ui/stage.js'), hud = read('../ui/hud.js');

test('one-click controls never take the keyboard from what is staged', () => {
  assert.match(stage, /const ONE_CLICK = '#rail \.media-icon, #rail \.vids, #rail \.mic-retry, #rail \.retry-call';/);
  assert.match(stage, /document\.addEventListener\('mousedown', \(e\) => \{\n      if \(this\.keyboardHome && e\.target\?\.closest\?\.\(ONE_CLICK\)\) e\.preventDefault\(\);\n    \}, true\);/);
});

test('after a click or Escape the keyboard goes back to the app, unless a box is typed in or a panel is open', () => {
  assert.match(stage, /document\.addEventListener\('click', \(\) => \{ if \(this\.keyboardHome\) setTimeout\(\(\) => this\.settle\(\), 0\); \}, true\);/);
  assert.match(stage, /if \(e\.key === 'Escape' && this\.keyboardHome\) setTimeout\(\(\) => this\.settle\(\), 0\);/);
  assert.match(stage, /if \(a && a !== document\.body && a\.matches\?\.\(TYPING\) && visible\(a\)\) return;\n    if \(panelOpen\(\)\) return;\n    this\.handBack\(\);/);
  assert.match(stage, /const PANELS = \['\[aria-expanded="true"\]:not\(\.chat-toggle\)', '\.card-overlay:not\(\[hidden\]\)', 'dialog\[open\]',\n  '\[role="dialog"\]:not\(\.app-panel\)', '\[role="menu"\]', '\.builder'\]/);
  assert.match(stage, /get keyboardHome\(\) \{ return !this\.minimized && this\.source\?\.frame\?\.isConnected \? this\.source\.frame : null; \}/);
});

test('staged, restored: the app has the keyboard; Tab is never looked at', () => {
  assert.match(stage, /\/\* Just staged: the keyboard is its, unless Glurff still has a use for it\. \*\/\n    setTimeout\(\(\) => this\.settle\(\), 0\);/);
  assert.match(stage, /this\.shrink\(this\.stagedElements\(\), false\);\n    this\.handBack\(\);/);
  assert.doesNotMatch(stage, /'Tab'/);
});

test('on the stage the chat takes the keyboard when opened and keeps it after a send', () => {
  assert.match(hud, /if\(this\.chatOpen&&staged\(\)\)\{this\.chatSticky=true;this\.root\.querySelector\('\.say input'\)\.focus\(\{preventScroll:true\}\);\}\};/);
  assert.match(hud, /if \(!this\.chatSticky && !staged\(\)\) input\.blur\(\);/);
  assert.match(hud, /const staged = \(\) => typeof document !== 'undefined' && document\.documentElement\.classList\.contains\('staged'\);/);
});
