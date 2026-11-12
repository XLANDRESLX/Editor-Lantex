/* Utilidades comunes de Lantex */
export const CSS_PX_PER_IN = 96;
export const MM_PER_IN = 25.4;
export const mm2px = (mm) => (Number(mm) * CSS_PX_PER_IN) / MM_PER_IN;
export const px2mm = (px) => (Number(px) * MM_PER_IN) / CSS_PX_PER_IN;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function num(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

export function debounce(fn, wait = 250) {
  let timer = 0;
  function debounced(...args) {
    clearTimeout(timer);
    debounced.pending = true;
    timer = window.setTimeout(() => {
      timer = 0;
      debounced.pending = false;
      fn.apply(this, args);
    }, wait);
  }
  debounced.pending = false;
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = 0;
    debounced.pending = false;
  };
  debounced.flush = (...args) => {
    clearTimeout(timer);
    timer = 0;
    debounced.pending = false;
    return fn.apply(this, args);
  };
  return debounced;
}

export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function slug(value) {
  const out = String(value || 'documento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return out || 'documento';
}

let uidCounter = 0;
export function uid(prefix = 'id') {
  uidCounter = (uidCounter + 1) % 1000000;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}`;
}

export const Store = {
  get(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : raw;
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  },
  remove(key) {
    try { window.localStorage.removeItem(key); return true; }
    catch (e) { return false; }
  }
};

export function copyText(text, okMessage, failMessage) {
  const done = () => {
    if (okMessage) window.dispatchEvent(new CustomEvent('lantex:toast', { detail: { message: okMessage, type: 'ok' } }));
  };
  const fail = () => {
    if (failMessage) window.dispatchEvent(new CustomEvent('lantex:toast', { detail: { message: failMessage, type: 'err' } }));
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done, fail));
  } else {
    fallbackCopy(text, done, fail);
  }
}

function fallbackCopy(text, done, fail) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) done(); else fail();
  } catch (e) {
    fail();
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}

export function formatNumber(n) {
  return new Intl.NumberFormat('es-ES').format(n || 0);
}

export function isApplePlatform() {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export function isOnlineAssetAvailable() {
  return typeof window.marked !== 'undefined' && typeof window.katex !== 'undefined';
}

/** Watches a DOM element with performance-friendly resize callbacks. */
export function observeResize(element, callback) {
  if (!element) return () => {};
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => callback());
    observer.observe(element);
    return () => observer.disconnect();
  }
  const handler = () => callback();
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
}

/** Recorre nodos de texto ignorando controles y fórmulas renderizadas. */
export function walkTextNodes(root, visitor) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('.katex, .math-block, .math-inline, .math-error, .pagebreak-block, .hdr-marker, .doc-figure, .doc-float-image, button, script, style')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node;
  while ((node = walker.nextNode())) visitor(node);
}

export function textNodesOf(root) {
  const nodes = [];
  walkTextNodes(root, (node) => nodes.push(node));
  return nodes;
}

export function createElementFromHTML(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html).trim();
  return tpl.content.firstElementChild;
}
