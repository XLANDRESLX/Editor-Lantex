import { clamp, debounce, uid } from './util.js';
import { getPageMetrics } from './config.js';

const MIN_SIZE = 26;
const MAX_NATURAL = 2600;
const MAX_FILE_BYTES = 3.4 * 1024 * 1024;
const IMAGE_SELECTOR = '.doc-figure, .doc-float-image, .doc-inline-img';

function toast(message, type = 'info') {
  window.dispatchEvent(new CustomEvent('lantex:toast', { detail: { message, type } }));
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

function loadImageInfo(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({
      width: image.naturalWidth || image.width || 0,
      height: image.naturalHeight || image.height || 0
    });
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function prepareImageFile(file) {
  const original = await readAsDataURL(file);
  const info = await loadImageInfo(original);
  if (!info || !info.width || !info.height) throw new Error('Imagen no válida');
  let src = original;
  let width = info.width;
  let height = info.height;
  const type = file.type || '';
  const keepOriginal = /svg|gif/i.test(type);
  const tooLarge = width > MAX_NATURAL || height > MAX_NATURAL || file.size > MAX_FILE_BYTES;
  if (tooLarge && !keepOriginal) {
    const ratio = Math.min(1, MAX_NATURAL / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(await loadImageElement(original), 0, 0, canvas.width, canvas.height);
      const outputType = type === 'image/png' ? 'image/png' : 'image/jpeg';
      src = canvas.toDataURL(outputType, outputType === 'image/jpeg' ? 0.9 : undefined);
      width = canvas.width;
      height = canvas.height;
    }
  }
  return {
    src,
    width,
    height,
    alt: (file.name || 'Imagen').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim()
  };
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    image.src = src;
  });
}

/**
 * Gestión de imágenes del documento: inserción, selección, redimensionado,
 * movimiento, ajuste de texto y persistencia de geometría.
 */
export class ImageManager {
  constructor(app) {
    this.app = app;
    this.pagesEl = app.pagesEl;
    this.pagesWrap = app.pagesWrap;
    this.overlay = document.getElementById('imageOverlay');
    this.dragIndicator = document.getElementById('dragIndicator');
    this.dropOverlay = document.getElementById('dropOverlay');
    this.fileInput = document.getElementById('imageInput');
    this.selected = null;
    this.drag = null;
    this.resize = null;
    this.dropDepth = 0;
    this.overlayFrame = 0;
    this.scheduleLayout = debounce(() => this.app.relayout(), 260);
    this.scheduleOverlay = this.scheduleOverlayUpdate.bind(this);
    this.bind();
  }

  /* ------------------------------------------------------------------ */
  /* Eventos                                                            */
  /* ------------------------------------------------------------------ */

  bind() {
    if (this.fileInput) {
      this.fileInput.addEventListener('change', () => {
        const files = Array.from(this.fileInput.files || []);
        this.fileInput.value = '';
        if (files.length) this.insertFiles(files);
      });
    }

    this.pagesEl.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    document.addEventListener('pointermove', (event) => this.onPointerMove(event));
    document.addEventListener('pointerup', (event) => this.onPointerUp(event));
    document.addEventListener('pointercancel', (event) => this.onPointerUp(event));

    if (this.overlay) {
      this.overlay.querySelectorAll('.img-handle').forEach((handle) => {
        handle.addEventListener('pointerdown', (event) => this.startResize(event));
      });
    }

    this.pagesWrap.addEventListener('scroll', this.scheduleOverlay, { passive: true });
    window.addEventListener('resize', this.scheduleOverlay);

    document.addEventListener('pointerdown', (event) => {
      if (!this.selected) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(IMAGE_SELECTOR) || target.closest('#imageOverlay') ||
          target.closest('#imageGroup') || target.closest('#inspectorImage') ||
          target.closest('.app-dialog')) return;
      this.deselect();
    });

