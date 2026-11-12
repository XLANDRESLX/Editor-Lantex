import { textNodesOf, uid } from './util.js';

const EXCLUDED_SELECTOR = '.katex, .math-block, .math-inline, .math-error, .doc-figure, .doc-float-image, .pagebreak-block, .hdr-marker, button';

/**
 * Guarda y restaura selecciones dentro del documento paginado.
 * La paginación mueve bloques de una hoja a otra, por lo que una selección
 * se representa por el id estable del bloque y un desplazamiento de texto.
 */
export class SelectionManager {
  constructor(pagesEl) {
    this.pagesEl = pagesEl;
    this.lastRange = null;
    this.bookmark = null;
    this.activeContent = null;
    this.backward = false;
  }

  isInPages(node) {
    if (!node) return false;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!(el && this.pagesEl.contains(el));
  }

  contentOf(node) {
    if (!node) return null;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return el ? el.closest('.a4-content') : null;
  }

  topBlockOf(node) {
    let el = node && node.nodeType === Node.ELEMENT_NODE ? node : (node ? node.parentElement : null);
    const content = el ? el.closest('.a4-content') : null;
    if (!content) return null;
    if (el === content) return content.firstElementChild || null;
    while (el && el.parentElement && el.parentElement !== content) el = el.parentElement;
    return el && el.parentElement === content ? el : null;
  }

