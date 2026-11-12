import { clamp, debounce, escapeHtml, uid } from './util.js';
import { Parser, makeHeaderMarker, makePageBreakBlock } from './parser.js';

const BLOCK_SELECTOR = 'p, div, h1, h2, h3, h4, h5, h6, blockquote, pre, ul, ol, table, figure, hr';
const EXCLUDED_TEXT = '.katex, .math-block, .math-inline, .math-error, .pagebreak-block, .hdr-marker, .doc-figure, .doc-float-image, .image-anchor, button';

function safeLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(raw)) return raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
  return 'https://' + raw;
}

/**
 * Edición directa sobre las hojas A4. Toda la interacción de formato,
 * inserción y pegado vive aquí; el contenido nunca se duplica en un panel.
 */
export class Editor {
  constructor(app) {
    this.app = app;
    this.pagesEl = app.pagesEl;
    this.scheduleLayout = debounce(() => this.app.relayout(), 340);
    this.scheduleSync = debounce(() => this.syncToolbar(), 70);
    this.bind();
  }

  bind() {
    this.pagesEl.addEventListener('input', (event) => {
      if (!event.target.closest('.a4-content')) return;
      this.app.onEdit();
      this.scheduleLayout();
      this.scheduleSync();
      this.app.refreshStatsSoon();
    });

    this.pagesEl.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.pagesEl.addEventListener('paste', (event) => this.onPaste(event));
    this.pagesEl.addEventListener('click', (event) => this.onClick(event));
    this.pagesEl.addEventListener('focusin', () => this.scheduleSync());
    this.pagesEl.addEventListener('keyup', () => this.scheduleSync());
    this.pagesEl.addEventListener('mouseup', () => this.scheduleSync());

    this.pagesEl.addEventListener('beforeinput', (event) => {
      if (event.inputType === 'historyUndo') {
        event.preventDefault();
        this.app.undo();
      } else if (event.inputType === 'historyRedo') {
        event.preventDefault();
        this.app.redo();
      }
    });

    document.addEventListener('selectionchange', () => {
      this.scheduleSync();
      this.app.onSelectionChanged?.();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Utilidades de selección                                            */
  /* ------------------------------------------------------------------ */

  isInPages() {
    const selection = window.getSelection();
    return !!(selection && selection.rangeCount && this.app.selection.isInPages(selection.anchorNode));
  }

  currentRange() {
    const range = this.app.selection.currentRange();
    if (range) return range;
    if (this.app.selection.restoreSavedRange()) return this.app.selection.currentRange();
    return null;
  }

  ensureSelection() {
    if (this.isInPages()) return true;
    return this.app.selection.restoreSavedRange() || this.app.selection.restoreBeforeInsert();
  }

  placeCaret(node, where = 'end') {
    if (!node || !node.isConnected) return false;
    const content = node.nodeType === Node.ELEMENT_NODE
      ? (node.closest('.a4-content') || node)
      : node.parentElement?.closest('.a4-content');
    if (!content) return false;
    try { content.focus({ preventScroll: false }); } catch (e) { content.focus(); }
    const range = document.createRange();
    if (node === content) {
      range.selectNodeContents(content);
      range.collapse(where === 'start');
    } else {
      range.selectNodeContents(node);
      range.collapse(where === 'start');
    }
    const selection = window.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  focusAtPoint(x, y) {
    let range = null;
    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
    else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    if (range && this.app.selection.isInPages(range.startContainer)) {
      const content = this.app.selection.contentOf(range.startContainer);
      if (content) {
        try { content.focus({ preventScroll: true }); } catch (e) { content.focus(); }
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
    }
    const content = this.app.selection.caretContent();
    return content ? this.placeCaret(content, 'end') : false;
  }

  selectedTopBlocks() {
    const range = this.currentRange();
    if (!range) return [];
    const blocks = [];
    this.pagesEl.querySelectorAll('.a4-content').forEach((content) => {
      if (!range.intersectsNode(content)) return;
      Array.from(content.children).forEach((block) => {
        if (block.classList.contains('pagebreak-block') || block.classList.contains('hdr-marker')) return;
        if (!range.intersectsNode(block)) return;
        blocks.push(block);
      });
    });
    if (!blocks.length) {
      const block = this.app.selection.topBlockOf(range.startContainer);
      if (block) blocks.push(block);
    }
    return blocks;
  }

  isEmptyBlock(element) {
    if (!element) return false;
    if (element.classList && (
      element.classList.contains('image-anchor') ||
      element.classList.contains('pagebreak-block') ||
      element.classList.contains('hdr-marker') ||
      element.classList.contains('math-block') ||
      element.classList.contains('doc-figure') ||
      element.classList.contains('doc-float-image')
    )) return false;
    if (element.querySelector('img, table, .math-inline, .katex, hr, iframe')) return false;
    return !element.textContent.replace(/\u200B/g, '').trim();
  }

  splitBlockAtRange(block, range) {
    if (!block || !range || !block.contains(range.endContainer)) return null;
    const tail = block.cloneNode(false);
    tail.removeAttribute('data-split-head');
    tail.removeAttribute('data-split-tail');
    tail.classList.remove('split-head', 'split-tail');
    tail.setAttribute('data-bid', uid('b'));
    let fragment;
    try {
      const tailRange = document.createRange();
      tailRange.selectNodeContents(block);
      tailRange.setStart(range.endContainer, range.endOffset);
      fragment = tailRange.extractContents();
    } catch (error) {
      return null;
    }
    if (!fragment.textContent.trim() && !fragment.querySelector('img, br, .math-inline, .katex')) return null;
    tail.appendChild(fragment);
    block.after(tail);
    return tail;
  }

  ensureParagraphAfter(node) {
    if (!node || !node.parentElement) return null;
    const next = node.nextElementSibling;
    if (next && !next.classList.contains('pagebreak-block') && !next.classList.contains('hdr-marker') &&
        !next.classList.contains('math-block') && !next.classList.contains('doc-figure') &&
        next.tagName !== 'TABLE') {
      return next;
    }
    const paragraph = document.createElement('p');
    paragraph.setAttribute('data-bid', uid('b'));
    paragraph.appendChild(document.createElement('br'));
    node.after(paragraph);
    return paragraph;
  }

  focusAfterInsert(nodes, tail, options = {}) {
    if (options.focus === false) return;
    if (tail && tail.isConnected) {
      this.placeCaret(tail, 'start');
      return;
    }
    const last = nodes[nodes.length - 1];
    if (!last || !last.isConnected) return;
    if (last.tagName === 'TABLE') {
      const cell = last.querySelector('th, td');
      if (cell) this.placeCaret(cell, 'start');
      return;
    }
    if (last.classList.contains('pagebreak-block') || last.classList.contains('hdr-marker')) {
      return;
    }
    if (last.classList.contains('math-block') || last.classList.contains('doc-figure') ||
        last.classList.contains('doc-float-image') || last.classList.contains('image-anchor') ||
        last.tagName === 'HR') {
      const paragraph = this.ensureParagraphAfter(last);
      if (paragraph) this.placeCaret(paragraph, 'start');
      return;
    }
    this.placeCaret(last, 'end');
  }

  /**
   * Inserta nodos de bloque en la posición del cursor, dividiendo el párrafo
   * cuando es necesario. Devuelve los nodos insertados.
   */
  insertBlockNodes(nodes, options = {}) {
    const list = Array.from(nodes || []).filter(Boolean);
    if (!list.length) return [];
    if (!this.ensureSelection()) return [];
    let range = this.app.selection.currentRange();
    let content = range ? this.app.selection.contentOf(range.startContainer) : null;
    if (!content) {
      content = this.app.selection.caretContent();
      if (!content) return [];
      range = document.createRange();
      range.selectNodeContents(content);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (!range.collapsed) range.deleteContents();

    const top = this.app.selection.topBlockOf(range.startContainer);
    if (top && this.isEmptyBlock(top) && !top.classList.contains('image-anchor')) {
      const parent = top.parentElement;
      list.forEach((node) => parent.insertBefore(node, top));
      top.remove();
      this.focusAfterInsert(list, null, options);
      return list;
    }

    let tail = null;
    if (top && content.contains(top) && /^(P|H[1-6]|DIV|BLOCKQUOTE)$/.test(top.tagName)) {
      tail = this.splitBlockAtRange(top, range);
    }

    if (top && this.isEmptyBlock(top) && !top.classList.contains('image-anchor')) {
      const parent = top.parentElement;
      list.forEach((node) => parent.insertBefore(node, top));
      top.remove();
    } else if (tail && tail.isConnected) {
      list.forEach((node) => content.insertBefore(node, tail));
      if (this.isEmptyBlock(tail)) {
        tail.remove();
        tail = null;
      }
    } else if (top && content.contains(top)) {
      let reference = top.nextSibling;
      list.forEach((node) => content.insertBefore(node, reference));
    } else {
      list.forEach((node) => content.appendChild(node));
    }

    this.focusAfterInsert(list, tail, options);
    return list;
  }

  /* ------------------------------------------------------------------ */
  /* Entrada de texto y pegado                                         */
  /* ------------------------------------------------------------------ */

  onKeyDown(event) {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key === 'Escape') {
      if (this.app.images && this.app.images.selected) {
        this.app.images.deselect();
        event.preventDefault();
      }
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.app.images && this.app.images.selected) {
      event.preventDefault();
      this.app.images.deleteSelected();
      return;
    }
    if (event.key === 'Tab') {
      const cell = event.target.closest && event.target.closest('td, th');
      if (cell) {
        event.preventDefault();
        this.moveTableCell(cell, event.shiftKey);
      }
    }
  }

  onClick(event) {
    const remove = event.target.closest('[data-remove-marker]');
    if (remove) {
      const marker = remove.closest('.pagebreak-block, .hdr-marker');
      if (marker) {
        marker.remove();
        this.app.afterMutation({ relayout: true, historyNow: true });
      }
      return;
    }
    const link = event.target.closest('a[href]');
    if (link && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      const href = link.getAttribute('href') || '';
      if (/^(https?:|mailto:|tel:)/i.test(href)) window.open(href, '_blank', 'noopener');
    }
  }

  onPaste(event) {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    if (this.app.images && this.app.images.handlePaste(event)) return;

    const text = clipboard.getData('text/plain') || '';
    const html = clipboard.getData('text/html') || '';
    const range = this.currentRange();
    if (range && range.startContainer.parentElement?.closest('pre')) return;

    if (text && Parser.looksLikeMarkdown(text)) {
      event.preventDefault();
      const fragment = Parser.markdownToFlowHtml(text);
      const nodes = this.nodesFromHtml(fragment);
      const inserted = this.insertBlockNodes(nodes);
      if (inserted.length && this.app.images) {
        inserted.forEach((node) => this.app.images.normalizeImages(node));
        if (this.app.images) this.app.images.normalizeImages(this.pagesEl);
      }
      this.app.afterMutation({ relayout: true, historyNow: true });
      return;
    }

    if (html) {
      event.preventDefault();
      const clean = Parser.normalizePastedHtml(html);
      const nodes = this.nodesFromHtml(clean);
      if (nodes.length) {
        const inserted = this.insertBlockNodes(nodes);
        if (this.app.images) inserted.forEach((node) => this.app.images.normalizeImages(node));
        this.app.afterMutation({ relayout: true, historyNow: true });
      }
      return;
    }

    if (text && text.includes('\n')) {
      event.preventDefault();
      const htmlText = text.split(/\n{2,}/).map((paragraph) =>
        '<p>' + escapeHtml(paragraph).replace(/\n/g, '<br>') + '</p>'
      ).join('');
      const nodes = this.nodesFromHtml(htmlText);
      this.insertBlockNodes(nodes);
      this.app.afterMutation({ relayout: true, historyNow: true });
    }
  }

  nodesFromHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    const nodes = [];
    const inline = [];
    const flushInline = () => {
      if (!inline.length) return;
      const paragraph = document.createElement('p');
      paragraph.setAttribute('data-bid', uid('b'));
      inline.splice(0).forEach((node) => paragraph.appendChild(node));
      nodes.push(paragraph);
    };
    Array.from(template.content.childNodes).forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE && this.isBlockElement(node)) {
        flushInline();
        nodes.push(node);
      } else if (node.nodeType === Node.TEXT_NODE && !node.data.trim()) {
        return;
      } else {
        inline.push(node);
      }
    });
    flushInline();
    return nodes;
  }

  isBlockElement(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return /^(P|DIV|H[1-6]|UL|OL|LI|TABLE|BLOCKQUOTE|PRE|HR|FIGURE|SECTION|ARTICLE)$/.test(node.tagName) ||
      node.classList.contains('math-block') ||
      node.classList.contains('pagebreak-block') ||
      node.classList.contains('hdr-marker') ||
      node.classList.contains('doc-figure') ||
      node.classList.contains('image-anchor');
  }

  /* ------------------------------------------------------------------ */
  /* Formato en línea                                                   */
  /* ------------------------------------------------------------------ */

  applyInlineStyle(styleText) {
    if (!this.ensureSelection()) return false;
    const range = this.currentRange();
    if (!range) return false;
    const selection = window.getSelection();
    if (range.collapsed) {
      const span = document.createElement('span');
      span.setAttribute('style', styleText);
      span.appendChild(document.createTextNode('\u200B'));
      range.insertNode(span);
      const text = span.firstChild;
      const caret = document.createRange();
      caret.setStart(text, text.data.length);
      caret.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caret);
      return true;
    }

    const textNodes = [];
    this.pagesEl.querySelectorAll('.a4-content').forEach((content) => {
      if (!range.intersectsNode(content)) return;
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest(EXCLUDED_TEXT)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let node;
      while ((node = walker.nextNode())) {
        if (range.intersectsNode(node)) textNodes.push(node);
      }
    });
    if (!textNodes.length) return false;

    const spans = [];
    textNodes.forEach((node) => {
      let start = node === range.startContainer ? range.startOffset : 0;
      let end = node === range.endContainer ? range.endOffset : node.data.length;
      if (node !== range.startContainer && range.comparePoint(node, 0) > 0) return;
      if (node !== range.endContainer && range.comparePoint(node, node.data.length) < 0) return;
      start = clamp(start, 0, node.data.length);
      end = clamp(end, 0, node.data.length);
      if (start >= end) return;
      try {
        const part = document.createRange();
        part.setStart(node, start);
        part.setEnd(node, end);
        const fragment = part.extractContents();
        const span = document.createElement('span');
        span.setAttribute('style', styleText);
        span.appendChild(fragment);
        part.insertNode(span);
        spans.push(span);
      } catch (error) {
        /* nodo partido por una operación previa */
      }
    });
    if (!spans.length) return false;
    const last = spans[spans.length - 1];
    const selectionRange = document.createRange();
    selectionRange.setStartBefore(spans[0]);
    selectionRange.setEndAfter(last);
    selection.removeAllRanges();
    selection.addRange(selectionRange);
    return true;
  }

