import { escapeHtml, escapeAttr, uid } from './util.js';

/* Salto de página explícito en Markdown. Se conserva como marcador visual. */
const PAGEBREAK_RE = /(\n[ \t]*(?:\\(?:pagebreak|newpage|page-break)\b|<!--\s*pagebreak\s*-->)[ \t]*)(?=\n|$)/g;
const PAGEBREAK_ONLY_RE = /^\s*(?:\\(?:pagebreak|newpage|page-break)\b|<!--\s*pagebreak\s*-->)\s*$/i;
const HDR_RE = /^[ \t]*['\u2019\u2018]{5}([^\n]*?)['\u2019\u2018]{5}[ \t]*$/gm;

const KATEX_MACROS = {
  '\\R': '\\mathbb{R}', '\\N': '\\mathbb{N}', '\\Z': '\\mathbb{Z}',
  '\\Q': '\\mathbb{Q}', '\\C': '\\mathbb{C}', '\\Ind': '\\mathbb{1}',
  '\\abs': '\\left\\lvert #1 \\right\\rvert',
  '\\norm': '\\left\\lVert #1 \\right\\rVert',
  '\\set': '\\left\\{ #1 \\right\\}',
  '\\paren': '\\left( #1 \\right)',
  '\\avg': '\\overline{#1}',
  '\\euler': '\\mathrm{e}',
  '\\ddx': '\\,\\mathrm{d}x',
  '\\dydx': '\\frac{\\mathrm{d}y}{\\mathrm{d}x}'
};

const MARKED_OPTIONS = { gfm: true, breaks: false };

const ALLOWED_TAGS = new Set([
  'A', 'ABBR', 'B', 'BLOCKQUOTE', 'BR', 'CAPTION', 'CITE', 'CODE', 'COL', 'COLGROUP',
  'DD', 'DEL', 'DIV', 'DL', 'DT', 'EM', 'FIGCAPTION', 'FIGURE', 'FONT', 'H1', 'H2',
  'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'INS', 'KBD', 'LI', 'MARK', 'OL', 'P',
  'PRE', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP', 'TABLE',
  'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'U', 'UL', 'VAR'
]);

const DROP_WITH_CONTENT = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'APPLET', 'FORM', 'INPUT', 'TEXTAREA',
  'SELECT', 'BUTTON', 'VIDEO', 'AUDIO', 'CANVAS', 'svg', 'SVG', 'META', 'LINK', 'TEMPLATE'
]);

const ALLOWED_STYLE_PROPS = new Set([
  'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-decoration', 'text-decoration-line', 'text-align', 'line-height', 'margin-left',
  'margin-top', 'margin-bottom', 'padding-left', 'border', 'border-top', 'border-bottom',
  'border-left', 'border-right', 'border-collapse', 'vertical-align', 'white-space',
  'min-width', 'max-width', 'width', 'height'
]);

const ALLOWED_DATA_ATTRS = new Set(['data-tex', 'data-mode', 'data-align', 'data-width', 'data-hdr']);
const ALLOWED_CLASSES = new Set(['math-block', 'math-inline', 'math-error', 'doc-figure', 'doc-inline-img', 'doc-float-image', 'doc-image', 'pagebreak-block', 'hdr-marker']);

function isSafeUri(value, { image = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (image && /^data:image\/(png|jpe?g|webp|gif|svg\+xml);/i.test(raw)) return true;
  if (/^data:/i.test(raw)) return false;
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(raw)) return true;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return true;
  return false;
}

function cleanStyle(styleText) {
  const keep = [];
  String(styleText || '').split(';').forEach((decl) => {
    const idx = decl.indexOf(':');
    if (idx < 0) return;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop)) return;
    if (!value || /expression\s*\(|javascript:|url\s*\(|@import|behavior\s*:/i.test(value)) return;
    keep.push(`${prop}: ${value}`);
  });
  return keep.join('; ');
}

/**
 * Sanitiza HTML pegado o generado. Elimina scripts, manejadores de eventos,
 * URIs peligrosas y estilos no permitidos sin destruir la estructura del documento.
 */