  currentRange() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!this.isInPages(range.startContainer) || !this.isInPages(range.endContainer)) return null;
    return range;
  }

  save() {
    const sel = window.getSelection();
    const range = this.currentRange();
    if (!range) return null;
    this.lastRange = range.cloneRange();
    this.backward = !!(sel && sel.anchorNode && sel.focusNode &&
      (sel.anchorNode === range.endContainer || range.comparePoint(sel.anchorNode, sel.anchorOffset) > 0));
    this.bookmark = this.makeBookmark(range, this.backward);
    const content = this.contentOf(range.startContainer);
    if (content) this.activeContent = content;
    return this.bookmark;
  }

  /** Guarda explícitamente el rango actual (para menús y diálogos). */
  saveRange() {
    return this.save();
  }

  makeBookmark(range, backward = false) {
    let startBlock = this.topBlockOf(range.startContainer);
    let endBlock = this.topBlockOf(range.endContainer);
    if (!startBlock || !endBlock) return null;

    if (!startBlock.hasAttribute('data-bid')) {
      startBlock.setAttribute('data-bid', uid('b'));
    }
    if (!endBlock.hasAttribute('data-bid')) {
      endBlock.setAttribute('data-bid', uid('b'));
    }

    const startBid = startBlock.getAttribute('data-bid');
    const startMatches = this.pagesEl.querySelectorAll(`[data-bid="${startBid}"]`);
    if (startMatches.length > 1) {
      startBlock.setAttribute('data-bid', uid('b'));
    }

    const endBid = endBlock.getAttribute('data-bid');
    if (endBlock !== startBlock) {
      const endMatches = this.pagesEl.querySelectorAll(`[data-bid="${endBid}"]`);
      if (endMatches.length > 1) {
        endBlock.setAttribute('data-bid', uid('b'));
      }
    }

    const activePage = startBlock.closest('.a4-page');
    const pageIndex = activePage && activePage.parentElement
      ? Array.from(activePage.parentElement.children).indexOf(activePage)
      : 0;

    return {
      startBid: startBlock.getAttribute('data-bid'),
      startOffset: this.offsetInBlock(startBlock, range.startContainer, range.startOffset),
      endBid: endBlock.getAttribute('data-bid'),
      endOffset: this.offsetInBlock(endBlock, range.endContainer, range.endOffset),
      collapsed: range.collapsed,
      backward,
      pageIndex
    };
  }

  offsetInBlock(block, container, offset) {
    if (!block) return 0;
    try {
      const range = document.createRange();
      range.selectNodeContents(block);
      range.setEnd(container, offset);
      const fragment = range.cloneContents();
      if (fragment.querySelectorAll) {
        fragment.querySelectorAll(EXCLUDED_SELECTOR).forEach((el) => el.remove());
      }
      return (fragment.textContent || '').length;
    } catch (e) {
      return 0;
    }
  }

  blocksByBid(bid) {
    if (!bid) return [];
    const blocks = [];
    this.pagesEl.querySelectorAll('.a4-content > *[data-bid]').forEach((el) => {
      if (el.getAttribute('data-bid') === bid) blocks.push(el);
    });
    return blocks;
  }

  textInfo(block) {
    const nodes = textNodesOf(block);
    const total = nodes.reduce((acc, node) => acc + node.data.length, 0);
    return { nodes, total };
  }

  pointInBlocks(blocks, offset) {
    if (!blocks.length) return null;
    let remaining = Math.max(0, offset || 0);
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b];
      const { nodes, total } = this.textInfo(block);
      if (remaining <= total || (b === blocks.length - 1)) {
        if (!nodes.length) {
          return { node: block, offset: 0 };
        }
        let acc = 0;
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (remaining <= acc + node.data.length) {
            return { node, offset: Math.min(node.data.length, remaining - acc) };
          }
          acc += node.data.length;
        }
        const last = nodes[nodes.length - 1];
        return { node: last, offset: last.data.length };
      }
      remaining -= total;
    }
    return null;
  }

  restoreBookmark(bookmark, { focus = false } = {}) {
    if (!bookmark) return false;
    const startBlocks = this.blocksByBid(bookmark.startBid);
    if (!startBlocks.length) return false;
    const start = this.pointInBlocks(startBlocks, bookmark.startOffset);
    if (!start) return false;

    const endBlocks = bookmark.endBid === bookmark.startBid
      ? startBlocks
      : this.blocksByBid(bookmark.endBid);
    const end = endBlocks.length
      ? this.pointInBlocks(endBlocks, bookmark.endOffset)
      : start;
    if (!end) return false;

    const startContent = this.contentOf(start.node);
    if (!startContent) return false;

    const shouldFocus = focus || this.isInPages(window.getSelection()?.anchorNode);
    if (focus || shouldFocus) {
      try { startContent.focus({ preventScroll: true }); } catch (e) { startContent.focus(); }
    }
    const sel = window.getSelection();
    if (!sel) return false;
    try {
      sel.removeAllRanges();
      if (bookmark.backward) {
        sel.setBaseAndExtent(end.node, end.offset, start.node, start.offset);
      } else {
        sel.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
      }
      return true;
    } catch (e) {
      try {
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      } catch (err) {
        return false;
      }
    }
  }

  restoreSavedRange() {
    if (this.lastRange && this.lastRange.startContainer && this.lastRange.startContainer.isConnected &&
        this.lastRange.endContainer && this.lastRange.endContainer.isConnected) {
      const content = this.contentOf(this.lastRange.startContainer);
      if (content) {
        try { content.focus({ preventScroll: true }); } catch (e) { /* noop */ }
        const sel = window.getSelection();
        try {
          sel.removeAllRanges();
          sel.addRange(this.lastRange);
          return true;
        } catch (e) { /* recurre al marcador */ }
      }
    }
    return this.restoreBookmark(this.bookmark, { focus: true });
  }

  restoreBeforeInsert() {
    if (this.restoreSavedRange()) return true;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && this.isInPages(sel.anchorNode)) return true;
    const lastPage = this.pagesEl.querySelector('.a4-page:last-child .a4-content');
    if (!lastPage) return false;
    lastPage.focus();
    const range = document.createRange();
    range.selectNodeContents(lastPage);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  caretContent() {
    const range = this.currentRange();
    const content = range ? this.contentOf(range.startContainer) : null;
    if (content) return content;
    if (this.activeContent && this.activeContent.isConnected) return this.activeContent;
    return this.pagesEl.querySelector('.a4-page:last-child .a4-content');
  }

  caretRange() {
    return this.currentRange();
  }

  selectionRect() {
    const range = this.currentRange();
    if (!range) return null;
    const rects = range.getClientRects();
    if (rects.length) return rects[rects.length - 1];
    return range.getBoundingClientRect();
  }

  clearBookmark() {
    this.bookmark = null;
    this.lastRange = null;
  }
}
