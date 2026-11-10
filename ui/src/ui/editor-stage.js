/* THE EDITOR ON THE STAGE (2026-11-07): the map editor opens inside Glurff,
 * on the stage (ui/stage), instead of in a tab of its own -- our own page,
 * edit.html, in a frame between Glurff's bars, with the stage's bar to
 * minimize or close it. Glurff stays open round it: chat, messages and calls
 * go on, and the cross is the way back to the world.
 *
 * Over our head, as an app puts what we are playing, it says "in the Glurff
 * editor" (2026-11-09; lib/sites activityText).
 *
 * Closing waits for the editor to put its last change on our ship (its
 * flush()), and asks first if that cannot be done: removing a frame gives its
 * page no chance to save. The editor asks to close itself, or to visit our
 * Glurff, through window.__glurffEditor.
 */
const PAGE = '/apps/glurff/edit.html';

export class EditorStage {
  /* stage: ui/stage. ask: Glurff's question box. visit(): to our own Glurff,
   * when the editor asks for it. */
  constructor({ stage, ask, visit = () => {}, look = () => null, editLook = null }) {
    Object.assign(this, { stage, ask, visit });
    this.root = null; this.frame = null; this.closing = null;
    /* look(): our character as it is now, for a character of the world's
     * dressed as we are (editor npcFields). editLook(look): Glurff's own
     * character builder over the editor, for an NPC; its new look, or null. */
    window.__glurffEditor = { leave: (opts) => this.leave(opts), look: () => look(), editLook };
  }

  get isOpen() { return !!this.root; }

  /* Open, or back from the corner if it was minimized. */
  open() {
    if (this.root) {
      if (this.stage.source?.id === 'editor') { if (this.stage.minimized) this.stage.restore(); return; }
      /* STILL HERE (2026-11-09): something else took the stage while the
       * editor was putting its last change on our ship (close), and EDIT
       * GLURFF did nothing until that was done. It comes back now, and the
       * close in flight lets it be. */
      this.closing = null;
      this.stage.enter({ id: 'editor', kind: 'editor', title: 'Glurff editor', frame: this.frame, close: () => this.close() });
      return;
    }
    const root = document.createElement('div');
    root.className = 'app-panel staged editor-panel';
    root.innerHTML = '<div class="app-body"></div>';
    const frame = document.createElement('iframe');
    frame.className = 'app-frame';
    frame.title = 'Glurff editor';
    frame.src = PAGE;
    /* Keys go to the editor from the start: its tools have letters. */
    frame.addEventListener('load', () => { try { frame.contentWindow.focus(); } catch {} });
    root.firstChild.append(frame);
    document.body.append(root);
    this.root = root; this.frame = frame;
    this.stage.enter({ id: 'editor', kind: 'editor', title: 'Glurff editor', frame, close: () => this.close() });
  }

  /* The cross, or the editor asking. If something else took the stage, the
   * editor goes without a question: it is no longer there to come back to. */
  async close() {
    if (!this.root || this.closing) return false;
    const replaced = this.stage.source?.id !== 'editor';
    const mine = {};
    this.closing = mine;
    try {
      let lost = null;
      try { lost = await this.frame.contentWindow?.__editor?.flush?.(); } catch {}
      /* Opened again meanwhile (open): it stays. */
      if (this.closing !== mine) return false;
      if (lost && !replaced && !(await this.ask('Close the editor?', { yes: 'CLOSE ANYWAY', no: 'KEEP EDITING', detail: lost }))) return false;
      if (this.closing !== mine) return false;
      this.root.remove();
      this.root = this.frame = null;
      this.stage.leave('editor');
      return true;
    } finally { if (this.closing === mine) this.closing = null; }
  }

  async leave({ visit = false } = {}) {
    if ((await this.close()) && visit) this.visit();
  }
}