export function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const root = tpl.content;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const elements = [];
  let node;
  while ((node = walker.nextNode())) elements.push(node);

  elements.forEach((el) => {
    const tag = el.tagName.toUpperCase();

    if (DROP_WITH_CONTENT.has(tag) || tag === 'SVG' || tag === 'MATH') {
      el.remove();
      return;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Conserva el contenido de etiquetas desconocidas, pero no la etiqueta.
      const frag = document.createDocumentFragment();
      while (el.firstChild) frag.appendChild(el.firstChild);
      el.replaceWith(frag);
      return;
    }

    // Atributos peligrosos
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith('on')) { el.removeAttribute(attr.name); return; }
      if (name === 'style') {
        const cleaned = cleanStyle(value);
        if (cleaned) el.setAttribute('style', cleaned);
        else el.removeAttribute('style');
        return;
      }
      if (name === 'class') {
        const classes = String(value).split(/\s+/).filter((c) => ALLOWED_CLASSES.has(c));
        if (classes.length) el.setAttribute('class', classes.join(' '));
        else el.removeAttribute('class');
        return;
      }
      if (name.startsWith('data-')) {
        if (!ALLOWED_DATA_ATTRS.has(name)) el.removeAttribute(attr.name);
        return;
      }
      if (name === 'href') {
        if (!isSafeUri(value)) el.removeAttribute(attr.name);
        return;
      }
      if (name === 'src') {
        if (!isSafeUri(value, { image: true })) el.removeAttribute(attr.name);
        return;
      }
      if (name === 'srcset' || name === 'formaction' || name === 'action' || name === 'poster' || name === 'ping') {
        el.removeAttribute(attr.name);
        return;
      }
      if (name === 'target') {
        if (value !== '_blank') el.removeAttribute(attr.name);
        else el.setAttribute('rel', 'noopener noreferrer');
        return;
      }
      if (!['alt', 'title', 'colspan', 'rowspan', 'start', 'reversed', 'align', 'width', 'height',
        'face', 'color', 'size', 'aria-label', 'role', 'rel', 'lang', 'dir'].includes(name)) {
        el.removeAttribute(attr.name);
      }
    });

    if (tag === 'IMG') {
      el.setAttribute('draggable', 'false');
      if (!el.getAttribute('alt')) el.setAttribute('alt', '');
    }
    if (tag === 'A') {
      el.setAttribute('rel', 'noopener noreferrer');
    }
    if (tag === 'FONT') {
      const span = document.createElement('span');
      const color = el.getAttribute('color');
      const face = el.getAttribute('face');
      const style = [];
      if (color) style.push('color: ' + color);
      if (face) style.push('font-family: ' + face.replace(/[";]/g, ''));
      if (style.length) span.setAttribute('style', style.join('; '));
      while (el.firstChild) span.appendChild(el.firstChild);
      el.replaceWith(span);
    }
  });

  return tpl.innerHTML;
}

export function makePageBreakBlock() {
  const div = document.createElement('div');
  div.className = 'pagebreak-block';
  div.setAttribute('contenteditable', 'false');
  div.setAttribute('data-pagebreak', '1');
  div.setAttribute('data-bid', uid('pb'));
  div.innerHTML = '<span class="pagebreak-label">Salto de página<button type="button" class="marker-remove" data-remove-marker="pagebreak" title="Quitar salto de página" aria-label="Quitar salto de página">×</button></span>';
  return div;
}

export function makeHeaderMarker(text) {
  const div = document.createElement('div');
  div.className = 'hdr-marker';
  div.setAttribute('contenteditable', 'false');
  div.setAttribute('data-hdr', String(text || '').trim());
  div.setAttribute('data-bid', uid('hdr'));
  div.innerHTML = '<span class="hdr-marker-label">Cabecera: <em>' + escapeHtml(String(text || '').trim()) + '</em><button type="button" class="marker-remove" data-remove-marker="header" title="Quitar cabecera" aria-label="Quitar cabecera">×</button></span>';
  return div;
}

