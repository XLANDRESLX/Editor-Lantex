import { escapeHtml, num, uid, textNodesOf } from './util.js';
import { MathWrap } from './parser.js';

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE',
  'BLOCKQUOTE', 'PRE', 'HR', 'FIGURE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER'
]);

/**
 * Convierte el contenido editable de todas las hojas en una secuencia de
 * bloques y los vuelve a distribuir en páginas A4 reales. Los bloques se
 * mueven (nunca se clonan) para conservar la identidad de los nodos y el foco.
 */
export class Paginator {
  constructor(app) {
    this.app = app;
    this.pagesEl = app.pagesEl;
    this.settings = app.settings;
    this.busy = false;
    this.pending = false;
    this.pageContents = [];
    this.lastPageCount = 0;
    this.relayoutCount = 0;
  }

  setSettings(settings) {
    this.settings = settings;
  }

  getScale() {
    const page = this.pagesEl.querySelector('.a4-page');
    if (!page) return this.app.zoomScale || 1;
    const width = page.getBoundingClientRect().width;
    const natural = page.offsetWidth;
    if (!natural) return 1;
    return width / natural || 1;
  }

  hasOverflow() {
    for (const content of this.pagesEl.querySelectorAll('.a4-content')) {
      if (this.overflows(content)) return true;
    }
    return false;
  }

  /** Rehace la paginación completa de forma síncrona. */
  relayout(options = {}) {
    if (this.busy) {
      this.pending = true;
      return;
    }
    this.busy = true;
    const preserveSelection = options.preserveSelection !== false;
    let bookmark = null;
    let focusWasInPages = false;
    try {
      const active = document.activeElement;
      focusWasInPages = !!(active && active.closest && active.closest('.a4-content'));
      if (this.app.selection) {
        if (preserveSelection) {
          bookmark = this.app.selection.save();
          if (this.app.selection.isInPages(window.getSelection()?.anchorNode)) focusWasInPages = true;
        }
      }

      const scrollTop = this.app.pagesWrap.scrollTop;
      const floats = this.app.images && typeof this.app.images.detachFloats === 'function'
        ? this.app.images.detachFloats()
        : [];

      const blocks = this.collectFlow();
      this.buildPages(blocks);
      this.computePageHeadersAndFooters();

      if (this.app.images && typeof this.app.images.attachFloats === 'function') {
        this.app.images.attachFloats(floats, this.pagesEl.querySelectorAll('.a4-page').length);
      }

      this.assignBids();
      this.pageContents = Array.from(this.pagesEl.querySelectorAll('.a4-content'));
      this.lastPageCount = this.pagesEl.querySelectorAll('.a4-page').length;

      if (preserveSelection && bookmark && this.app.selection) {
        const restored = this.app.selection.restoreBookmark(bookmark, { focus: focusWasInPages });
        if (!restored) {
          // Si el bloque no se pudo emparejar, conserva el foco en la hoja activa donde estaba el usuario, no en la primera
          const targetIndex = typeof bookmark.pageIndex === 'number'
            ? Math.min(Math.max(0, bookmark.pageIndex), this.pageContents.length - 1)
            : 0;
          const content = this.pageContents[targetIndex] || this.pageContents[0];
          if (content && focusWasInPages) {
            try { content.focus({ preventScroll: true }); } catch (e) { content.focus(); }
            const last = content.lastElementChild || content;
            const r = document.createRange();
            r.selectNodeContents(last);
            r.collapse(false);
            const s = window.getSelection();
            if (s) {
              s.removeAllRanges();
              s.addRange(r);
            }
          }
        }
      }

      this.app.pagesWrap.scrollTop = scrollTop;
      this.relayoutCount += 1;
      this.app.onLayoutComplete?.({ focusWasInPages, preserveSelection });
    } catch (error) {
      console.error('[Lantex] Error de paginación:', error);
      this.app.onLayoutError?.(error);
    } finally {
      this.busy = false;
      if (this.pending) {
        this.pending = false;
        queueMicrotask(() => this.relayout(options));
      }
    }
  }