    this.bindDropZone();
  }

  bindDropZone() {
    const hasFiles = (event) => {
      const dt = event.dataTransfer;
      if (!dt) return false;
      if (dt.types && Array.from(dt.types).includes('Files')) return true;
      return Array.from(dt.items || []).some((item) => item.kind === 'file' && /^image\//.test(item.type));
    };

    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      this.dropDepth += 1;
      this.showDropOverlay(true);
    });

    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      this.showDropOverlay(true);
    });

    window.addEventListener('dragleave', (event) => {
      if (!hasFiles(event)) return;
      this.dropDepth = Math.max(0, this.dropDepth - 1);
      if (!this.dropDepth) this.showDropOverlay(false);
    });

    window.addEventListener('drop', (event) => {
      if (!hasFiles(event)) return;
      const files = this.imageFilesFrom(event.dataTransfer);
      if (!files.length) return;
      event.preventDefault();
      this.dropDepth = 0;
      this.showDropOverlay(false);
      this.insertFiles(files, { x: event.clientX, y: event.clientY });
    });
  }

  showDropOverlay(visible) {
    if (!this.dropOverlay) return;
    this.dropOverlay.hidden = !visible;
    if (!visible) {
      this.dragIndicator.hidden = true;
    }
  }

  imageFilesFrom(dataTransfer) {
    if (!dataTransfer) return [];
    const files = [];
    const seen = new Set();
    const push = (file) => {
      if (!file || !file.type || !/^image\//.test(file.type)) return;
      const key = [file.name, file.size, file.lastModified].join(':');
      if (seen.has(key)) return;
      seen.add(key);
      files.push(file);
    };
    Array.from(dataTransfer.files || []).forEach(push);
    Array.from(dataTransfer.items || []).forEach((item) => {
      if (item.kind !== 'file' || !/^image\//.test(item.type)) return;
      push(item.getAsFile());
    });
    return files;
  }

  /* ------------------------------------------------------------------ */
  /* Inserción                                                          */
  /* ------------------------------------------------------------------ */

  async insertFiles(files, point = null) {
    const list = Array.from(files || []).filter((file) => file && /^image\//.test(file.type || ''));
    if (!list.length) return;
    if (point && this.app.editor) this.app.editor.focusAtPoint(point.x, point.y);
    const bookmark = this.app.selection ? this.app.selection.save() : null;
    const prepared = [];
    for (const file of list) {
      try {
        prepared.push(await prepareImageFile(file));
      } catch (error) {
        console.warn('[Lantex] Imagen omitida:', error);
        toast('No se pudo leer «' + (file.name || 'imagen') + '».', 'err');
      }
    }
    if (!prepared.length) return;

    if (bookmark && this.app.selection) this.app.selection.restoreBookmark(bookmark, { focus: true });
    else if (this.app.selection) this.app.selection.restoreBeforeInsert();

    const nodes = prepared.map((item) => this.createFigure(item.src, {
      alt: item.alt,
      naturalWidth: item.width,
      naturalHeight: item.height,
      width: this.defaultWidth(item)
    }));

    const inserted = this.app.editor
      ? this.app.editor.insertBlockNodes(nodes, { focus: false })
      : [];
    if (!inserted.length) {
      toast('Haz clic en una hoja antes de insertar la imagen.', 'err');
      return;
    }
    this.app.afterMutation({ relayout: true, historyNow: true });
    window.requestAnimationFrame(() => this.select(inserted[0]));
  }

  handlePaste(event) {
    const files = this.imageFilesFrom(event.clipboardData);
    if (!files.length) return false;
    event.preventDefault();
    this.insertFiles(files);
    return true;
  }

  defaultWidth(item) {
    const metrics = getPageMetrics(this.app.settings);
    const contentWidth = this.contentWidth() || metrics.contentWidthPx;
    const contentHeight = this.contentHeight() || metrics.contentHeightPx;
    const naturalWidth = item.width || contentWidth;
    const naturalHeight = item.height || contentWidth;
    let width = Math.min(naturalWidth, contentWidth);
    let height = naturalHeight ? width * (naturalHeight / naturalWidth) : width;
    const maxHeight = contentHeight * 0.92;
    if (height > maxHeight && maxHeight > 0) {
      width *= maxHeight / height;
      height = maxHeight;
    }
    return Math.max(MIN_SIZE, Math.round(width));
  }

  createFigure(src, options = {}) {
    const figure = document.createElement('figure');
    figure.className = 'doc-figure';
    figure.setAttribute('contenteditable', 'false');
    figure.dataset.bid = uid('b');
    figure.dataset.imageId = uid('img');
    figure.dataset.mode = options.mode || 'inline';
    figure.dataset.align = options.align || 'center';

    const width = options.width || this.contentWidth() || 480;
    const image = document.createElement('img');
    image.src = src;
    image.alt = options.alt || '';
    image.draggable = false;
    image.decoding = 'async';
    if (options.naturalWidth) image.setAttribute('width', String(options.naturalWidth));
    if (options.naturalHeight) image.setAttribute('height', String(options.naturalHeight));
    figure.style.width = Math.round(width) + 'px';
    figure.appendChild(image);

    if (!options.width) figure.dataset.autoSize = '1';
    this.trackImageLoad(figure, image);
    return figure;
  }

  createFloat(src, options = {}) {
    const node = document.createElement('div');
    node.className = 'doc-float-image';
    node.setAttribute('contenteditable', 'false');
    node.dataset.imageId = options.id || uid('img');
    node.dataset.wrap = options.wrap === 'behind' ? 'behind' : 'front';
    node.dataset.align = options.align || 'left';
    const image = document.createElement('img');
    image.src = src;
    image.alt = options.alt || '';
    image.draggable = false;
    image.decoding = 'async';
    node.appendChild(image);
    this.setFloatGeometry(node, {
      x: Number(options.x) || 24,
      y: Number(options.y) || 24,
      width: Number(options.width) || 240,
      height: Number(options.height) || 180
    });
    this.trackImageLoad(node, image);
    return node;
  }

  createAnchor(imageId) {
    const anchor = document.createElement('div');
    anchor.className = 'image-anchor';
    anchor.setAttribute('contenteditable', 'false');
    anchor.dataset.imageAnchor = imageId;
    anchor.dataset.bid = uid('b');
    return anchor;
  }

  trackImageLoad(node, image) {
    const done = () => {
      if (node.dataset.autoSize === '1') this.applyNaturalSize(node, image);
      if (node.dataset.loaded === '1') return;
      node.dataset.loaded = '1';
      this.scheduleLayout();
    };
    if (image.complete && image.naturalWidth) done();
    else image.addEventListener('load', done, { once: true });
    image.addEventListener('error', () => {
      if (node.isConnected) toast('Una imagen no se pudo cargar.', 'err');
    }, { once: true });
  }

  applyNaturalSize(node, image) {
    if (!node || !image || !image.naturalWidth) return;
    const contentWidth = this.contentWidthFor(node) || 520;
    const contentHeight = this.contentHeightFor(node) || 640;
    let width = Math.min(image.naturalWidth, contentWidth);
    let height = width * (image.naturalHeight / image.naturalWidth);
    const maxHeight = contentHeight * 0.92;
    if (height > maxHeight && maxHeight > 0) {
      width *= maxHeight / height;
      height = maxHeight;
    }
    width = Math.max(MIN_SIZE, Math.round(width));
    if (node.classList.contains('doc-float-image')) {
      this.setFloatGeometry(node, {
        x: Number(node.dataset.x) || 24,
        y: Number(node.dataset.y) || 24,
        width,
        height
      });
    } else {
      node.style.width = width + 'px';
    }
    delete node.dataset.autoSize;
  }

  /* ------------------------------------------------------------------ */
  /* Imágenes pegadas como HTML (Markdown, IA, Word)                    */
  /* ------------------------------------------------------------------ */

  normalizeImages(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('img').forEach((image) => {
      if (!image.isConnected) return;
      if (image.closest(IMAGE_SELECTOR)) return;
      if (!image.closest('.a4-content')) return;
      const holder = image.parentElement;
      if (!holder) return;
      const meaningful = Array.from(holder.childNodes).filter((node) => {
        if (node === image) return false;
        if (node.nodeType === Node.TEXT_NODE) return !!node.data.trim();
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        return !(node.tagName === 'BR' || node.tagName === 'A');
      });
      const standalone = !meaningful.length
        && (holder.tagName === 'P' || holder.tagName === 'DIV')
        && !holder.querySelector('a > img');
      const source = image.currentSrc || image.getAttribute('src') || '';
      if (!source) {
        image.remove();
        return;
      }
      if (standalone) {
        const widthAttr = parseFloat(image.getAttribute('width')) || 0;
        const styleWidth = parseFloat(image.style.width) || 0;
        const figure = this.createFigure(source, {
          alt: image.getAttribute('alt') || '',
          naturalWidth: image.naturalWidth || undefined,
          naturalHeight: image.naturalHeight || undefined,
          width: widthAttr || styleWidth || undefined
        });
        if (holder.dataset.bid) figure.dataset.bid = holder.dataset.bid;
        if (!widthAttr && !styleWidth) figure.dataset.autoSize = '1';
        holder.replaceWith(figure);
        this.trackImageLoad(figure, figure.querySelector('img'));
      } else {
        const span = document.createElement('span');
        span.className = 'doc-inline-img';
        span.setAttribute('contenteditable', 'false');
        span.dataset.imageId = uid('img');
        const widthAttr = parseFloat(image.getAttribute('width')) || 0;
        const styleWidth = parseFloat(image.style.width) || 0;
        const width = widthAttr || styleWidth;
        if (width) {
          span.style.width = Math.round(width) + 'px';
          span.dataset.userSized = '1';
        }
        image.replaceWith(span);
        span.appendChild(image);
        image.style.width = '100%';
        image.style.height = 'auto';
        image.draggable = false;
        if (!width) {
          span.dataset.autoSize = '1';
          this.trackImageLoad(span, image);
        }
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Selección y overlay                                                */
  /* ------------------------------------------------------------------ */

  resolveTarget(element) {
    if (!element) return null;
    if (element instanceof Element) {
      const direct = element.closest(IMAGE_SELECTOR);
      if (direct) return direct;
      if (element.tagName === 'IMG') return element.closest(IMAGE_SELECTOR);
    }
    return null;
  }

  select(node, options = {}) {
    const target = this.resolveTarget(node);
    if (!target || !target.isConnected) return;
    if (this.selected === target) {
      this.updateOverlay();
      return;
    }
    this.deselect({ silent: true });
    this.selected = target;
    target.classList.add('is-selected');
    this.updateOverlay();
    if (!options.silent) this.notify();
  }

  deselect(options = {}) {
    if (this.selected) {
      this.selected.classList.remove('is-selected');
      this.selected = null;
    }
    if (this.overlay) {
      this.overlay.hidden = true;
      this.overlay.setAttribute('aria-hidden', 'true');
    }
    if (!options.silent) this.notify();
  }

  notify() {
    const info = this.getInfo();
    this.app.onImageSelectionChange?.(info);
  }

  getInfo() {
    const node = this.selected;
    if (!node || !node.isConnected) return null;
    const image = node.querySelector('img');
    if (!image) return null;
    const float = node.classList.contains('doc-float-image');
    const figure = node.classList.contains('doc-figure');
    const inline = node.classList.contains('doc-inline-img');
    const scale = this.getScale();
    const rect = node.getBoundingClientRect();
    const width = node.offsetWidth || (rect.width / scale) || 0;
    const height = node.offsetHeight || (rect.height / scale) || 0;
    let wrap = 'inline';
    let align = 'center';
    if (float) {
      wrap = node.dataset.wrap === 'behind' ? 'behind' : 'front';
      align = node.dataset.align || 'left';
    } else if (figure) {
      wrap = node.dataset.mode === 'square' ? 'square' : 'inline';
      align = node.dataset.align || 'center';
    }
    return {
      node,
      kind: float ? 'float' : figure ? 'figure' : inline ? 'inline' : 'figure',
      wrap,
      align,
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      alt: image.getAttribute('alt') || '',
      page: node.closest('.a4-page')
    };
  }

  getScale() {
    const page = this.pagesEl.querySelector('.a4-page');
    if (!page) return this.app.zoomScale || 1;
    const width = page.getBoundingClientRect().width;
    const natural = page.offsetWidth;
    return natural ? (width / natural || 1) : (this.app.zoomScale || 1);
  }

  contentWidth() {
    const content = this.pagesEl.querySelector('.a4-content');
    return content ? content.clientWidth : getPageMetrics(this.app.settings).contentWidthPx;
  }

  contentHeight() {
    const content = this.pagesEl.querySelector('.a4-content');
    return content ? content.clientHeight : getPageMetrics(this.app.settings).contentHeightPx;
  }

  contentWidthFor(node) {
    const content = node && node.closest('.a4-content');
    return content ? content.clientWidth : this.contentWidth();
  }

  contentHeightFor(node) {
    const content = node && node.closest('.a4-content');
    return content ? content.clientHeight : this.contentHeight();
  }

  scheduleOverlayUpdate() {
    if (this.overlayFrame) return;
    this.overlayFrame = window.requestAnimationFrame(() => {
      this.overlayFrame = 0;
      this.updateOverlay();
    });
  }

  updateOverlay() {
    if (!this.overlay) return;
    if (!this.selected || !this.selected.isConnected) {
      if (this.selected) this.deselect({ silent: true });
      this.overlay.hidden = true;
      return;
    }
    const rect = this.selected.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      this.overlay.hidden = true;
      return;
    }
    this.overlay.style.left = rect.left + 'px';
    this.overlay.style.top = rect.top + 'px';
    this.overlay.style.width = rect.width + 'px';
    this.overlay.style.height = rect.height + 'px';
    this.overlay.hidden = false;
    this.overlay.setAttribute('aria-hidden', 'false');
  }

  /* ------------------------------------------------------------------ */
  /* Ratón: selección, movimiento y redimensionado                      */
  /* ------------------------------------------------------------------ */

  onPointerDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest('.img-handle')) return;
    const target = this.resolveTarget(event.target);
    if (!target) {
      if (this.selected && !event.target.closest('#imageGroup, #inspectorImage')) this.deselect();
      return;
    }
    event.preventDefault();
    this.select(target);
    const info = this.getInfo();
    if (!info) return;
    if (info.kind === 'float') {
      this.startFloatDrag(event, target, info);
    } else if (info.kind === 'figure') {
      this.startBlockDrag(event, target);
    }
  }

  startFloatDrag(event, node, info) {
    this.drag = {
      type: 'float',
      node,
      startX: event.clientX,
      startY: event.clientY,
      originX: Number(node.dataset.x) || node.offsetLeft || 0,
      originY: Number(node.dataset.y) || node.offsetTop || 0,
      width: info.width,
      height: info.height,
      moved: false,
      scale: this.getScale()
    };
    document.body.classList.add('is-manipulating-image');
  }

  startBlockDrag(event, node) {
    this.drag = {
      type: 'block',
      node,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      drop: null
    };
  }

  onPointerMove(event) {
    if (this.drag) {
      if (this.drag.type === 'float') this.moveFloat(event);
      else if (this.drag.type === 'block') this.moveBlock(event);
      return;
    }
    if (this.resize) this.updateResize(event);
  }

  moveFloat(event) {
    const drag = this.drag;
    const dx = (event.clientX - drag.startX) / (drag.scale || 1);
    const dy = (event.clientY - drag.startY) / (drag.scale || 1);
    if (!drag.moved && Math.hypot(dx, dy) < 2) return;
    drag.moved = true;
    const page = drag.node.closest('.a4-page');
    if (!page) return;
    const x = clamp(drag.originX + dx, 0, page.offsetWidth - drag.width);
    const y = clamp(drag.originY + dy, 0, page.offsetHeight - drag.height);
    drag.node.dataset.x = String(Math.round(x));
    drag.node.dataset.y = String(Math.round(y));
    drag.node.style.left = Math.round(x) + 'px';
    drag.node.style.top = Math.round(y) + 'px';
    this.updateOverlay();
  }

  moveBlock(event) {
    const drag = this.drag;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    drag.drop = this.findDropTarget(event.clientX, event.clientY, drag.node);
    this.drawDropIndicator(drag.drop);
  }

  findDropTarget(x, y, source) {
    let under = document.elementFromPoint(x, y);
    if (under && (under === source || source.contains(under))) {
      const previous = source.style.pointerEvents;
      source.style.pointerEvents = 'none';
      under = document.elementFromPoint(x, y);
      source.style.pointerEvents = previous;
    }
    let content = under && under.closest ? under.closest('.a4-content') : null;
    if (!content) {
      const page = under && under.closest ? under.closest('.a4-page') : null;
      if (page) content = page.querySelector('.a4-content');
    }
    if (!content) return null;
    const blocks = Array.from(content.children).filter((element) =>
      element !== source &&
      !element.classList.contains('pagebreak-block') &&
      !element.classList.contains('hdr-marker') &&
      !element.classList.contains('image-anchor')
    );
    let before = null;
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        before = block;
        break;
      }
    }
    return { content, before };
  }

  drawDropIndicator(drop) {
    if (!this.dragIndicator) return;
    if (!drop) {
      this.dragIndicator.hidden = true;
      return;
    }
    const contentRect = drop.content.getBoundingClientRect();
    let y = contentRect.top;
    if (drop.before) {
      const rect = drop.before.getBoundingClientRect();
      y = rect.top;
    } else {
      const last = Array.from(drop.content.children)
        .filter((element) => !element.classList.contains('pagebreak-block') && !element.classList.contains('hdr-marker') && !element.classList.contains('image-anchor'))
        .pop();
      y = last ? last.getBoundingClientRect().bottom : contentRect.top + 8;
    }
    y = clamp(y, contentRect.top, contentRect.bottom - 1);
    this.dragIndicator.style.left = contentRect.left + 'px';
    this.dragIndicator.style.top = y + 'px';
    this.dragIndicator.style.width = contentRect.width + 'px';
    this.dragIndicator.hidden = false;
  }

  onPointerUp(event) {
    if (this.resize) {
      this.finishResize(event);
      return;
    }
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    document.body.classList.remove('is-manipulating-image');
    if (this.dragIndicator) this.dragIndicator.hidden = true;
    if (drag.type === 'block') {
      if (drag.moved && drag.drop) {
        const { content, before } = drag.drop;
        if (before) content.insertBefore(drag.node, before);
        else content.appendChild(drag.node);
        this.app.afterMutation({ relayout: true, historyNow: true });
        window.requestAnimationFrame(() => this.select(drag.node));
      }
    } else if (drag.type === 'float') {
      if (drag.moved) {
        this.app.afterMutation({ relayout: false, historyNow: true });
        this.updateOverlay();
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Redimensionado                                                     */
  /* ------------------------------------------------------------------ */

  startResize(event) {
    if (!this.selected) return;
    const handle = event.currentTarget.getAttribute('data-handle');
    if (!handle) return;
    const info = this.getInfo();
    if (!info) return;
    event.preventDefault();
    event.stopPropagation();
    const page = this.selected.closest('.a4-page');
    this.resize = {
      handle,
      node: this.selected,
      info,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: info.width,
      startHeight: info.height,
      aspect: info.height > 0 ? info.height / info.width : 1,
      startLeft: Number(this.selected.dataset.x) || this.selected.offsetLeft || 0,
      startTop: Number(this.selected.dataset.y) || this.selected.offsetTop || 0,
      pageWidth: page ? page.offsetWidth : this.contentWidth(),
      pageHeight: page ? page.offsetHeight : this.contentHeight(),
      scale: this.getScale()
    };
    document.body.classList.add('is-manipulating-image');
  }

  updateResize(event) {
    const resize = this.resize;
    if (!resize) return;
    const dx = (event.clientX - resize.startX) / (resize.scale || 1);
    const dy = (event.clientY - resize.startY) / (resize.scale || 1);
    const handle = resize.handle;
    const aspect = resize.aspect || 1;
    const horizontal = handle.includes('e') || handle.includes('w');
    const vertical = handle.includes('n') || handle.includes('s');

    let deltaWidth = 0;
    if (horizontal && vertical) {
      const dwx = handle.includes('w') ? -dx : dx;
      const dwy = (handle.includes('n') ? -dy : dy) / aspect;
      deltaWidth = Math.abs(dwx) >= Math.abs(dwy) ? dwx : dwy;
    } else if (horizontal) {
      deltaWidth = handle.includes('w') ? -dx : dx;
    } else if (vertical) {
      deltaWidth = (handle.includes('n') ? -dy : dy) / aspect;
    }

    let maxWidth = resize.info.kind === 'float' ? resize.pageWidth : this.contentWidthFor(resize.node);
    let maxHeight = resize.info.kind === 'float' ? resize.pageHeight : this.contentHeightFor(resize.node);
    if (resize.info.kind === 'float') {
      if (handle.includes('w')) maxWidth = resize.startLeft + resize.startWidth;
      else maxWidth = resize.pageWidth - resize.startLeft;
      if (handle.includes('n')) maxHeight = resize.startTop + resize.startHeight;
      else maxHeight = resize.pageHeight - resize.startTop;
    }
    const limit = Math.min(maxWidth / 1, maxHeight / aspect);
    let width = clamp(resize.startWidth + deltaWidth, MIN_SIZE, Math.max(MIN_SIZE, limit));
    let height = width * aspect;
    if (height < MIN_SIZE) {
      height = MIN_SIZE;
      width = height / aspect;
    }

    if (resize.info.kind === 'float') {
      let x = resize.startLeft;
      let y = resize.startTop;
      if (handle.includes('w')) x = resize.startLeft + resize.startWidth - width;
      if (handle.includes('n')) y = resize.startTop + resize.startHeight - height;
      this.setFloatGeometry(resize.node, { x, y, width, height });
    } else {
      resize.node.style.width = Math.round(width) + 'px';
      resize.node.dataset.userSized = '1';
    }
    this.updateOverlay();
  }

  finishResize() {
    const resize = this.resize;
    this.resize = null;
    document.body.classList.remove('is-manipulating-image');
    if (!resize) return;
    this.app.afterMutation({ relayout: true, historyNow: true });
    this.updateOverlay();
  }

  /* ------------------------------------------------------------------ */
  /* Geometría de imágenes flotantes                                    */
  /* ------------------------------------------------------------------ */

  setFloatGeometry(node, geometry) {
    const page = node.closest('.a4-page');
    if (!page) {
      node.style.width = Math.max(MIN_SIZE, geometry.width) + 'px';
      node.style.height = Math.max(MIN_SIZE, geometry.height) + 'px';
      return;
    }
    const pageWidth = page.offsetWidth;
    const pageHeight = page.offsetHeight;
    let width = clamp(Number(geometry.width) || MIN_SIZE, MIN_SIZE, pageWidth);
    let height = clamp(Number(geometry.height) || MIN_SIZE, MIN_SIZE, pageHeight);
    if (width > pageWidth || height > pageHeight) {
      const ratio = Math.min(pageWidth / width, pageHeight / height, 1);
      width *= ratio;
      height *= ratio;
    }
    const x = clamp(Number(geometry.x) || 0, 0, Math.max(0, pageWidth - width));
    const y = clamp(Number(geometry.y) || 0, 0, Math.max(0, pageHeight - height));
    node.style.width = Math.round(width) + 'px';
    node.style.height = Math.round(height) + 'px';
    node.style.left = Math.round(x) + 'px';
    node.style.top = Math.round(y) + 'px';
    node.dataset.x = String(Math.round(x));
    node.dataset.y = String(Math.round(y));
  }

  clampFloat(node) {
    const page = node.closest('.a4-page');
    if (!page) return;
    const width = parseFloat(node.style.width) || node.offsetWidth || 240;
    const height = parseFloat(node.style.height) || node.offsetHeight || 180;
    this.setFloatGeometry(node, {
      x: Number(node.dataset.x) || 0,
      y: Number(node.dataset.y) || 0,
      width,
      height
    });
  }

  /* ------------------------------------------------------------------ */
  /* Propiedades: ajuste, alineación, tamaño, alt                        */
  /* ------------------------------------------------------------------ */

  setWrap(value) {
    let info = this.getInfo();
    if (!info) return;
    if (info.kind === 'inline' && value !== 'inline') info = this.promoteInline(info);
    if (!info) return;
    if (value === 'front' || value === 'behind') {
      if (info.kind === 'figure') {
        this.figureToFloat(info, value);
        return;
      }
      if (info.kind === 'float') {
        info.node.dataset.wrap = value;
        this.commit();
        return;
      }
    }
    if (value === 'inline' || value === 'square') {
      if (info.kind === 'float') {
        this.floatToFigure(info, value);
        return;
      }
      if (info.kind === 'figure') {
        info.node.dataset.mode = value;
        this.commit();
        return;
      }
      if (info.kind === 'inline') {
        info.node.dataset.mode = 'inline';
        this.commit();
      }
    }
  }

  setAlign(value) {
    const info = this.getInfo();
    if (!info) return;
    if (info.kind === 'float') {
      const page = info.node.closest('.a4-page');
      if (!page) return;
      const width = parseFloat(info.node.style.width) || info.width;
      const height = parseFloat(info.node.style.height) || info.height;
      let x = Number(info.node.dataset.x) || 0;
      if (value === 'left') x = 0;
      else if (value === 'center') x = (page.offsetWidth - width) / 2;
      else if (value === 'right') x = page.offsetWidth - width;
      info.node.dataset.align = value;
      this.setFloatGeometry(info.node, { x, y: Number(info.node.dataset.y) || 0, width, height });
      this.commit();
      return;
    }
    if (info.kind === 'figure') {
      info.node.dataset.align = value;
      this.commit();
    }
  }

  setSize(prop, rawValue) {
    const info = this.getInfo();
    if (!info) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < MIN_SIZE) return;
    const aspect = info.width > 0 ? info.height / info.width : 1;
    let width = prop === 'height' ? value / (aspect || 1) : value;
    let height = prop === 'height' ? value : value * aspect;
    if (info.kind === 'float') {
      const page = info.node.closest('.a4-page');
      const maxWidth = page ? page.offsetWidth : this.contentWidth();
      const maxHeight = page ? page.offsetHeight : this.contentHeight();
      width = clamp(width, MIN_SIZE, maxWidth);
      height = clamp(height, MIN_SIZE, maxHeight);
      info.node.dataset.userSized = '1';
      this.setFloatGeometry(info.node, {
        x: Number(info.node.dataset.x) || 0,
        y: Number(info.node.dataset.y) || 0,
        width,
        height
      });
    } else {
      width = clamp(width, MIN_SIZE, this.contentWidthFor(info.node));
      info.node.style.width = Math.round(width) + 'px';
      info.node.dataset.userSized = '1';
    }
    this.commit();
  }

  setAlt(value) {
    const info = this.getInfo();
    if (!info) return;
    const image = info.node.querySelector('img');
    if (image) image.setAttribute('alt', String(value || '').slice(0, 300));
    this.commit({ relayout: false });
  }

  resetSize() {
    const info = this.getInfo();
    if (!info) return;
    const image = info.node.querySelector('img');
    if (!image) return;
    const natural = image.naturalWidth || info.width;
    let width = Math.min(natural, this.contentWidthFor(info.node));
    let height = width * ((image.naturalHeight || info.height) / (image.naturalWidth || info.width));
    const maxHeight = this.contentHeightFor(info.node) * 0.92;
    if (height > maxHeight && maxHeight > 0) {
      width *= maxHeight / height;
      height = maxHeight;
    }
    if (info.kind === 'float') {
      this.setFloatGeometry(info.node, {
        x: Number(info.node.dataset.x) || 0,
        y: Number(info.node.dataset.y) || 0,
        width,
        height
      });
    } else {
      info.node.style.width = Math.round(width) + 'px';
    }
    info.node.dataset.userSized = '1';
    this.commit();
  }

  /* ------------------------------------------------------------------ */
  /* Conversión entre imagen en flujo y flotante                        */
  /* ------------------------------------------------------------------ */

  promoteInline(info) {
    const span = info.node;
    const holder = span.closest('.a4-content > *');
    if (!holder) return null;
    const image = span.querySelector('img');
    if (!image) return null;
    const figure = this.createFigure(image.currentSrc || image.src, {
      alt: image.alt || '',
      naturalWidth: image.naturalWidth || undefined,
      naturalHeight: image.naturalHeight || undefined,
      width: info.width,
      mode: 'inline',
      align: 'center'
    });
    const onlyImage = !holder.textContent.trim() && !holder.querySelector('table, .math-block, .math-inline');
    if (onlyImage) holder.replaceWith(figure);
    else {
      holder.after(figure);
      span.remove();
    }
    this.select(figure);
    return this.getInfo();
  }

  figureToFloat(info, wrap) {
    const figure = info.node;
    const page = figure.closest('.a4-page');
    if (!page) return;
    const image = figure.querySelector('img');
    if (!image) return;
    const scale = this.getScale();
    const figureRect = figure.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();
    const x = (figureRect.left - pageRect.left) / scale;
    const y = (figureRect.top - pageRect.top) / scale;
    const width = info.width;
    const height = info.height;
    const id = figure.dataset.imageId || uid('img');
    const anchor = this.createAnchor(id);
    const align = figure.dataset.align || 'left';
    const float = this.createFloat(image.currentSrc || image.src, {
      id,
      alt: image.alt || '',
      wrap,
      align,
      x,
      y,
      width,
      height
    });
    figure.replaceWith(anchor);
    page.appendChild(float);
    this.setFloatGeometry(float, { x, y, width, height });
    this.select(float);
    this.commit();
  }

  floatToFigure(info, mode) {
    const float = info.node;
    const page = float.closest('.a4-page');
    if (!page) return;
    const image = float.querySelector('img');
    if (!image) return;
    const id = float.dataset.imageId || uid('img');
    const anchor = this.findAnchor(id);
    const figure = this.createFigure(image.currentSrc || image.src, {
      alt: image.alt || '',
      naturalWidth: image.naturalWidth || undefined,
      naturalHeight: image.naturalHeight || undefined,
      width: info.width,
      mode,
      align: float.dataset.align || 'center'
    });
    figure.dataset.imageId = id;
    figure.dataset.userSized = '1';
    if (anchor && anchor.isConnected) anchor.replaceWith(figure);
    else {
      const content = page.querySelector('.a4-content');
      if (content) content.appendChild(figure);
    }
    float.remove();
    this.select(figure);
    this.commit();
  }

  findAnchor(imageId) {
    if (!imageId) return null;
    const anchors = this.pagesEl.querySelectorAll('.image-anchor[data-image-anchor]');
    for (const anchor of anchors) {
      if (anchor.dataset.imageAnchor === imageId) return anchor;
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Duplicar y eliminar                                                */
  /* ------------------------------------------------------------------ */

  copySelected() {
    const info = this.getInfo();
    if (!info) return;
    const node = info.node;
    let clone;
    if (info.kind === 'float') {
      const page = node.closest('.a4-page');
      if (!page) return;
      const oldId = node.dataset.imageId || '';
      const newId = uid('img');
      clone = node.cloneNode(true);
      clone.classList.remove('is-selected');
      clone.dataset.imageId = newId;
      clone.dataset.x = String((Number(node.dataset.x) || 0) + 18);
      clone.dataset.y = String((Number(node.dataset.y) || 0) + 18);
      clone.dataset.userSized = '1';
      page.appendChild(clone);
      this.clampFloat(clone);
      const oldAnchor = this.findAnchor(oldId);
      const anchor = this.createAnchor(newId);
      if (oldAnchor && oldAnchor.isConnected) oldAnchor.after(anchor);
      else {
        const content = page.querySelector('.a4-content');
        if (content) content.prepend(anchor);
      }
    } else {
      clone = node.cloneNode(true);
      clone.classList.remove('is-selected');
      if (clone.classList.contains('doc-figure')) clone.dataset.bid = uid('b');
      clone.dataset.imageId = uid('img');
      clone.dataset.userSized = '1';
      node.after(clone);
    }
    this.app.afterMutation({ relayout: true, historyNow: true });
    window.requestAnimationFrame(() => this.select(clone));
  }

  deleteSelected() {
    const info = this.getInfo();
    if (!info) return false;
    const node = info.node;
    const id = node.dataset.imageId;
    if (id) {
      const anchor = this.findAnchor(id);
      if (anchor) anchor.remove();
    }
    node.remove();
    if (this.selected === node) this.deselect({ silent: true });
    this.app.afterMutation({ relayout: true, historyNow: true });
    this.notify();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Persistencia de flotantes                                          */
  /* ------------------------------------------------------------------ */

  detachFloats() {
    const pages = Array.from(this.pagesEl.querySelectorAll('.a4-page'));
    const floats = [];
    this.pagesEl.querySelectorAll('.doc-float-image').forEach((node) => {
      const page = node.closest('.a4-page');
      floats.push({ node, pageIndex: page ? pages.indexOf(page) : 0 });
      node.remove();
    });
    return floats;
  }

  attachFloats(items, pageCount = 0) {
    if (!items || !items.length) return;
    const pages = Array.from(this.pagesEl.querySelectorAll('.a4-page'));
    if (!pages.length) return;
    items.forEach((item) => {
      const node = item.node;
      if (!node) return;
      let index = Number.isFinite(item.pageIndex) ? item.pageIndex : 0;
      const anchor = this.findAnchor(node.dataset.imageId);
      if (anchor) {
        const anchorPage = anchor.closest('.a4-page');
        const found = pages.indexOf(anchorPage);
        if (found >= 0) index = found;
      }
      const limit = pageCount || pages.length;
      index = clamp(index, 0, Math.max(0, limit - 1));
      const page = pages[index] || pages[pages.length - 1];
      if (!page) return;
      page.appendChild(node);
      this.clampFloat(node);
    });
  }

  restoreFloats(list) {
    if (!Array.isArray(list) || !list.length) return;
    const items = [];
    list.forEach((data) => {
      if (!data || !data.src) return;
      const node = this.createFloat(data.src, {
        id: data.id || uid('img'),
        alt: data.alt || '',
        wrap: data.wrap,
        align: data.align,
        x: data.x,
        y: data.y,
        width: data.width,
        height: data.height
      });
      node.dataset.userSized = '1';
      items.push({ node, pageIndex: Number(data.pageIndex) || 0 });
    });
    this.attachFloats(items);
  }

  serializeFloats() {
    const pages = Array.from(this.pagesEl.querySelectorAll('.a4-page'));
    return Array.from(this.pagesEl.querySelectorAll('.doc-float-image')).map((node) => {
      const page = node.closest('.a4-page');
      const image = node.querySelector('img');
      return {
        id: node.dataset.imageId || '',
        pageIndex: Math.max(0, pages.indexOf(page)),
        x: Number(node.dataset.x) || 0,
        y: Number(node.dataset.y) || 0,
        width: parseFloat(node.style.width) || node.offsetWidth || 0,
        height: parseFloat(node.style.height) || node.offsetHeight || 0,
        wrap: node.dataset.wrap === 'behind' ? 'behind' : 'front',
        align: node.dataset.align || 'left',
        alt: image ? (image.getAttribute('alt') || '') : '',
        src: image ? (image.getAttribute('src') || '') : ''
      };
    }).filter((item) => item.src);
  }

  commit(options = {}) {
    this.app.afterMutation({
      relayout: options.relayout !== false,
      historyNow: true
    });
    this.notify();
  }

  refresh() {
    if (this.selected && !this.selected.isConnected) this.deselect({ silent: true });
    this.updateOverlay();
  }
}