export const Parser = {
  errors: 0,
  macrosOk: true,

  extractMath(src) {
    const tokens = [];
    let out = '';
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\' && src[i + 1] === '$') { out += '$'; i += 2; continue; }
      if (ch === '$' && src[i + 1] === '$') {
        const end = src.indexOf('$$', i + 2);
        if (end > -1) {
          tokens.push({ type: 'block', tex: src.slice(i + 2, end) });
          out += '\uE000B' + (tokens.length - 1) + '\uE001\n';
          i = end + 2;
          continue;
        }
      }
      if (ch === '$') {
        const nl = src.indexOf('\n', i);
        const limit = nl === -1 ? src.length : nl;
        const close = src.indexOf('$', i + 1);
        if (close > i && close < limit) {
          tokens.push({ type: 'inline', tex: src.slice(i + 1, close) });
          out += '\uE000I' + (tokens.length - 1) + '\uE001';
          i = close + 1;
          continue;
        }
      }
      out += ch;
      i++;
    }
    return { text: out, tokens };
  },

  katexHtml(tex, display) {
    if (!window.katex) return null;
    const opts = {
      displayMode: !!display,
      output: 'htmlAndMathml',
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      maxExpand: 2000,
      maxSize: 64
    };
    if (this.macrosOk) {
      try { return window.katex.renderToString(tex, Object.assign({ macros: KATEX_MACROS }, opts)); }
      catch (e) { this.macrosOk = false; }
    }
    try { return window.katex.renderToString(tex, opts); }
    catch (e) { return null; }
  },

  injectMath(html, tokens) {
    const self = this;
    html = html.replace(/<p>\s*\uE000B(\d+)\uE001\s*<\/p>/g, (m, id) =>
      self.renderMath(tokens[+id] ? tokens[+id].tex : '', true));
    html = html.replace(/<p>\s*\uE000I(\d+)\uE001\s*<\/p>/g, (m, id) =>
      '<p>' + self.renderMath(tokens[+id] ? tokens[+id].tex : '', false) + '</p>');
    html = html.replace(/\uE000([BI])(\d+)\uE001/g, (m, kind, id) =>
      self.renderMath(tokens[+id] ? tokens[+id].tex : '', kind === 'B'));
    return html;
  },

  renderMath(tex, display) {
    const clean = String(tex).replace(/^\n+|\n+$/g, '').trim();
    if (!clean) return display ? '<div class="math-block" data-tex="" data-math-block="1"></div>' : '';
    const html = this.katexHtml(clean, display);
    if (html === null) {
      this.errors++;
      const chip = '<span class="math-error" title="Error de sintaxis LaTeX">' + escapeHtml(clean) + '</span>';
      return display
        ? '<div class="math-block" data-tex="' + escapeAttr(clean) + '" data-math-block="1" contenteditable="false">' + chip + '</div>'
        : '<span class="math-inline math-error-wrap" data-tex="' + escapeAttr(clean) + '" contenteditable="false">' + chip + '</span>';
    }
    return display
      ? '<div class="math-block" data-tex="' + escapeAttr(clean) + '" data-math-block="1" contenteditable="false">' + html + '</div>'
      : '<span class="math-inline" data-tex="' + escapeAttr(clean) + '" contenteditable="false">' + html + '</span>';
  },

  mathNode(tex, display) {
    const clean = String(tex).replace(/^\n+|\n+$/g, '').trim();
    const el = document.createElement(display ? 'div' : 'span');
    el.className = display ? 'math-block' : 'math-inline';
    el.setAttribute('contenteditable', 'false');
    el.setAttribute('data-tex', clean);
    if (display) el.setAttribute('data-math-block', '1');
    const html = this.katexHtml(clean, display);
    if (html === null) {
      this.errors++;
      el.innerHTML = '<span class="math-error" title="Error de sintaxis LaTeX">' + escapeHtml(clean) + '</span>';
    } else {
      el.innerHTML = html;
    }
    return el;
  },

  rerenderMath(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.math-block[data-tex], .math-inline[data-tex]').forEach((el) => {
      const tex = el.getAttribute('data-tex') || '';
      const display = el.classList.contains('math-block');
      const html = this.katexHtml(tex, display);
      if (html === null) {
        el.innerHTML = '<span class="math-error" title="Error de sintaxis LaTeX">' + escapeHtml(tex) + '</span>';
      } else {
        el.innerHTML = html;
      }
    });
  },

  replaceHeaderTokens(html, tokens) {
    if (!tokens.length) return html;
    tokens.forEach((token, idx) => {
      const marker = '<div class="hdr-marker" data-hdr="' + escapeAttr(token) + '" contenteditable="false"><span class="hdr-marker-label">Cabecera: <em>' + escapeHtml(token) + '</em><button type="button" class="marker-remove" data-remove-marker="header" title="Quitar cabecera" aria-label="Quitar cabecera">×</button></span></div>';
      const re = new RegExp('<p>\\s*\\uE002H' + idx + '\\uE003\\s*</p>|\\uE002H' + idx + '\\uE003', 'g');
      html = html.replace(re, marker);
    });
    return html;
  },

  renderMarkdownFragment(src) {
    if (!src || !String(src).trim()) return '';
    let source = String(src);
    const headers = [];
    source = source.replace(HDR_RE, (m, text) => {
      headers.push((text || '').trim());
      return '\n\n\uE002H' + (headers.length - 1) + '\uE003\n\n';
    });
    const extracted = this.extractMath(source);
    let html = '';
    try {
      html = window.marked ? window.marked.parse(extracted.text, MARKED_OPTIONS) : '<p>' + escapeHtml(extracted.text) + '</p>';
    } catch (e) {
      html = '<p>' + escapeHtml(extracted.text) + '</p>';
    }
    html = sanitizeHtml(html || '');
    html = this.injectMath(html, extracted.tokens);
    html = this.replaceHeaderTokens(html, headers);
    return html;
  },

  markdownToFlowHtml(markdown) {
    this.errors = 0;
    const src = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n');
    const parts = src.split(PAGEBREAK_RE);
    const out = [];
    parts.forEach((part) => {
      if (part == null) return;
      if (PAGEBREAK_ONLY_RE.test(part)) {
        out.push('<div class="pagebreak-block" contenteditable="false" data-pagebreak="1"><span class="pagebreak-label">Salto de página<button type="button" class="marker-remove" data-remove-marker="pagebreak" title="Quitar salto de página" aria-label="Quitar salto de página">×</button></span></div>');
      } else if (part.trim()) {
        out.push(this.renderMarkdownFragment(part));
      }
    });
    return out.join('\n');
  },

  looksLikeMarkdown(text) {
    if (!text) return false;
    const sample = String(text).slice(0, 12000);
    const patterns = [
      /^#{1,6}[ \t]+\S/m,
      /^\s{0,3}[-*+][ \t]+\S/m,
      /^\s{0,3}\d+[.)][ \t]+\S/m,
      /^\s{0,3}>\s*\S/m,
      /^```/m,
      /^\s*\|?.+\|.+\n\s*\|?[\s:|-]+\|/m,
      /\*\*[^*\n]+\*\*/,
      /!\[[^\]]*\]\([^)]+\)/,
      /\[[^\]]+\]\([^)]+\)/,
      /(^|[^\\])\$[^$\n]+\$/,
      /^\s*(?:---|\*\*\*|___)\s*$/m,
      /<!--\s*pagebreak\s*-->/i,
      /\\pagebreak\b/i
    ];
    return patterns.some((re) => re.test(sample));
  },

  /** HTML pegado (Word, navegador, IA) → fragmento normalizado. */
  normalizePastedHtml(html) {
    if (!html) return '';
    let clean = sanitizeHtml(html);
    const tpl = document.createElement('template');
    tpl.innerHTML = clean;
    // Google Docs y Word a veces envían contenedores con estilos raros.
    tpl.content.querySelectorAll('meta, link, title, style, xml').forEach((el) => el.remove());
    // Las fórmulas propias se conservan sólo por su código TeX para volver a renderizar.
    tpl.content.querySelectorAll('.math-block[data-tex], .math-inline[data-tex]').forEach((el) => {
      el.innerHTML = '';
    });
    return tpl.innerHTML;
  },

  /* ------------------------------------------------------------------
     Conversión del documento visual a Markdown
     ------------------------------------------------------------------ */
  htmlToMarkdown(root) {
    if (!root) return '';
    const blocks = [];
    const blockChildren = (node) => Array.from(node.children || []).filter((el) =>
      el.tagName !== 'BUTTON'
    );

    const inline = (node) => {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) {
        return String(node.nodeValue || '')
          .replace(/\\/g, '\\\\')
          .replace(/([*_\[\]`])/g, '\\$1');
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const el = node;
      const tag = el.tagName;
      if (el.classList.contains('math-inline') && el.hasAttribute('data-tex')) {
        return '$' + (el.getAttribute('data-tex') || '').trim() + '$';
      }
      if (el.classList.contains('math-block') && el.hasAttribute('data-tex')) {
        return '$$' + (el.getAttribute('data-tex') || '').trim() + '$$';
      }
      if (el.classList.contains('pagebreak-block') || el.classList.contains('hdr-marker')) return '';
      if (tag === 'BR') return '  \n';
      if (tag === 'IMG') {
        return '![' + (el.getAttribute('alt') || '') + '](' + (el.getAttribute('src') || '') + ')';
      }
      const inner = Array.from(el.childNodes).map(inline).join('');
      switch (tag) {
        case 'STRONG': case 'B': return '**' + inner + '**';
        case 'EM': case 'I': return '*' + inner + '*';
        case 'U': return '<u>' + inner + '</u>';
        case 'S': case 'STRIKE': case 'DEL': return '~~' + inner + '~~';
        case 'CODE': {
          const ticks = inner.includes('`') ? '``' : '`';
          return ticks + inner + ticks;
        }
        case 'A': return '[' + inner + '](' + (el.getAttribute('href') || '') + ')';
        case 'SUB': return '<sub>' + inner + '</sub>';
        case 'SUP': return '<sup>' + inner + '</sup>';
        case 'MARK': return '<mark>' + inner + '</mark>';
        case 'SPAN': {
          const style = el.getAttribute('style');
          if (style && /(color|background|font|letter-spacing)/i.test(style)) {
            return '<span style="' + escapeAttr(style) + '">' + inner + '</span>';
          }
          return inner;
        }
        default: return inner;
      }
    };

    const tableToMd = (table) => {
      const rows = Array.from(table.querySelectorAll('tr'));
      if (!rows.length) return '';
      const cellsOf = (tr) => Array.from(tr.children)
        .filter((c) => c.tagName === 'TH' || c.tagName === 'TD')
        .map((c) => inline(c).replace(/\n/g, ' ').replace(/\|/g, '\\|').trim());
      const matrix = rows.map(cellsOf);
      const width = Math.max(...matrix.map((r) => r.length));
      const padded = matrix.map((r) => {
        const copy = r.slice();
        while (copy.length < width) copy.push('');
        return copy;
      });
      const line = (r) => '| ' + r.join(' | ') + ' |';
      const sep = '| ' + Array.from({ length: width }, () => '---').join(' | ') + ' |';
      return [line(padded[0]), sep, ...padded.slice(1).map(line)].join('\n');
    };

    const listToMd = (list, depth = 0) => {
      const ordered = list.tagName === 'OL';
      const items = Array.from(list.children).filter((c) => c.tagName === 'LI');
      return items.map((li, index) => {
        const clone = li.cloneNode(true);
        clone.querySelectorAll('ul, ol').forEach((nested) => nested.remove());
        const text = inline(clone).trim().replace(/\n{2,}/g, '\n').replace(/\n/g, '\n' + '  '.repeat(depth + 1));
        const prefix = '  '.repeat(depth) + (ordered ? (index + 1) + '. ' : '- ');
        const nestedLists = Array.from(li.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
        const nested = nestedLists.map((n) => listToMd(n, depth + 1)).filter(Boolean).join('\n');
        return prefix + text + (nested ? '\n' + nested : '');
      }).join('\n');
    };

    const quoteToMd = (blockquote) => {
      const inner = Array.from(blockquote.children).map((child) => {
        if (child.tagName === 'P') return inline(child);
        return inline(child);
      }).join('\n\n');
      return inner.split('\n').map((line) => '> ' + line).join('\n');
    };

    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = String(node.nodeValue || '').trim();
        if (text) blocks.push(text);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node;
      if (el.classList.contains('pagebreak-block')) {
        blocks.push('\\pagebreak');
        return;
      }
      if (el.classList.contains('hdr-marker')) {
        const h = el.getAttribute('data-hdr') || '';
        blocks.push("'''''" + h + "'''''");
        return;
      }
      if (el.classList.contains('math-block') && el.hasAttribute('data-tex')) {
        blocks.push('$$\n' + (el.getAttribute('data-tex') || '').trim() + '\n$$');
        return;
      }
      if (el.classList.contains('doc-float-image') || el.classList.contains('doc-figure')) {
        const img = el.querySelector('img');
        if (img) blocks.push('![' + (img.getAttribute('alt') || '') + '](' + (img.getAttribute('src') || '') + ')');
        return;
      }
      const tag = el.tagName;
      switch (tag) {
        case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
          blocks.push('#'.repeat(Number(tag[1])) + ' ' + inline(el).trim());
          return;
        case 'P':
          blocks.push(inline(el).trim());
          return;
        case 'UL': case 'OL':
          blocks.push(listToMd(el));
          return;
        case 'BLOCKQUOTE':
          blocks.push(quoteToMd(el));
          return;
        case 'PRE': {
          const code = el.querySelector('code');
          const text = (code || el).textContent || '';
          const lang = code ? (Array.from(code.classList).find((c) => c.startsWith('language-')) || '').replace('language-', '') : '';
          blocks.push('```' + lang + '\n' + text.replace(/\n$/, '') + '\n```');
          return;
        }
        case 'TABLE':
          blocks.push(tableToMd(el));
          return;
        case 'HR':
          blocks.push('---');
          return;
        case 'FIGURE': {
          const img = el.querySelector('img');
          if (img) blocks.push('![' + (img.getAttribute('alt') || '') + '](' + (img.getAttribute('src') || '') + ')');
          return;
        }
        case 'DIV': case 'SECTION': case 'ARTICLE': {
          const kids = blockChildren(el);
          const hasBlockChild = kids.some((k) => /^(P|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR|DIV|SECTION|ARTICLE|FIGURE)$/.test(k.tagName));
          if (hasBlockChild) {
            kids.forEach(walk);
          } else {
            const text = inline(el).trim();
            if (text) blocks.push(text);
          }
          return;
        }
        default: {
          const text = inline(el).trim();
          if (text) blocks.push(text);
        }
      }
    };

    if (root.nodeType === Node.ELEMENT_NODE && /^(P|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|FIGURE|DIV|SECTION)$/.test(root.tagName)) {
      walk(root);
    } else {
      blockChildren(root).forEach(walk);
    }
    return blocks.filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  },

  /* ------------------------------------------------------------------
     Markdown → LaTeX puro (compatibilidad con la función anterior)
     ------------------------------------------------------------------ */
  toLatex(src) {
    const extracted = this.extractMath(String(src || ''));
    const math = extracted.tokens.map((t) => (t.type === 'block' ? '\\[' + t.tex.trim() + '\\]' : '$' + t.tex.trim() + '$'));
    const lines = extracted.text.split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (/^\s*```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push('\\begin{verbatim}\n' + buf.join('\n') + '\n\\end{verbatim}');
        continue;
      }
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        const cmd = ['section', 'subsection', 'subsubsection', 'paragraph', 'paragraph', 'paragraph'][Math.min(h[1].length, 6) - 1];
        out.push('\\' + cmd + '{' + inline(h[2]) + '}');
        i++;
        continue;
      }
      if (/^\s*([-*_])\s*\1[\s\-*_]*$/.test(line)) {
        out.push('\\begin{center}\\rule{0.6\\linewidth}{0.4pt}\\end{center}');
        i++;
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push('\\begin{quote}\n' + buf.map(inline).join('\n') + '\n\\end{quote}');
        continue;
      }
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\.\s+/.test(line);
        const env = ordered ? 'enumerate' : 'itemize';
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          items.push('\\item ' + inline(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '')));
          i++;
        }
        out.push('\\begin{' + env + '}\n' + items.join('\n') + '\n\\end{' + env + '}');
        continue;
      }
      if (/^\s*\|/.test(line) && /^\s*\|?[\s:\-|]+\|[\s:\-|]*$/.test(lines[i + 1] || '')) {
        const rows = [];
        rows.push(splitRow(line));
        i += 2;
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
        const align = rows.shift().map((c) => {
          const s = c.trim();
          if (/^:.*:$/.test(s)) return 'c';
          if (/^:/.test(s)) return 'l';
          if (/:$/.test(s)) return 'r';
          return 'l';
        });
        const body = rows.map((r) => r.map(inline).join(' & ')).join(' \\\\\n');
        out.push('\\begin{tabular}{' + align.join('') + '}\n\\hline\n' + body + ' \\\\\n\\hline\n\\end{tabular}');
        continue;
      }
      if (!line.trim()) { out.push(''); i++; continue; }
      out.push(inline(line));
      i++;
    }

    return restore(out.join('\n\n')).replace(/\n{3,}/g, '\n\n').trim() + '\n';

    function splitRow(l) { return l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()); }
    function inline(s) {
      return s
        .replace(/`([^`]+)`/g, '\\texttt{$1}')
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '\\includegraphics[width=0.8\\linewidth]{$2}')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '\\underline{$1}')
        .replace(/\*\*\*([^*]+)\*\*\*/g, '\\textbf{\\textit{$1}}')
        .replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}')
        .replace(/(^|[\s(])\*([^*]+)\*/g, '$1\\textit{$2}')
        .replace(/__([^_]+)__/g, '\\textbf{$1}');
    }
    function restore(text) {
      return text.replace(/\uE000([BI])(\d+)\uE001/g, (m, kind, id) => (math[+id] || ''));
    }
  }
};