  applyCommand(command, value = null) {
    if (!this.ensureSelection()) return false;
    try {
      document.execCommand('styleWithCSS', false, false);
      document.execCommand(command, false, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  format(action) {
    const commands = {
      bold: ['bold'],
      italic: ['italic'],
      underline: ['underline'],
      strike: ['strikeThrough']
    };
    const pair = commands[action];
    if (!pair) return false;
    const changed = this.applyCommand(pair[0]);
    if (changed) this.afterFormatting();
    return changed;
  }

  clearFormat() {
    if (!this.ensureSelection()) return false;
    try {
      document.execCommand('removeFormat');
      this.afterFormatting();
      return true;
    } catch (error) {
      return false;
    }
  }

  applyColor(kind, color) {
    if (!color) color = 'transparent';
    const style = kind === 'hiliteColor'
      ? 'background-color: ' + color
      : 'color: ' + color;
    if (!this.applyInlineStyle(style)) return false;
    this.afterFormatting();
    return true;
  }

  setFontFamily(family) {
    const value = family ? 'font-family: "' + String(family).replace(/"/g, '') + '"' : 'font-family: var(--doc-font)';
    if (!this.applyInlineStyle(value)) return false;
    this.afterFormatting();
    return true;
  }

  setFontSize(size) {
    const value = clamp(Number(size) || 11.5, 5, 120);
    if (!this.applyInlineStyle('font-size: ' + value + 'pt')) return false;
    this.afterFormatting();
    return true;
  }

  stepFontSize(delta) {
    const current = this.currentFontSize();
    return this.setFontSize(clamp(Math.round((current + delta) * 2) / 2, 5, 120));
  }

  afterFormatting() {
    this.app.afterMutation({ relayout: true, historyNow: true });
    this.syncToolbar();
  }

  /* ------------------------------------------------------------------ */
  /* Párrafo y bloques                                                  */
  /* ------------------------------------------------------------------ */

  setBlockStyle(tag) {
    if (!this.ensureSelection()) return false;
    const blocks = this.selectedTopBlocks();
    if (!blocks.length) return false;
    let last = null;
    blocks.forEach((block) => {
      if (block.tagName === 'TABLE') return;
      if (block.classList.contains('pagebreak-block') || block.classList.contains('hdr-marker')) return;
      if (block.tagName === 'UL' || block.tagName === 'OL') {
        const fragment = document.createDocumentFragment();
        Array.from(block.children).filter((item) => item.tagName === 'LI').forEach((item) => {
          const converted = this.createBlockFrom(item, tag);
          fragment.appendChild(converted);
          last = converted;
        });
        block.replaceWith(fragment);
        return;
      }
      const converted = this.createBlockFrom(block, tag);
      if (converted) last = converted;
    });
    if (!last) return false;
    this.app.afterMutation({ relayout: true, historyNow: true });
    this.placeCaret(last, 'start');
    this.syncToolbar();
    return true;
  }

  createBlockFrom(block, tag) {
    if (!block) return null;
    let target;
    if (tag === 'pre') {
      target = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.textContent.replace(/\u200B/g, '');
      target.appendChild(code);
    } else if (tag === 'blockquote') {
      target = document.createElement('blockquote');
      const clean = block.innerHTML.replace(/<\/?p[^>]*>/gi, '');
      const paragraph = document.createElement('p');
      paragraph.innerHTML = clean;
      target.appendChild(paragraph);
    } else {
      target = document.createElement(tag);
      target.innerHTML = block.innerHTML;
    }
    const sourceStyle = block.getAttribute('style') || '';
    const keep = [];
    sourceStyle.split(';').forEach((declaration) => {
      const index = declaration.indexOf(':');
      if (index < 0) return;
      const prop = declaration.slice(0, index).trim().toLowerCase();
      if (['text-align', 'line-height', 'margin-left', 'margin-bottom'].includes(prop)) keep.push(declaration.trim());
    });
    if (keep.length) target.setAttribute('style', keep.join('; '));
    target.setAttribute('data-bid', block.getAttribute('data-bid') || uid('b'));
    block.replaceWith(target);
    return target;
  }

  align(value) {
    const commands = {
      left: 'justifyLeft',
      center: 'justifyCenter',
      right: 'justifyRight',
      justify: 'justifyFull'
    };
    if (!commands[value]) return false;
    if (!this.applyCommand(commands[value])) return false;
    this.app.afterMutation({ relayout: true, historyNow: true });
    this.syncToolbar();
    return true;
  }

  toggleList(kind) {
    if (!this.applyCommand(kind)) return false;
    this.app.afterMutation({ relayout: true, historyNow: true });
    this.syncToolbar();
    return true;
  }

  changeIndent(direction) {
    if (!this.ensureSelection()) return false;
    const range = this.currentRange();
    if (!range) return false;
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    if (start && start.closest('li')) {
      this.applyCommand(direction > 0 ? 'indent' : 'outdent');
    } else {
      const blocks = this.selectedTopBlocks();
      blocks.forEach((block) => {
        if (block.tagName === 'TABLE' || block.classList.contains('pagebreak-block')) return;
        const computed = window.getComputedStyle(block);
        const current = parseFloat(block.style.marginLeft) || parseFloat(computed.marginLeft) || 0;
        const next = clamp(current + direction * 24, 0, 240);
        block.style.marginLeft = next ? Math.round(next) + 'px' : '';
      });
    }
    this.app.afterMutation({ relayout: true, historyNow: true });
    this.syncToolbar();
    return true;
  }

  setLineSpacing(value) {
    const spacing = clamp(Number(value) || 1, 0.8, 4);
    const blocks = this.selectedTopBlocks();
    if (!blocks.length) return false;
    blocks.forEach((block) => {
      if (block.classList.contains('pagebreak-block') || block.classList.contains('hdr-marker')) return;
      block.style.lineHeight = String(spacing);
    });
    this.app.afterMutation({ relayout: true, historyNow: true });
    this.syncToolbar();
    return true;
  }

  setParagraphSpacing(points) {
    const value = clamp(Number(points) || 0, 0, 120);
    const blocks = this.selectedTopBlocks();
    if (!blocks.length) return false;
    blocks.forEach((block) => {
      if (block.classList.contains('pagebreak-block') || block.classList.contains('hdr-marker')) return;
      block.style.marginBottom = value ? value + 'pt' : '0pt';
    });
    this.app.afterMutation({ relayout: true, historyNow: true });
    this.syncToolbar();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Inserción de bloques                                               */
  /* ------------------------------------------------------------------ */

  insertTable(rows, cols, hasHeader = true) {
    const rowCount = clamp(Math.round(Number(rows) || 3), 1, 30);
    const colCount = clamp(Math.round(Number(cols) || 3), 1, 12);
    const table = document.createElement('table');
    table.setAttribute('data-bid', uid('b'));
    table.style.width = '100%';
    if (hasHeader) {
      const thead = document.createElement('thead');
      const row = document.createElement('tr');
      for (let c = 0; c < colCount; c++) {
        const cell = document.createElement('th');
        cell.appendChild(document.createElement('br'));
        row.appendChild(cell);
      }
      thead.appendChild(row);
      table.appendChild(thead);
    }
    const tbody = document.createElement('tbody');
    const bodyRows = hasHeader ? Math.max(0, rowCount - 1) : rowCount;
    for (let r = 0; r < bodyRows; r++) {
      const row = document.createElement('tr');
      for (let c = 0; c < colCount; c++) {
        const cell = document.createElement('td');
        cell.appendChild(document.createElement('br'));
        row.appendChild(cell);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    const inserted = this.insertBlockNodes([table], { focus: false });
    if (!inserted.length) return;
    this.app.afterMutation({ relayout: true, historyNow: true });
    const first = table.querySelector('th, td');
    if (first) this.placeCaret(first, 'start');
  }

  insertFormula(tex, display) {
    const source = String(tex || '').trim();
    if (!source) return;
    const node = Parser.mathNode(source, !!display);
    if (display) {
      this.insertBlockNodes([node], { focus: false });
    } else {
      if (!this.ensureSelection()) return;
      const range = this.currentRange();
      if (!range) return;
      if (!range.collapsed) range.deleteContents();
      range.insertNode(node);
      const space = document.createTextNode('\u200B');
      node.after(space);
      const caret = document.createRange();
      caret.setStart(space, space.data.length);
      caret.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(caret);
    }
    this.app.afterMutation({ relayout: true, historyNow: true });
    if (display) {
      const paragraph = this.ensureParagraphAfter(node);
      if (paragraph) this.placeCaret(paragraph, 'start');
    }
  }

  insertPageBreak() {
    const marker = makePageBreakBlock();
    const inserted = this.insertBlockNodes([marker], { focus: false });
    if (!inserted.length) return;
    this.app.afterMutation({ relayout: true, historyNow: true });
    const page = marker.closest('.a4-page');
    const next = page ? page.nextElementSibling : null;
    const content = next ? next.querySelector('.a4-content') : null;
    if (content) this.placeCaret(content, 'start');
    else this.app.paginator.focusLastPage();
  }

  insertHeaderMarker(text) {
    const marker = makeHeaderMarker(text);
    const inserted = this.insertBlockNodes([marker], { focus: false });
    if (!inserted.length) return;
    this.app.afterMutation({ relayout: true, historyNow: true });
    const next = marker.nextElementSibling;
    if (next) this.placeCaret(next, 'start');
    else {
      const paragraph = this.ensureParagraphAfter(marker);
      if (paragraph) this.placeCaret(paragraph, 'start');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Enlaces                                                            */
  /* ------------------------------------------------------------------ */

  getSelectedText() {
    const range = this.currentRange();
    return range ? range.toString() : '';
  }

  getLinkInfo() {
    const range = this.currentRange();
    if (!range) return null;
    const element = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    const anchor = element ? element.closest('a[href]') : null;
    if (!anchor) return null;
    return { href: anchor.getAttribute('href') || '', text: anchor.textContent || '' };
  }

  applyLink(url, text) {
    const href = safeLink(url);
    if (!href) return false;
    if (!this.ensureSelection()) return false;
    const range = this.currentRange();
    if (!range) return false;
    const element = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    const existing = element ? element.closest('a[href]') : null;
    if (existing) {
      existing.setAttribute('href', href);
      existing.setAttribute('target', '_blank');
      existing.setAttribute('rel', 'noopener noreferrer');
      if (range.collapsed && text) existing.textContent = text;
      this.app.afterMutation({ relayout: true, historyNow: true });
      return true;
    }
    const anchor = document.createElement('a');
    anchor.setAttribute('href', href);
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
    if (range.collapsed) {
      anchor.textContent = text || href;
      range.insertNode(anchor);
      const caret = document.createRange();
      caret.setStartAfter(anchor);
      caret.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(caret);
    } else {
      const fragment = range.extractContents();
      anchor.appendChild(fragment);
      range.insertNode(anchor);
      const selection = window.getSelection();
      const next = document.createRange();
      next.selectNodeContents(anchor);
      selection.removeAllRanges();
      selection.addRange(next);
    }
    this.app.afterMutation({ relayout: true, historyNow: true });
    return true;
  }

  removeLink() {
    const info = this.getLinkInfo();
    if (!info) return false;
    const range = this.currentRange();
    const element = range ? (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement) : null;
    const anchor = element ? element.closest('a[href]') : null;
    if (!anchor) return false;
    anchor.replaceWith(...Array.from(anchor.childNodes));
    this.app.afterMutation({ relayout: true, historyNow: true });
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Tablas: navegación con Tab                                         */
  /* ------------------------------------------------------------------ */

  moveTableCell(cell, backwards) {
    const table = cell.closest('table');
    if (!table) return;
    const cells = Array.from(table.querySelectorAll('th, td'));
    const index = cells.indexOf(cell);
    if (index < 0) return;
    if (!backwards && index === cells.length - 1) {
      const lastRow = table.querySelector('tbody tr:last-child') || table.rows[table.rows.length - 1];
      if (!lastRow) return;
      const newRow = lastRow.cloneNode(true);
      Array.from(newRow.children).forEach((newCell) => {
        newCell.innerHTML = '';
        newCell.appendChild(document.createElement('br'));
      });
      const tbody = table.querySelector('tbody') || table;
      tbody.appendChild(newRow);
      this.app.afterMutation({ relayout: true, historyNow: true });
      const first = newRow.querySelector('th, td');
      if (first) this.placeCaret(first, 'start');
      return;
    }
    const nextIndex = clamp(index + (backwards ? -1 : 1), 0, cells.length - 1);
    this.placeCaret(cells[nextIndex], 'start');
  }

  /* ------------------------------------------------------------------ */
  /* Estado de la barra de herramientas                                 */
  /* ------------------------------------------------------------------ */

  currentBlock() {
    const range = this.currentRange();
    if (!range) return null;
    return this.app.selection.topBlockOf(range.startContainer);
  }

  currentFontSize() {
    const range = this.currentRange();
    if (!range) return 11.5;
    const element = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    if (!element) return 11.5;
    const px = parseFloat(window.getComputedStyle(element).fontSize);
    return Number.isFinite(px) ? Math.round((px * 72 / 96) * 2) / 2 : 11.5;
  }

  syncToolbar() {
    const range = this.currentRange();
    if (!range) return;
    const block = this.currentBlock() || this.app.selection.caretContent();
    if (!block) return;

    const blockSelect = document.getElementById('blockStyle');
    if (blockSelect) {
      let value = 'p';
      if (block.tagName === 'BLOCKQUOTE') value = 'blockquote';
      else if (block.tagName === 'PRE') value = 'pre';
      else if (/^H[1-6]$/.test(block.tagName)) value = block.tagName.toLowerCase();
      blockSelect.value = value;
    }

    const sizeInput = document.getElementById('fontSizeInput');
    if (sizeInput && document.activeElement !== sizeInput) {
      const size = this.currentFontSize();
      sizeInput.value = String(Math.round(size * 10) / 10);
    }

    const familySelect = document.getElementById('fontFamily');
    if (familySelect && document.activeElement !== familySelect) {
      const element = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
      const family = element ? window.getComputedStyle(element).fontFamily : '';
      const normalized = family.toLowerCase().replace(/["']/g, '');
      const option = Array.from(familySelect.options).find((item) =>
        item.value && normalized.includes(item.value.toLowerCase().replace(/["']/g, ''))
      );
      familySelect.value = option ? option.value : '';
    }

    const state = (command) => {
      try { return document.queryCommandState(command); } catch (error) { return false; }
    };
    const computed = window.getComputedStyle(block);
    const textAlign = computed.textAlign || 'left';
    const listState = !!(block.closest && block.closest('ul, ol'));
    const isOrdered = !!(block.closest && block.closest('ol'));
    const states = {
      bold: state('bold'),
      italic: state('italic'),
      underline: state('underline'),
      strike: state('strikeThrough'),
      'align-left': textAlign === 'left' || textAlign === 'start',
      'align-center': textAlign === 'center',
      'align-right': textAlign === 'right' || textAlign === 'end',
      'align-justify': textAlign === 'justify',
      'bullet-list': listState && !isOrdered,
      'number-list': listState && isOrdered
    };
    this.pagesEl.ownerDocument.querySelectorAll('.fmt-toggle[data-action]').forEach((button) => {
      const action = button.getAttribute('data-action');
      if (Object.prototype.hasOwnProperty.call(states, action)) {
        button.setAttribute('aria-pressed', states[action] ? 'true' : 'false');
      }
    });

    const colorBar = document.getElementById('textColorBar');
    if (colorBar) colorBar.style.setProperty('--sw', computed.color || '#1f2937');
    const highlightBar = document.getElementById('highlightBar');
    if (highlightBar) {
      const background = computed.backgroundColor;
      highlightBar.style.setProperty('--sw', background && background !== 'rgba(0, 0, 0, 0)' ? background : '#fef08a');
    }

    const lineHeight = parseFloat(computed.lineHeight);
    const fontSize = parseFloat(computed.fontSize);
    const ratio = Number.isFinite(lineHeight) && Number.isFinite(fontSize) && fontSize > 0
      ? lineHeight / fontSize
      : 1.6;
    document.querySelectorAll('[data-line-spacing]').forEach((button) => {
      const value = Number(button.getAttribute('data-line-spacing'));
      button.setAttribute('aria-pressed', Math.abs(ratio - value) < 0.06 ? 'true' : 'false');
    });
    const marginBottomPt = (parseFloat(computed.marginBottom) || 0) * 72 / 96;
    document.querySelectorAll('[data-para-spacing]').forEach((button) => {
      const value = Number(button.getAttribute('data-para-spacing'));
      button.setAttribute('aria-pressed', Math.abs(marginBottomPt - value) < 0.7 ? 'true' : 'false');
    });
  }
}