  collectFlow() {
    const blocks = [];
    const contents = Array.from(this.pagesEl.querySelectorAll('.a4-content'));
    for (const content of contents) {
      let inlineBuffer = [];
      const flushInline = () => {
        const meaningful = inlineBuffer.filter((node) =>
          node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && node.data.trim())
        );
        inlineBuffer = [];
        if (!meaningful.length) return;
        const p = document.createElement('p');
        meaningful.forEach((node) => p.appendChild(node));
        blocks.push(this.normalizeBlock(p));
      };

      Array.from(content.childNodes).forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (this.isBlockNode(node)) {
            flushInline();
            if (node.tagName === 'LI') {
              const ul = document.createElement('ul');
              ul.appendChild(node);
              blocks.push(this.normalizeBlock(ul));
            } else {
              blocks.push(this.normalizeBlock(node));
            }
            return;
          }
        } else if (node.nodeType === Node.TEXT_NODE && !node.data.trim()) {
          return;
        }
        inlineBuffer.push(node);
      });
      flushInline();
    }

    const merged = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.hasAttribute && block.hasAttribute('data-split-tail')) {
        const id = block.getAttribute('data-split-tail');
        const prev = merged[merged.length - 1];
        if (prev && prev.getAttribute('data-split-head') === id) {
          this.mergeSplitPair(prev, block);
          continue;
        }
        block.removeAttribute('data-split-tail');
        block.classList.remove('split-tail');
      }
      merged.push(block);
    }
    return merged;
  }

  isBlockNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.classList && (
      node.classList.contains('pagebreak-block') ||
      node.classList.contains('hdr-marker') ||
      node.classList.contains('math-block') ||
      node.classList.contains('doc-figure')
    )) return true;
    return BLOCK_TAGS.has(node.tagName);
  }

  normalizeBlock(node) {
    if (!node) return node;
    if (!node.hasAttribute('data-bid')) node.setAttribute('data-bid', uid('b'));
    if (node.tagName === 'DIV' && !node.className) {
      const hasBlock = Array.from(node.children).some((child) =>
        BLOCK_TAGS.has(child.tagName) || (child.classList && (child.classList.contains('math-block') || child.classList.contains('doc-figure')))
      );
      if (!hasBlock) {
        const p = document.createElement('p');
        Array.from(node.attributes).forEach((attr) => p.setAttribute(attr.name, attr.value));
        while (node.firstChild) p.appendChild(node.firstChild);
        return p;
      }
    }
    if (node.tagName === 'SECTION' || node.tagName === 'ARTICLE' || node.tagName === 'HEADER' || node.tagName === 'FOOTER') {
      node.removeAttribute('contenteditable');
    }
    return node;
  }

  mergeSplitPair(head, tail) {
    if (!head || !tail) return;
    const sameTag = head.tagName === tail.tagName;
    if (!sameTag) {
      head.removeAttribute('data-split-head');
      tail.removeAttribute('data-split-tail');
      return;
    }
    if (head.tagName === 'UL' || head.tagName === 'OL') {
      Array.from(tail.children).forEach((li) => {
        if (li.tagName === 'LI') head.appendChild(li);
      });
    } else if (head.tagName === 'TABLE') {
      const tailThead = tail.querySelector('thead');
      if (tailThead) tailThead.remove();
      const headBody = head.querySelector('tbody') || head;
      const tailBody = tail.querySelector('tbody');
      const source = tailBody || tail;
      Array.from(source.children).forEach((row) => {
        if (row.tagName === 'TR') headBody.appendChild(row);
      });
    } else if (head.tagName === 'PRE') {
      const code = head.querySelector('code') || head;
      const tailCode = tail.querySelector('code') || tail;
      code.textContent = code.textContent + tailCode.textContent;
    } else {
      while (tail.firstChild) head.appendChild(tail.firstChild);
    }
    head.removeAttribute('data-split-head');
    head.classList.remove('split-head');
    tail.removeAttribute('data-split-tail');
    tail.classList.remove('split-tail');
  }

  createPage() {
    const page = document.createElement('section');
    page.className = 'a4-page';
    const header = document.createElement('div');
    header.className = 'a4-header';
    const content = document.createElement('div');
    content.className = 'a4-content';
    content.setAttribute('contenteditable', 'true');
    content.setAttribute('spellcheck', 'true');
    content.setAttribute('role', 'textbox');
    content.setAttribute('aria-multiline', 'true');
    content.setAttribute('data-page-content', '1');
    const footer = document.createElement('div');
    footer.className = 'a4-footer';
    page.append(header, content, footer);
    return { page, header, content, footer };
  }

  buildPages(blocks) {
    this.pagesEl.replaceChildren();
    let pageIndex = 0;
    let current = this.createPage();
    this.pagesEl.appendChild(current.page);
    pageIndex += 1;

    const queue = blocks.slice();
    let i = 0;
    let guard = 0;
    const maxIterations = Math.max(300, queue.length * 8);

    const newPage = () => {
      current = this.createPage();
      this.pagesEl.appendChild(current.page);
      pageIndex += 1;
    };

    while (i < queue.length && guard++ < maxIterations) {
      const block = queue[i];
      if (!block || !block.isConnected) {
        // Los nodos siguen referenciados por el arreglo aunque estén en un DOM
        // separado; isConnected solo es falso para nodos eliminados a mano.
      }

      if (block.classList && block.classList.contains('pagebreak-block')) {
        current.content.appendChild(block);
        newPage();
        i += 1;
        continue;
      }

      current.content.appendChild(block);

      // Ajusta fórmulas display largas antes de medir la altura del bloque.
      if (block.matches && (block.matches('.math-block') || block.querySelector('.math-block'))) {
        MathWrap.run(current.content);
      }

      if (!this.overflows(current.content)) {
        if (this.isHeading(block)) {
          const contentRect = current.content.getBoundingClientRect();
          const rect = block.getBoundingClientRect();
          const scale = this.getScale();
          const lineHeight = num(getComputedStyle(block).lineHeight, 16) * scale;
          const hasPrior = this.hasPriorFlow(current.content, block);
          if (hasPrior && contentRect.bottom - rect.bottom < lineHeight * 2.1 && i + 1 < queue.length) {
            current.content.removeChild(block);
            newPage();
            continue;
          }
        }
        i += 1;
        continue;
      }

      // Hay desbordamiento. Intenta repartir el bloque por líneas/filas.
      const split = this.splitBlockToFit(block, current.content);
      if (split && split.tail) {
        queue.splice(i + 1, 0, split.tail);
        newPage();
        i += 1;
        continue;
      }

      // Si la hoja ya tenía contenido, mueve el bloque entero a una hoja nueva.
      if (this.hasPriorFlow(current.content, block)) {
        current.content.removeChild(block);
        newPage();
        continue;
      }

      // El bloque no se puede partir y ocupa más que una hoja: se conserva
      // completo (la hoja recorta visualmente solo lo imposible de dividir).
      i += 1;
      if (i < queue.length) newPage();
    }

    // Elimina hojas extra creadas por un salto final sin contenido adicional
    // (se conserva una hoja en blanco intencional después de un salto manual).
    this.ensureEmptyPagesEditable();
    if (!this.pagesEl.querySelector('.a4-page')) {
      current = this.createPage();
      this.pagesEl.appendChild(current.page);
      this.ensureEmptyPagesEditable();
    }
    this.pagesEl.querySelectorAll('.a4-page').forEach((page, index) => {
      page.setAttribute('data-page-index', String(index));
      page.setAttribute('data-page-label', '');
      const content = page.querySelector('.a4-content');
      if (content) content.setAttribute('aria-label', 'Página ' + (index + 1) + ' editable');
    });
  }

  ensureEmptyPagesEditable() {
    this.pagesEl.querySelectorAll('.a4-content').forEach((content) => {
      const visible = Array.from(content.children).filter((child) =>
        !child.classList.contains('pagebreak-block') &&
        !child.classList.contains('hdr-marker') &&
        !child.classList.contains('image-anchor')
      );
      if (!visible.length) {
        const p = document.createElement('p');
        p.setAttribute('data-bid', uid('b'));
        p.appendChild(document.createElement('br'));
        content.appendChild(p);
      }
    });
  }

  isHeading(el) {
    return !!(el && /^H[1-6]$/.test(el.tagName));
  }

  hasPriorFlow(content, block) {
    return Array.from(content.children).some((child) =>
      child !== block &&
      !child.classList.contains('pagebreak-block') &&
      !child.classList.contains('hdr-marker') &&
      !child.classList.contains('image-anchor')
    );
  }

  overflows(content) {
    const contentRect = content.getBoundingClientRect();
    if (!contentRect.height) return false;
    for (const child of content.children) {
      if (child.classList.contains('pagebreak-block') || child.classList.contains('hdr-marker') ||
          child.classList.contains('image-anchor')) continue;
      const rect = child.getBoundingClientRect();
      if (rect.height > 0.5 && rect.bottom > contentRect.bottom + 0.75) return true;
    }
    return false;
  }

  splitBlockToFit(block, content) {
    if (!block || block.nodeType !== Node.ELEMENT_NODE) return null;
    if (block.classList.contains('pagebreak-block') || block.classList.contains('hdr-marker') ||
        block.classList.contains('image-anchor')) return null;
    if (block.classList.contains('math-block') || block.classList.contains('doc-figure')) return null;
    if (block.querySelector('.doc-figure, .doc-float-image, table, blockquote, pre, ul, ol')) {
      if (block.tagName !== 'TABLE' && block.tagName !== 'PRE' && block.tagName !== 'UL' && block.tagName !== 'OL') return null;
    }
    const tag = block.tagName;
    if (tag === 'P' || tag === 'DIV') return this.splitTextBlock(block, content);
    if (tag === 'UL' || tag === 'OL') return this.splitListBlock(block, content);
    if (tag === 'TABLE') return this.splitTableBlock(block, content);
    if (tag === 'PRE') return this.splitPreBlock(block, content);
    return null;
  }

  contentBottom(content) {
    return content.getBoundingClientRect().bottom - 0.75;
  }

  splitTextBlock(block, content) {
    const textNodes = textNodesOf(block);
    if (!textNodes.length) return null;
    let allText = '';
    textNodes.forEach((node) => { allText += node.data; });
    if (allText.trim().length < 32) return null;

    const scale = this.getScale();
    const lineHeight = num(getComputedStyle(block).lineHeight, 16) * scale;
    const blockRect = block.getBoundingClientRect();
    const limit = this.contentBottom(content);
    if (limit - blockRect.top < lineHeight * 2) return null;
    const fullHeight = blockRect.height;
    if (fullHeight < lineHeight * 4) return null;

    const range = document.createRange();
    const locate = (count) => {
      let acc = 0;
      for (let idx = 0; idx < textNodes.length; idx++) {
        const node = textNodes[idx];
        const len = node.data.length;
        if (count <= acc + len) return { index: idx, node, offset: Math.max(0, Math.min(len, count - acc)) };
        acc += len;
      }
      const last = textNodes[textNodes.length - 1];
      return { index: textNodes.length - 1, node: last, offset: last.data.length };
    };
    const bottomAt = (count) => {
      const point = locate(count);
      try {
        range.selectNodeContents(block);
        range.setEnd(point.node, point.offset);
        const rect = range.getBoundingClientRect();
        return rect.bottom;
      } catch (e) {
        return Infinity;
      }
    };

    let lo = 1, hi = allText.length, best = 0, guard = 0;
    while (lo <= hi && guard++ < 34) {
      const mid = (lo + hi) >> 1;
      if (bottomAt(mid) <= limit) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (best < 4) return null;

    // Retrocede hasta un límite de palabra para no cortar a mitad de palabra.
    let snap = best;
    let guard2 = 0;
    while (snap > 1 && guard2++ < 90) {
      if (/\s/.test(allText[snap - 1])) break;
      snap -= 1;
    }
    const headText = allText.slice(0, snap).trim();
    const tailText = allText.slice(snap).trim();
    if (headText.length < 2 || tailText.length < 2) return null;

    const headBottom = bottomAt(snap);
    const headHeight = headBottom - blockRect.top;
    if (headHeight < lineHeight * 1.7) return null;
    if (fullHeight - headHeight < lineHeight * 1.3) return null;

    const point = locate(snap);
    const head = block.cloneNode(true);
    const tail = block.cloneNode(true);
    const headNodes = textNodesOf(head);
    const tailNodes = textNodesOf(tail);
    if (headNodes.length !== textNodes.length || tailNodes.length !== textNodes.length) return null;
    if (!headNodes[point.index] || !tailNodes[point.index]) return null;

    try {
      const headRange = document.createRange();
      headRange.selectNodeContents(head);
      headRange.setStart(headNodes[point.index], point.offset);
      headRange.deleteContents();

      const tailRange = document.createRange();
      tailRange.selectNodeContents(tail);
      tailRange.setEnd(tailNodes[point.index], point.offset);
      tailRange.deleteContents();
    } catch (e) {
      return null;
    }

    this.cleanSplitEdges(head, 'end');
    this.cleanSplitEdges(tail, 'start');
    if (!this.hasVisibleContent(head) || !this.hasVisibleContent(tail)) return null;

    const bid = block.getAttribute('data-bid') || uid('b');
    const splitId = uid('split');
    head.setAttribute('data-split-head', splitId);
    tail.setAttribute('data-split-tail', splitId);
    head.setAttribute('data-bid', bid);
    tail.setAttribute('data-bid', bid);
    head.classList.add('split-head');
    tail.classList.add('split-tail');
    block.replaceWith(head);
    return { head, tail };
  }

  cleanSplitEdges(el, edge) {
    const removable = (n) => n.nodeType === 1 &&
      !n.textContent.trim() &&
      !n.querySelector('img, svg, br, .katex, .math-inline') &&
      !/^(TABLE|TD|TH|TR|PRE|UL|OL|LI|DIV|SECTION|ARTICLE)$/.test(n.tagName);
    let guard = 0;
    while (guard++ < 60) {
      const nodes = Array.from(el.childNodes);
      if (edge === 'start') nodes.reverse();
      let removed = false;
      for (const node of nodes) {
        const atEdge = edge === 'start' ? node === el.firstChild : node === el.lastChild;
        if (!atEdge) continue;
        if (node.nodeType === 3 && !node.data.trim()) { el.removeChild(node); removed = true; break; }
        if (removable(node)) { el.removeChild(node); removed = true; break; }
      }
      if (!removed) break;
    }
  }

  hasVisibleContent(el) {
    if (el.querySelector('img, .math-inline, .math-block, br')) return true;
    return !!el.textContent.trim();
  }

  splitListBlock(list, content) {
    const items = Array.from(list.children).filter((c) => c.tagName === 'LI');
    if (items.length < 2) return null;
    const limit = this.contentBottom(content);
    const rects = items.map((li) => li.getBoundingClientRect());
    let k = 0;
    for (let i = 0; i < items.length - 1; i++) {
      if (rects[i].bottom <= limit) k = i + 1;
    }
    if (k <= 0 || k >= items.length) return null;
    if (rects[k - 1].bottom - rects[0].top < 12) return null;

    const head = list.cloneNode(false);
    const tail = list.cloneNode(false);
    items.forEach((li, index) => (index < k ? head : tail).appendChild(li.cloneNode(true)));
    if (list.tagName === 'OL') {
      const start = Number(list.getAttribute('start')) || 1;
      tail.setAttribute('start', String(start + k));
    }
    const bid = list.getAttribute('data-bid') || uid('b');
    const splitId = uid('split');
    head.setAttribute('data-split-head', splitId);
    tail.setAttribute('data-split-tail', splitId);
    head.setAttribute('data-bid', bid);
    tail.setAttribute('data-bid', bid);
    head.classList.add('split-head');
    tail.classList.add('split-tail');
    list.replaceWith(head);
    return { head, tail };
  }

  splitTableBlock(table, content) {
    const tbody = table.querySelector('tbody');
    const rows = Array.from((tbody || table).children).filter((c) => c.tagName === 'TR');
    if (rows.length < 2) return null;
    const thead = table.querySelector('thead');
    const headH = thead ? thead.getBoundingClientRect().height : 0;
    const limit = this.contentBottom(content);
    const rects = rows.map((row) => row.getBoundingClientRect());
    let k = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      if (rects[i].bottom <= limit) k = i + 1;
    }
    if (k <= 0 || k >= rows.length) return null;
    if (headH + (rects[k - 1].bottom - rects[0].top) < 16) return null;

    const head = table.cloneNode(false);
    const tail = table.cloneNode(false);
    const colgroup = table.querySelector('colgroup');
    if (colgroup) {
      head.appendChild(colgroup.cloneNode(true));
      tail.appendChild(colgroup.cloneNode(true));
    }
    if (thead) {
      head.appendChild(thead.cloneNode(true));
      tail.appendChild(thead.cloneNode(true));
    }
    const hBody = document.createElement('tbody');
    const tBody = document.createElement('tbody');
    rows.forEach((row, index) => (index < k ? hBody : tBody).appendChild(row.cloneNode(true)));
    head.appendChild(hBody);
    tail.appendChild(tBody);
    const bid = table.getAttribute('data-bid') || uid('b');
    const splitId = uid('split');
    head.setAttribute('data-split-head', splitId);
    tail.setAttribute('data-split-tail', splitId);
    head.setAttribute('data-bid', bid);
    tail.setAttribute('data-bid', bid);
    head.classList.add('split-head');
    tail.classList.add('split-tail');
    table.replaceWith(head);
    return { head, tail };
  }

  splitPreBlock(pre, content) {
    const code = pre.querySelector('code') || pre;
    const source = code.textContent || '';
    const lines = source.split('\n');
    if (lines.length < 4) return null;
    const scale = this.getScale();
    const style = getComputedStyle(pre);
    const lineHeight = num(style.lineHeight, 16) * scale;
    const padding = num(style.paddingTop) + num(style.paddingBottom) + num(style.borderTopWidth) + num(style.borderBottomWidth);
    const available = this.contentBottom(content) - pre.getBoundingClientRect().top;
    if (available < lineHeight * 3) return null;
    let fitLines = Math.floor((available - padding * scale) / lineHeight);
    if (fitLines < 2) return null;
    fitLines = Math.min(fitLines, lines.length - 2);
    if (fitLines < 1) return null;

    const head = pre.cloneNode(false);
    const tail = pre.cloneNode(false);
    const hCode = document.createElement('code');
    const tCode = document.createElement('code');
    hCode.textContent = lines.slice(0, fitLines).join('\n');
    tCode.textContent = lines.slice(fitLines).join('\n');
    head.appendChild(hCode);
    tail.appendChild(tCode);
    const bid = pre.getAttribute('data-bid') || uid('b');
    const splitId = uid('split');
    head.setAttribute('data-split-head', splitId);
    tail.setAttribute('data-split-tail', splitId);
    head.setAttribute('data-bid', bid);
    tail.setAttribute('data-bid', bid);
    head.classList.add('split-head');
    tail.classList.add('split-tail');
    pre.replaceWith(head);
    return { head, tail };
  }

  computePageHeadersAndFooters() {
    const pages = Array.from(this.pagesEl.querySelectorAll('.a4-page'));
    const total = pages.length;
    const settings = this.settings || {};
    const groups = pages.map((page) => {
      const content = page.querySelector('.a4-content');
      return content ? Array.from(content.children) : [];
    });
    const headers = this.computeHeaders(groups);
    pages.forEach((page, index) => {
      const header = page.querySelector('.a4-header');
      const footer = page.querySelector('.a4-footer');
      const leftHeader = settings.header || '';
      const rightHeader = headers[index] || '';
      const leftFooter = settings.footer || '';
      if (header) {
        if (leftHeader || rightHeader) {
          header.innerHTML = '<span>' + escapeHtml(leftHeader) + '</span><span>' + escapeHtml(rightHeader) + '</span>';
        } else {
          header.innerHTML = '';
        }
      }
      if (footer) {
        footer.innerHTML = '<span>' + escapeHtml(leftFooter) + '</span><span>Página ' + (index + 1) + ' de ' + total + '</span>';
      }
      page.setAttribute('data-page-index', String(index));
      page.setAttribute('data-page-label', '');
    });
    this.lastPageCount = total;
  }

  computeHeaders(groups) {
    const isMarker = (node) => node.classList && node.classList.contains('hdr-marker');
    let state = '';
    return groups.map((nodes) => {
      let lastContent = -1;
      nodes.forEach((node, index) => { if (!isMarker(node)) lastContent = index; });
      let own = null;
      let last = state;
      nodes.forEach((node, index) => {
        if (!isMarker(node)) return;
        last = node.getAttribute('data-hdr') || '';
        if (own === null && index < lastContent) own = last;
      });
      const value = own !== null ? own : state;
      state = last;
      return value;
    });
  }

  assignBids() {
    this.pagesEl.querySelectorAll('.a4-content').forEach((content) => {
      Array.from(content.children).forEach((child) => {
        if (!child.hasAttribute('data-bid')) child.setAttribute('data-bid', uid('b'));
        child.removeAttribute('data-selected');
      });
    });
  }

  focusLastPage() {
    const content = this.pagesEl.querySelector('.a4-page:last-child .a4-content');
    if (!content) return;
    content.focus({ preventScroll: false });
    const range = document.createRange();
    range.selectNodeContents(content);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}