/* --------------------------------------------------------------------------
   MathWrap — fórmulas display demasiado anchas se alinean en varias líneas
   -------------------------------------------------------------------------- */
export const MathWrap = {
  cache: new Map(),
  OPS: ['approx', 'neq', 'ne', 'equiv'],

  splitPoints(tex) {
    const pts = [];
    let depth = 0, i = 0;
    const n = tex.length;
    const isL = (c) => /[a-zA-Z]/.test(c);
    while (i < n) {
      const ch = tex[i];
      if (ch === '\\') {
        let j = i + 1;
        if (j < n && isL(tex[j])) {
          while (j < n && isL(tex[j])) j++;
          const name = tex.slice(i + 1, j);
          if (name === 'left' || name === 'begin') depth++;
          else if (name === 'right' || name === 'end') depth--;
          else if (name === 'tag' || name === 'label' || name === 'nonumber') return null;
          else if (depth === 0 && this.OPS.indexOf(name) !== -1 && tex.slice(0, i).trim()) pts.push(i);
          i = j;
          continue;
        }
        if (tex[j] === '\\' && depth === 0) return null;
        i = j + 1;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (depth === 0) {
        if (ch === '&') return null;
        if (ch === '=' && tex.slice(0, i).trim() && !/[:<>!]/.test(tex[i - 1] || '')) pts.push(i);
      }
      i++;
    }
    return pts;
  },

  fit(tex, limit, measure) {
    const pts = this.splitPoints(tex);
    const scaleFor = (w) => (w > limit + 0.5 ? Math.max(0.6, Math.floor((limit / w) * 0.995 * 100) / 100) : 0);
    if (!pts || !pts.length) {
      const m = measure(tex);
      return m ? { html: null, scale: scaleFor(m.w) } : null;
    }
    const pieces = [];
    let prev = 0;
    pts.forEach((pt) => { pieces.push(tex.slice(prev, pt)); prev = pt; });
    pieces.push(tex.slice(prev));
    const P = (k) => pieces[k].trim();
    const build = (rows, lhs) => '\\begin{aligned}' + rows.map((r, ri) =>
      (ri === 0 && lhs)
        ? P(0) + ' & ' + r.slice(1).map(P).join(' ')
        : '& ' + r.map(P).join(' ')
    ).join(' \\\\ ') + '\\end{aligned}';
    const pack = (lhs) => {
      const rows = [lhs ? [0, 1] : [0]];
      for (let k = lhs ? 2 : 1; k < pieces.length; k++) {
        const cur = rows[rows.length - 1];
        cur.push(k);
        const m = measure(build(rows, lhs));
        if (m && m.w > limit + 0.5) { cur.pop(); rows.push([k]); }
      }
      const m = measure(build(rows, lhs));
      return { m, ok: !!m && m.w <= limit + 0.5 };
    };
    const a = pack(true);
    let best = a;
    if (!a.ok) {
      const b = pack(false);
      best = (b.ok || !a.m || (b.m && b.m.w < a.m.w)) ? b : a;
    }
    if (!best.m) return null;
    return { html: best.m.html, scale: scaleFor(best.m.w) };
  },

  run(root) {
    if (!root || !root.querySelectorAll) return;
    const blocks = root.querySelectorAll('.math-block[data-tex]');
    if (!blocks.length) return;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;width:max-content;white-space:nowrap;';
    root.appendChild(probe);
    const measure = (t) => {
      const html = Parser.katexHtml(t, true);
      if (html === null) return null;
      probe.innerHTML = html;
      return { html, w: probe.getBoundingClientRect().width };
    };
    Array.prototype.forEach.call(blocks, (block) => {
      const tex = block.getAttribute('data-tex');
      const limit = block.clientWidth;
      if (!tex || limit <= 0) return;
      const kh = block.querySelector('.katex-html');
      if (!kh || kh.scrollWidth <= kh.clientWidth + 1) return;
      const key = Math.round(limit) + '|' + tex;
      let res = this.cache.get(key);
      if (res === undefined) {
        try { res = this.fit(tex, limit, measure); } catch (e) { res = null; }
        this.cache.set(key, res);
        if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
      }
      if (!res) return;
      if (res.html) block.innerHTML = res.html;
      if (res.scale) block.style.fontSize = res.scale + 'em';
    });
    root.removeChild(probe);
  }
};
