import { debounce } from './util.js';

/**
 * Historial propio basado en instantáneas. Es independiente del historial
 * nativo del navegador, que se vuelve poco fiable cuando la paginación mueve
 * nodos entre hojas.
 */
export class HistoryManager {
  constructor({ capture, restore, selection, onChange, max = 30 }) {
    this.capture = capture;
    this.restore = restore;
    this.selection = selection;
    this.onChange = onChange || (() => {});
    this.stack = [];
    this.index = -1;
    this.max = max;
    this.restoring = false;
    this.lastSignature = '';
    this.scheduleCommit = debounce(() => this.commit(), 850);
  }

  snapshot() {
    const state = this.capture() || {};
    const sel = this.selection && this.selection.isInPages(window.getSelection()?.anchorNode)
      ? this.selection.save()
      : null;
    return { ...state, selection: sel };
  }

  signature(state) {
    const floats = state.floats ? JSON.stringify(state.floats) : '[]';
    return (state.title || '') + '\u0001' + (state.html || '') + '\u0001' + floats;
  }

  reset() {
    this.scheduleCommit.cancel();
    this.stack = [];
    this.index = -1;
    this.lastSignature = '';
    const state = this.snapshot();
    this.stack.push(state);
    this.index = 0;
    this.lastSignature = this.signature(state);
    this.onChange(this);
  }

  schedule() {
    if (this.restoring) return;
    this.scheduleCommit();
  }

  commit() {
    if (this.restoring) return false;
    this.scheduleCommit.cancel();
    const state = this.snapshot();
    const sig = this.signature(state);
    if (sig === this.lastSignature) {
      this.onChange(this);
      return false;
    }
    if (this.index < this.stack.length - 1) this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(state);
    if (this.stack.length > this.max) this.stack.shift();
    this.index = this.stack.length - 1;
    this.lastSignature = sig;
    this.onChange(this);
    return true;
  }

  flush() {
    return this.commit();
  }

  canUndo() {
    return this.index > 0 || this.scheduleCommit.pending;
  }

  canRedo() {
    return this.index < this.stack.length - 1;
  }

  undo() {
    if (this.scheduleCommit.pending) this.commit();
    if (this.index <= 0) return false;
    this.index -= 1;
    this.applyCurrent('undo');
    return true;
  }

  redo() {
    if (this.index >= this.stack.length - 1) return false;
    this.index += 1;
    this.applyCurrent('redo');
    return true;
  }

  applyCurrent(reason) {
    const state = this.stack[this.index];
    if (!state) return;
    this.restoring = true;
    this.scheduleCommit.cancel();
    try {
      this.restore(state);
      this.lastSignature = this.signature(state);
    } finally {
      this.restoring = false;
      this.onChange(this, reason);
    }
  }

  maxDepth() {
    return this.stack.length;
  }

  destroy() {
    this.scheduleCommit.cancel();
    this.stack = [];
  }
}
