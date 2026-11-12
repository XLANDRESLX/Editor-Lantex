import {
  clamp, copyText, debounce, downloadBlob, escapeHtml, formatNumber,
  mm2px, observeResize, slug, Store, walkTextNodes
} from './util.js';
import {
  Config, DEFAULT_DOC_SETTINGS, MARGIN_PRESETS, PAPER_SIZES,
  applyDocumentSettings, applyTheme, detectMarginPreset, getPageMetrics, sanitizeSettings
} from './config.js';
import { DocStorage } from './storage.js';
import { Parser } from './parser.js';
import { SelectionManager } from './selection.js';
import { HistoryManager } from './history.js';
import { Paginator } from './pagination.js';
import { Editor } from './editor.js';
import { ImageManager } from './images.js';
import { Exporter } from './exporter.js';

const DEFAULT_TITLE = 'Colas M/M/1';

const DEFAULT_MARKDOWN = `# Colas M/M/1

Un sistema **M/M/1** modela una cola con llegadas Poisson, tiempos de servicio exponenciales y un único servidor. Es el punto de partida para analizar tiempos de espera, utilización y estabilidad.

Sea $\\lambda$ la tasa media de llegadas y $\\mu$ la tasa media de servicio. La intensidad de tráfico se define como:

$$\\rho = \\frac{\\lambda}{\\mu}, \\qquad \\rho < 1$$

## Medidas principales

| Medida | Expresión | Interpretación |
| --- | --- | --- |
| Utilización del servidor | $\\rho$ | Fracción del tiempo que está ocupado |
| Número medio en el sistema | $\\frac{\\rho}{1-\\rho}$ | Clientes en cola y en servicio |
| Tiempo medio en el sistema | $\\frac{1}{\\mu-\\lambda}$ | Espera más servicio |

> Si $\\rho \\ge 1$, la cola crece sin límite: el sistema no es estable.

## Cómo usar este editor

- Escribe directamente sobre la hoja A4, como en un procesador de textos.
- Pega Markdown generado por una IA: se convierte en contenido editable.
- Inserta imágenes, tablas, enlaces, saltos de página y fórmulas desde la barra superior.
- Todo se guarda automáticamente en este navegador. Usa **Imprimir → Guardar como PDF** para obtener la mejor calidad.
`;

const TEXT_COLORS = [
  '#111827', '#374151', '#6b7280', '#9ca3af', '#ffffff', '#000000',
  '#7f1d1d', '#b91c1c', '#dc2626', '#ea580c', '#d97706', '#ca8a04',
  '#4d7c0f', '#15803d', '#0f766e', '#0e7490', '#1d4ed8', '#1e40af',
  '#6d28d9', '#a21caf', '#be185d', '#9f1239', '#78350f', '#334155'
];

const HIGHLIGHT_COLORS = [
  '#fef08a', '#fde68a', '#fcd34d', '#fdba74', '#fca5a5', '#f9a8d4',
  '#e9d5ff', '#c4b5fd', '#a5b4fc', '#93c5fd', '#a7f3d0', '#86efac',
  '#d9f99d', '#fef3c7', '#f1f5f9', '#e2e8f0', '#dbeafe', '#ede9fe',
  '#ffe4e6', '#ccfbf1', '#f5f5f4', '#e7e5e4', '#fecaca', '#bfdbfe'
];

const FORMULA_SYMBOLS = [
  { tex: '\\frac{a}{b}', label: 'a/b' },
  { tex: 'x^{2}', label: 'x²' },
  { tex: 'x_{n}', label: 'xₙ' },
  { tex: '\\sqrt{x}', label: '√x' },
  { tex: '\\sqrt[n]{x}', label: 'ⁿ√x' },
  { tex: '\\sum_{i=1}^{n}', label: 'Σ' },
  { tex: '\\prod_{i=1}^{n}', label: '∏' },
  { tex: '\\int_{a}^{b}', label: '∫' },
  { tex: '\\lim_{x \\to 0}', label: 'lím' },
  { tex: '\\infty', label: '∞' },
  { tex: '\\partial', label: '∂' },
  { tex: '\\nabla', label: '∇' },
  { tex: '\\alpha', label: 'α' },
  { tex: '\\beta', label: 'β' },
  { tex: '\\gamma', label: 'γ' },
  { tex: '\\delta', label: 'δ' },
  { tex: '\\lambda', label: 'λ' },
  { tex: '\\mu', label: 'μ' },
  { tex: '\\sigma', label: 'σ' },
  { tex: '\\theta', label: 'θ' },
  { tex: '\\pi', label: 'π' },
  { tex: '\\omega', label: 'ω' },
  { tex: '\\le', label: '≤' },
  { tex: '\\ge', label: '≥' },
  { tex: '\\ne', label: '≠' },
  { tex: '\\approx', label: '≈' },
  { tex: '\\pm', label: '±' },
  { tex: '\\times', label: '×' },
  { tex: '\\div', label: '÷' },
  { tex: '\\to', label: '→' },
  { tex: '\\Rightarrow', label: '⇒' },
  { tex: '\\in', label: '∈' },
  { tex: '\\forall', label: '∀' },
  { tex: '\\exists', label: '∃' },
  { tex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', label: 'matriz' }
];

const ZOOM_STEPS = [0.4, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];

class LantexApp {
  constructor() {
    this.ready = false;
    this.zoomMode = 'fit';
    this.zoomScale = 1;
    this.pendingColorKind = 'foreColor';
    this.lastSaveState = 'saved';
    this.selectedFormula = null;
    this.editingFormula = null;
    this.refreshStatsSoon = debounce(() => this.updateStats(), 140);
    this.scheduleSave = debounce(() => this.saveNow(), 900);
    this.scheduleZoom = debounce(() => this.applyZoom(this.zoomMode === 'fit' ? 'fit' : this.zoomScale), 120);
  }

  /* ------------------------------------------------------------------ */
  /* Arranque                                                           */
  /* ------------------------------------------------------------------ */

  async init() {
    this.cacheDom();
    Config.load();
    applyTheme(Config.data.theme);
    if (this.inspector) this.inspector.hidden = !Config.data.panelOpen;

    this.settings = applyDocumentSettings({ ...DEFAULT_DOC_SETTINGS });
    this.zoomMode = Config.data.zoom === 'fit' ? 'fit' : 'manual';
    this.zoomScale = this.zoomMode === 'manual' ? clamp(Number(Config.data.zoom) || 1, 0.3, 2) : 1;

    this.selection = new SelectionManager(this.pagesEl);
    this.paginator = new Paginator(this);
    this.editor = new Editor(this);
    this.images = new ImageManager(this);
    this.exporter = new Exporter(this);
    this.history = new HistoryManager({
      capture: () => this.captureState(),
      restore: (state) => this.restoreState(state),
      selection: this.selection,
      max: 40,
      onChange: (manager, reason) => this.onHistoryChange(manager, reason)
    });

    this.buildSwatches();
    this.buildFormulaSymbols();
    this.bindMenuEvents();
    this.bindActions();
    this.bindToolbar();
    this.bindDialogs();
    this.bindSettings();
    this.bindImageControls();
    this.bindFiles();
    this.bindKeyboard();
    this.bindWindowEvents();
    this.bindDropSelectors();

    const record = await this.loadRecord();
    this.applyRecord(record);
    this.ready = true;
    this.onLayoutComplete({});
    this.syncSettingsUI();
    this.syncConfigUI();
    this.updateStats();
    this.updateHistoryButtons();
    this.createIcons();
    this.showEmptyHint();
    this.markSaved('saved');

    this.saveConfig();
  }

  cacheDom() {
    this.pagesEl = document.getElementById('pages');
    this.pagesWrap = document.getElementById('pagesWrap');
    this.pagesSizer = document.getElementById('pagesSizer');
    this.emptyHint = document.getElementById('emptyHint');
    this.docTitle = document.getElementById('docTitle');
    this.saveState = document.getElementById('saveState');
    this.saveStateText = document.getElementById('saveStateText');
    this.docMeta = document.getElementById('docMeta');
    this.inspector = document.getElementById('inspector');
    this.inspectorImage = document.getElementById('inspectorImage');
    this.imageGroup = document.getElementById('imageGroup');
    this.pageIndicator = document.getElementById('pageIndicator');
    this.wordCount = document.getElementById('wordCount');
    this.charCount = document.getElementById('charCount');
    this.errorBadge = document.getElementById('errorBadge');
    this.errorCount = document.getElementById('errorCount');
    this.zoomLabel = document.getElementById('zoomLabel');
    this.zoomModeLabel = document.getElementById('zoomModeLabel');
    this.inspectorPages = document.getElementById('inspectorPages');
    this.inspectorWords = document.getElementById('inspectorWords');
    this.inspectorChars = document.getElementById('inspectorChars');
    this.inspectorImages = document.getElementById('inspectorImages');
    this.inspectorErrors = document.getElementById('inspectorErrors');
    this.imageInput = document.getElementById('imageInput');
    this.mdInput = document.getElementById('mdInput');
    this.customColorInput = document.getElementById('customColorInput');
    this.formulaTex = document.getElementById('formulaTex');
    this.formulaPreview = document.getElementById('formulaPreview');
    this.formulaError = document.getElementById('formulaError');
  }

  /* ------------------------------------------------------------------ */
  /* Documento y almacenamiento                                         */
  /* ------------------------------------------------------------------ */

  defaultSettings() {
    const base = { ...DEFAULT_DOC_SETTINGS, margins: { ...DEFAULT_DOC_SETTINGS.margins } };
    if (Config.data.pdf) {
      if (Config.data.pdf.header) base.header = Config.data.pdf.header;
      if (Config.data.pdf.footer) base.footer = Config.data.pdf.footer;
    }
    return sanitizeSettings(base);
  }

  createDefaultRecord() {
    return {
      version: 2,
      title: DEFAULT_TITLE,
      html: Parser.markdownToFlowHtml(DEFAULT_MARKDOWN),
      settings: this.defaultSettings(),
      floats: []
    };
  }

  emptyRecord() {
    return {
      version: 2,
      title: 'Documento sin título',
      html: '<p data-bid="b-empty"><br></p>',
      settings: { ...DEFAULT_DOC_SETTINGS, margins: { ...DEFAULT_DOC_SETTINGS.margins } },
      floats: []
    };
  }

  async loadRecord() {
    let record = null;
    try {
      record = await DocStorage.load();
    } catch (error) {
      console.warn('[Lantex] No se pudo leer el documento guardado:', error);
    }
    if (record && typeof record === 'object' && (record.html || record.markdown)) {
      return this.normalizeRecord(record);
    }

    // Migración segura del editor anterior: Markdown plano en LocalStorage.
    const legacy = Store.get('editor-content', null);
    if (legacy && String(legacy).trim()) {
      const migrated = {
        version: 2,
        title: 'Documento importado',
        html: Parser.markdownToFlowHtml(String(legacy)),
        settings: this.defaultSettings(),
        floats: []
      };
      this.toast('Se importó el documento guardado por la versión anterior.', 'ok');
      return migrated;
    }

    return this.createDefaultRecord();
  }

  normalizeRecord(record) {
    let html = record.html;
    if (!html && record.markdown) {
      html = Parser.markdownToFlowHtml(String(record.markdown));
    }
    return {
      version: 2,
      title: typeof record.title === 'string' && record.title.trim() ? record.title.trim() : 'Documento sin título',
      html: String(html || '<p data-bid="b-empty"><br></p>'),
      settings: sanitizeSettings(record.settings || this.defaultSettings()),
      floats: Array.isArray(record.floats) ? record.floats : []
    };
  }

  applyRecord(record) {
    this.settings = applyDocumentSettings(sanitizeSettings(record.settings));
    this.paginator.setSettings(this.settings);
    this.docTitle.value = record.title || 'Documento sin título';
    this.updateDocumentTitle();
    this.setPageHtml(record.html);
    this.images.deselect({ silent: true });
    this.relayout();
    this.images.restoreFloats(record.floats || []);
    this.images.refresh();
    this.history.reset();
    this.applyZoom(this.zoomMode === 'fit' ? 'fit' : this.zoomScale);
    this.syncSettingsUI();
  }

  setPageHtml(html) {
    const { page, content } = this.paginator.createPage();
    this.pagesEl.replaceChildren(page);
    content.innerHTML = html && String(html).trim() ? html : '<p data-bid="b-empty"><br></p>';
    Parser.rerenderMath(content);
    this.images.deselect({ silent: true });
  }

  captureState() {
    return {
      title: this.docTitle.value.trim(),
      html: this.flowHtml(),
      floats: this.images.serializeFloats()
    };
  }

  serializeDoc() {
    const state = this.captureState();
    return {
      version: 2,
      title: state.title || 'Documento sin título',
      html: state.html,
      floats: state.floats,
      settings: this.settings,
      savedAt: Date.now()
    };
  }

  /**
   * Devuelve el flujo lógico del documento: todas las hojas concatenadas,
   * con los bloques partidos por la paginación unidos de nuevo. Es la base
   * para guardar, exportar Markdown y crear instantáneas del historial.
   */
  flowHtml() {
    const blocks = [];
    this.pagesEl.querySelectorAll('.a4-content').forEach((content) => {
      Array.from(content.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          if (!node.data.trim()) return;
          const paragraph = document.createElement('p');
          paragraph.setAttribute('data-bid', 'b-inline');
          paragraph.appendChild(node.cloneNode(true));
          blocks.push(paragraph);
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const clone = node.cloneNode(true);
        clone.classList.remove('is-selected');
        clone.querySelectorAll('.is-selected').forEach((el) => el.classList.remove('is-selected'));
        // Las fórmulas se guardan como TeX y se vuelven a renderizar al cargar.
        clone.querySelectorAll('.math-block[data-tex], .math-inline[data-tex]').forEach((el) => {
          el.innerHTML = '';
        });
        blocks.push(clone);
      });
    });

    const merged = [];
    blocks.forEach((block) => {
      if (block.hasAttribute && block.hasAttribute('data-split-tail')) {
        const id = block.getAttribute('data-split-tail');
        const prev = merged[merged.length - 1];
        if (prev && prev.getAttribute('data-split-head') === id && prev.tagName === block.tagName) {
          this.paginator.mergeSplitPair(prev, block);
          return;
        }
        block.removeAttribute('data-split-tail');
        block.classList.remove('split-tail');
      }
      if (block.hasAttribute && block.hasAttribute('data-split-head')) {
        block.removeAttribute('data-split-head');
        block.classList.remove('split-head');
      }
      merged.push(block);
    });

    return merged.map((block) => block.outerHTML).join('');
  }

  getMarkdown() {
    const container = document.createElement('div');
    container.innerHTML = this.flowHtml();
    container.querySelectorAll('.image-anchor').forEach((anchor) => anchor.remove());
    return Parser.htmlToMarkdown(container);
  }

  async saveNow({ sync = false } = {}) {
    if (!this.ready) return;
    this.setSaveState('saving');
    const doc = this.serializeDoc();
    let ok = false;
    if (sync) {
      ok = DocStorage.saveSync(doc);
    } else {
      try {
        const result = await DocStorage.save(doc);
        ok = !!(result && result.ok);
      } catch (error) {
        console.warn('[Lantex] Error al guardar:', error);
      }
    }
    this.setSaveState(ok ? 'saved' : 'error');
  }

  setSaveState(state) {
    this.lastSaveState = state;
    if (!this.saveState) return;
    this.saveState.setAttribute('data-state', state);
    if (this.saveStateText) {
      this.saveStateText.textContent = state === 'saving'
        ? 'Guardando…'
        : state === 'error'
          ? 'No se pudo guardar'
          : 'Guardado en este navegador';
    }
  }

  markSaved() {
    this.setSaveState('saved');
  }

  /* ------------------------------------------------------------------ */
  /* Estado de la aplicación                                            */
  /* ------------------------------------------------------------------ */

  onEdit() {
    this.history.schedule();
    this.scheduleSave();
    this.refreshStatsSoon();
    this.scheduleEmptyHint();
  }

  afterMutation({ relayout = true, historyNow = false } = {}) {
    if (relayout) this.relayout();
    this.refreshStatsSoon();
    this.scheduleEmptyHint();
    this.scheduleSave();
    if (historyNow) this.history.commit();
    else this.history.schedule();
    this.updateHistoryButtons();
  }

  onLayoutComplete() {
    this.applyZoom(this.zoomMode === 'fit' ? 'fit' : this.zoomScale);
    this.images?.refresh();
    this.refreshStatsSoon();
    this.scheduleEmptyHint();
    this.syncSettingsUI();
  }

  onLayoutError(error) {
    this.toast('No se pudo redistribuir el documento: ' + (error && error.message ? error.message : 'error de paginación'), 'err');
  }

  relayout() {
    if (!this.paginator) return;
    this.paginator.relayout();
  }

  onSelectionChanged() {
    if (this.selection.isInPages(window.getSelection()?.anchorNode)) {
      this.selection.save();
    }
    this.refreshStatsSoon();
  }

  onHistoryChange(manager) {
    this.updateHistoryButtons();
    if (manager && manager.restoring) return;
    this.scheduleSave();
  }

  updateHistoryButtons() {
    const canUndo = this.history ? this.history.canUndo() : false;
    const canRedo = this.history ? this.history.canRedo() : false;
    document.querySelectorAll('[data-action="undo"]').forEach((button) => { button.disabled = !canUndo; });
    document.querySelectorAll('[data-action="redo"]').forEach((button) => { button.disabled = !canRedo; });
  }

  undo() {
    this.images.deselect({ silent: true });
    if (!this.history.undo()) this.toast('No hay más cambios que deshacer.', 'info');
    this.updateHistoryButtons();
    this.scheduleSave();
  }

  redo() {
    this.images.deselect({ silent: true });
    if (!this.history.redo()) this.toast('No hay cambios que rehacer.', 'info');
    this.updateHistoryButtons();
    this.scheduleSave();
  }

  restoreState(state) {
    if (!state) return;
    if (typeof state.title === 'string') {
      this.docTitle.value = state.title;
      this.updateDocumentTitle();
    }
    this.images.deselect({ silent: true });
    this.setPageHtml(state.html);
    this.relayout();
    this.images.restoreFloats(state.floats || []);
    this.images.refresh();
    this.applyZoom(this.zoomMode === 'fit' ? 'fit' : this.zoomScale);
    this.refreshStatsSoon();
    this.syncSettingsUI();
  }

  /* ------------------------------------------------------------------ */
  /* Estadísticas y barra de estado                                     */
  /* ------------------------------------------------------------------ */

  updateStats() {
    if (!this.pagesEl) return;
    const pages = Array.from(this.pagesEl.querySelectorAll('.a4-page'));
    let text = '';
    this.pagesEl.querySelectorAll('.a4-content').forEach((content) => {
      walkTextNodes(content, (node) => { text += node.data + ' '; });
    });
    text = text.replace(/\u200B/g, ' ').trim();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const chars = text.replace(/\s+/g, '').length;
    const imageCount = this.pagesEl.querySelectorAll('.doc-figure img, .doc-inline-img img, .doc-float-image img').length;
    const errors = this.pagesEl.querySelectorAll('.math-error').length;
    const pageIndex = this.currentPageIndex();
    const paper = PAPER_SIZES[this.settings.paper] || PAPER_SIZES.a4;
    const pageLabel = paper.label + (this.settings.orientation === 'landscape' ? ' horizontal' : '');

    if (this.pageIndicator) this.pageIndicator.textContent = 'Página ' + (pageIndex + 1) + ' de ' + Math.max(1, pages.length);
    if (this.wordCount) this.wordCount.textContent = formatNumber(words) + (words === 1 ? ' palabra' : ' palabras');
    if (this.charCount) this.charCount.textContent = formatNumber(chars) + (chars === 1 ? ' carácter' : ' caracteres');
    if (this.docMeta) this.docMeta.textContent = pageLabel + ' · ' + pages.length + (pages.length === 1 ? ' página' : ' páginas');
    if (this.inspectorPages) this.inspectorPages.textContent = String(pages.length);
    if (this.inspectorWords) this.inspectorWords.textContent = formatNumber(words);
    if (this.inspectorChars) this.inspectorChars.textContent = formatNumber(chars);
    if (this.inspectorImages) this.inspectorImages.textContent = String(imageCount);
    if (this.inspectorErrors) this.inspectorErrors.textContent = String(errors);
    if (this.errorBadge) this.errorBadge.hidden = errors === 0;
    if (this.errorCount) this.errorCount.textContent = String(errors);
    if (this.zoomLabel) this.zoomLabel.textContent = Math.round(this.zoomScale * 100) + '%';
    if (this.zoomModeLabel) this.zoomModeLabel.textContent = this.zoomMode === 'fit' ? 'Ajustado al ancho' : 'Zoom manual';

    this.showEmptyHint(words === 0 && imageCount === 0);
  }

  currentPageIndex() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount) {
      const content = this.selection.contentOf(selection.anchorNode);
      if (content) {
        const page = content.closest('.a4-page');
        if (page) return Number(page.getAttribute('data-page-index')) || 0;
      }
    }
    if (this.images && this.images.selected) {
      const page = this.images.selected.closest('.a4-page');
      if (page) return Number(page.getAttribute('data-page-index')) || 0;
    }
    const pages = Array.from(this.pagesEl.querySelectorAll('.a4-page'));
    if (!pages.length) return 0;
    const wrapRect = this.pagesWrap.getBoundingClientRect();
    const target = wrapRect.top + Math.min(wrapRect.height * 0.35, 280);
    for (let index = 0; index < pages.length; index++) {
      const rect = pages[index].getBoundingClientRect();
      if (rect.top <= target && rect.bottom >= target) return index;
    }
    for (let index = 0; index < pages.length; index++) {
      const rect = pages[index].getBoundingClientRect();
      if (rect.bottom > wrapRect.top && rect.top < wrapRect.bottom) return index;
    }
    return 0;
  }

  scheduleEmptyHint() {
    if (this.emptyHintFrame) return;
    this.emptyHintFrame = window.requestAnimationFrame(() => {
      this.emptyHintFrame = 0;
      this.showEmptyHint();
    });
  }

  showEmptyHint(force) {
    if (!this.emptyHint) return;
    if (typeof force === 'boolean') {
      this.emptyHint.hidden = !force;
      return;
    }
    let text = '';
    this.pagesEl.querySelectorAll('.a4-content').forEach((content) => {
      walkTextNodes(content, (node) => { text += node.data; });
    });
    const hasImages = !!this.pagesEl.querySelector('.doc-figure, .doc-inline-img, .doc-float-image');
    this.emptyHint.hidden = !!text.trim() || hasImages;
  }

  /* ------------------------------------------------------------------ */
  /* Zoom                                                               */
  /* ------------------------------------------------------------------ */

  applyZoom(mode = this.zoomMode) {
    const page = this.pagesEl.querySelector('.a4-page');
    if (!page) return;
    const pages = Array.from(this.pagesEl.querySelectorAll('.a4-page'));
    const naturalWidth = page.offsetWidth || mm2px(getPageMetrics(this.settings).width);
    const naturalHeight = pages.reduce((total, item) => total + item.offsetHeight, 0) + 30 * Math.max(0, pages.length - 1);
    let scale;
    if (mode === 'fit' || mode === undefined || mode === null) {
      this.zoomMode = 'fit';
      const computed = window.getComputedStyle(this.pagesWrap);
      const available = this.pagesWrap.clientWidth - (parseFloat(computed.paddingLeft) || 0) - (parseFloat(computed.paddingRight) || 0);
      scale = available > 40 ? clamp(available / naturalWidth, 0.3, 1.35) : 1;
    } else {
      const numeric = typeof mode === 'number' ? mode : Number(mode);
      if (!Number.isFinite(numeric)) return;
      this.zoomMode = 'manual';
      scale = clamp(numeric, 0.3, 2);
    }
    this.zoomScale = Math.round(scale * 1000) / 1000;
    // La escala se aplica desde la esquina superior izquierda. #pages conserva
    // su ancho natural para que las hojas queden alineadas con #pagesSizer y
    // no se desplacen hacia la derecha al ampliar.
    this.pagesEl.style.width = naturalWidth + 'px';
    this.pagesEl.style.transform = 'scale(' + this.zoomScale + ')';
    this.pagesEl.style.transformOrigin = 'top left';
    if (this.pagesSizer) {
      this.pagesSizer.style.width = Math.round(naturalWidth * this.zoomScale) + 'px';
      this.pagesSizer.style.height = Math.ceil(naturalHeight * this.zoomScale) + 'px';
    }
    if (this.zoomLabel) this.zoomLabel.textContent = Math.round(this.zoomScale * 100) + '%';
    if (this.zoomModeLabel) this.zoomModeLabel.textContent = this.zoomMode === 'fit' ? 'Ajustado al ancho' : 'Zoom manual';
    if (this.images) this.images.updateOverlay();
  }

  setZoom(mode) {
    this.applyZoom(mode);
    Config.data.zoom = this.zoomMode === 'fit' ? 'fit' : this.zoomScale;
    this.saveConfig();
  }

  zoomIn() {
    const next = ZOOM_STEPS.find((step) => step > this.zoomScale + 0.005);
    this.setZoom(next || ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  }

  zoomOut() {
    const previous = ZOOM_STEPS.slice().reverse().find((step) => step < this.zoomScale - 0.005);
    this.setZoom(previous || ZOOM_STEPS[0]);
  }

  zoomFit() {
    this.setZoom('fit');
  }

  /* ------------------------------------------------------------------ */
  /* Título, configuración y ajustes de página                          */
  /* ------------------------------------------------------------------ */

  updateDocumentTitle() {
    const title = this.docTitle.value.trim() || 'Documento sin título';
    document.title = title + ' · Lantex';
  }

  onTitleInput() {
    this.updateDocumentTitle();
    this.history.schedule();
    this.scheduleSave();
  }

  saveConfig() {
    Config.data.theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    Config.data.panelOpen = !this.inspector.hidden;
    Config.data.zoom = this.zoomMode === 'fit' ? 'fit' : this.zoomScale;
    Config.data.pdf.header = this.settings.header || '';
    Config.data.pdf.footer = this.settings.footer || '';
    Config.save();
  }

  updateSettings(patch, { save = true, relayout = true } = {}) {
    const merged = { ...this.settings, ...patch };
    if (patch.margins) merged.margins = { ...this.settings.margins, ...patch.margins };
    this.settings = applyDocumentSettings(merged);
    this.paginator.setSettings(this.settings);
    this.syncSettingsUI();
    if (relayout) this.relayout();
    if (save) this.scheduleSave();
    this.scheduleZoom();
  }

  syncConfigUI() {
    const themeSelect = document.getElementById('cfgTheme');
    if (themeSelect) themeSelect.value = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    const toggle = document.querySelector('[data-action="toggle-inspector"]');
    if (toggle) toggle.setAttribute('aria-pressed', this.inspector && !this.inspector.hidden ? 'true' : 'false');
  }

  syncSettingsUI() {
    if (!this.settings) return;
    document.querySelectorAll('[data-setting="paper"]').forEach((select) => { select.value = this.settings.paper; });
    document.querySelectorAll('[data-setting="orientation"]').forEach((select) => { select.value = this.settings.orientation; });
    const preset = detectMarginPreset(this.settings.margins);
    ['marginPreset', 'marginPresetToolbar'].forEach((id) => {
      const select = document.getElementById(id);
      if (select) select.value = preset;
    });
    document.querySelectorAll('[data-margin]').forEach((input) => {
      input.value = String(this.settings.margins[input.getAttribute('data-margin')]);
    });
    document.querySelectorAll('[data-orientation]').forEach((button) => {
      button.setAttribute('aria-pressed', button.getAttribute('data-orientation') === this.settings.orientation ? 'true' : 'false');
    });
    const baseFamily = document.getElementById('baseFontFamily');
    if (baseFamily) {
      const normalize = (value) => String(value || '').replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      const option = Array.from(baseFamily.options).find((item) => normalize(item.value) === normalize(this.settings.fontFamily));
      baseFamily.value = option ? option.value : '';
    }
    const baseSize = document.getElementById('baseFontSize');
    if (baseSize) baseSize.value = String(this.settings.fontSize);
    ['cfgHeader', 'cfgHeaderDialog'].forEach((id) => {
      const input = document.getElementById(id);
      if (input && document.activeElement !== input) input.value = this.settings.header || '';
    });
    ['cfgFooter', 'cfgFooterDialog'].forEach((id) => {
      const input = document.getElementById(id);
      if (input && document.activeElement !== input) input.value = this.settings.footer || '';
    });
  }

  resetPage() {
    const margins = { ...MARGIN_PRESETS.normal.margins };
    this.updateSettings({ paper: 'a4', orientation: 'portrait', margins });
    this.toast('Página restablecida a A4 vertical con márgenes normales.', 'ok');
  }

  toggleTheme() {
    const dark = !document.documentElement.classList.contains('dark');
    applyTheme(dark ? 'dark' : 'light');
    Config.data.theme = dark ? 'dark' : 'light';
    this.saveConfig();
    const themeSelect = document.getElementById('cfgTheme');
    if (themeSelect) themeSelect.value = dark ? 'dark' : 'light';
  }

  toggleInspector(force) {
    if (!this.inspector) return;
    const open = typeof force === 'boolean' ? force : this.inspector.hidden;
    this.inspector.hidden = !open;
    document.querySelectorAll('[data-action="toggle-inspector"]').forEach((button) => {
      button.setAttribute('aria-pressed', open ? 'true' : 'false');
    });
    this.saveConfig();
    window.requestAnimationFrame(() => {
      this.applyZoom(this.zoomMode === 'fit' ? 'fit' : this.zoomScale);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Acciones de la barra                                               */
  /* ------------------------------------------------------------------ */

  bindActions() {
    document.addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-action]');
      if (!actionEl || actionEl.disabled) return;
      const action = actionEl.getAttribute('data-action');
      this.runAction(action, actionEl, event);
    });
  }

  runAction(action, element, event) {
    switch (action) {
      case 'undo': this.undo(); break;
      case 'redo': this.redo(); break;
      case 'font-smaller': this.withSelection(() => this.editor.stepFontSize(-0.5)); break;
      case 'font-larger': this.withSelection(() => this.editor.stepFontSize(0.5)); break;
      case 'bold': this.withSelection(() => this.editor.format('bold')); break;
      case 'italic': this.withSelection(() => this.editor.format('italic')); break;
      case 'underline': this.withSelection(() => this.editor.format('underline')); break;
      case 'strike': this.withSelection(() => this.editor.format('strike')); break;
      case 'clear-format': this.withSelection(() => this.editor.clearFormat()); break;
      case 'align-left': this.withSelection(() => this.editor.align('left')); break;
      case 'align-center': this.withSelection(() => this.editor.align('center')); break;
      case 'align-right': this.withSelection(() => this.editor.align('right')); break;
      case 'align-justify': this.withSelection(() => this.editor.align('justify')); break;
      case 'bullet-list': this.withSelection(() => this.editor.toggleList('insertUnorderedList')); break;
      case 'number-list': this.withSelection(() => this.editor.toggleList('insertOrderedList')); break;
      case 'indent': this.withSelection(() => this.editor.changeIndent(1)); break;
      case 'outdent': this.withSelection(() => this.editor.changeIndent(-1)); break;
      case 'insert-image':
        this.selection.save();
        this.imageInput?.click();
        break;
      case 'insert-table': this.openTableDialog(); break;
      case 'insert-link': this.openLinkDialog(); break;
      case 'insert-formula': this.openFormulaDialog(); break;
      case 'insert-pagebreak':
        this.withSelection(() => this.editor.insertPageBreak(), { restore: true });
        break;
      case 'insert-header': this.insertHeaderMarker(); break;
      case 'reset-page': this.resetPage(); break;
      case 'image-copy': this.images.copySelected(); break;
      case 'image-delete': this.images.deleteSelected(); break;
      case 'image-reset-size': this.images.resetSize(); break;
      case 'new-doc': this.newDocument(); break;
      case 'open-examples': this.openDialog(document.getElementById('dlgExamples')); break;
      case 'import-md': this.mdInput?.click(); break;
      case 'copy-markdown': this.copyMarkdown(); break;
      case 'copy-latex': this.copyLatex(); break;
      case 'download-md': this.downloadMarkdown(); break;
      case 'open-print': this.printDocument(); break;
      case 'open-pdf': this.exportPdf(); break;
      case 'open-settings': this.openSettings(); break;
      case 'toggle-theme': this.toggleTheme(); break;
      case 'toggle-inspector': this.toggleInspector(); break;
      case 'zoom-in': this.zoomIn(); break;
      case 'zoom-out': this.zoomOut(); break;
      case 'zoom-fit': this.zoomFit(); break;
      case 'clear-storage': this.clearStorage(); break;
      case 'remove-link':
        this.withSelection(() => this.editor.removeLink());
        this.closeDialog(document.getElementById('dlgLink'));
        break;
      default:
        break;
    }
    if (element && element.closest('.popover')) this.closeMenus();
  }

  withSelection(fn, options = {}) {
    try {
      if (options.reset) this.selection.clearBookmark();
      if (!this.editor.ensureSelection() && !options.allowEmpty) {
        // Sin cursor: la acción puede seguir siendo válida para la imagen seleccionada.
        if (!this.images?.selected) {
          this.toast('Haz clic sobre el documento para colocar el cursor.', 'info');
          return;
        }
      }
      const result = fn();
      if (result === false) this.toast('Esta acción necesita texto seleccionado o el cursor dentro de una hoja.', 'info');
    } catch (error) {
      console.error('[Lantex] Error al aplicar la acción:', error);
      this.toast('No se pudo aplicar la acción.', 'err');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Menús y popovers                                                   */
  /* ------------------------------------------------------------------ */

  bindMenuEvents() {
    document.querySelectorAll('[data-menu-toggle]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleMenu(button.getAttribute('data-menu-toggle'));
      });
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.menu-wrap')) this.closeMenus();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.closeMenus();
        this.deselectFormula();
      }
    });
  }

  toggleMenu(id) {
    const popover = document.getElementById(id);
    if (!popover) return;
    const willOpen = popover.hidden;
    this.closeMenus();
    if (!willOpen) return;
    // Mantiene la selección mientras se usa el menú.
    this.selection.save();
    popover.hidden = false;
    this.positionPopover(popover);
    document.querySelectorAll('[data-menu-toggle="' + id + '"]').forEach((button) => {
      button.setAttribute('aria-expanded', 'true');
      const wrap = button.closest('.menu-wrap');
      if (wrap) wrap.classList.add('is-open');
    });
  }

  positionPopover(popover) {
    if (!popover) return;
    popover.style.left = '';
    popover.style.right = '';
    popover.style.top = '';
    popover.style.bottom = '';

    const wrap = popover.closest('.menu-wrap');
    if (!wrap) return;

    const wrapRect = wrap.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Alinear horizontalmente para que nunca se desborde fuera de la pantalla
    if (wrapRect.left + popRect.width > viewportWidth - 10 || wrapRect.right > viewportWidth * 0.55) {
      popover.style.left = 'auto';
      popover.style.right = '0px';
    } else {
      popover.style.left = '0px';
      popover.style.right = 'auto';
    }

    // Comprobación de límites en pantalla
    const updatedRect = popover.getBoundingClientRect();
    if (updatedRect.right > viewportWidth - 8) {
      const shift = updatedRect.right - (viewportWidth - 8);
      popover.style.right = `${shift}px`;
    }
    if (updatedRect.left < 8) {
      popover.style.left = `${Math.max(0, 8 - wrapRect.left)}px`;
      popover.style.right = 'auto';
    }

    // Alinear verticalmente si se sale por debajo y hay espacio arriba
    if (wrapRect.bottom + popRect.height > viewportHeight - 10 && wrapRect.top > popRect.height + 10) {
      popover.style.top = 'auto';
      popover.style.bottom = 'calc(100% + 7px)';
    }
  }

  closeMenus() {
    document.querySelectorAll('.popover').forEach((popover) => {
      popover.hidden = true;
      popover.style.left = '';
      popover.style.right = '';
      popover.style.top = '';
      popover.style.bottom = '';
    });
    document.querySelectorAll('[data-menu-toggle]').forEach((button) => {
      button.setAttribute('aria-expanded', 'false');
      const wrap = button.closest('.menu-wrap');
      if (wrap) wrap.classList.remove('is-open');
    });
  }

  buildSwatches() {
    const fill = (container, colors, kind) => {
      if (!container) return;
      container.replaceChildren();
      colors.forEach((color) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'swatch';
        button.style.setProperty('--sw', color);
        button.style.backgroundColor = color;
        button.title = color;
        button.setAttribute('aria-label', 'Aplicar color ' + color);
        button.dataset.swatchColor = color;
        button.dataset.swatchKind = kind;
        container.appendChild(button);
      });
    };
    fill(document.getElementById('textSwatches'), TEXT_COLORS, 'foreColor');
    fill(document.getElementById('highlightSwatches'), HIGHLIGHT_COLORS, 'hiliteColor');

    document.addEventListener('click', (event) => {
      const swatch = event.target.closest('[data-swatch-color]');
      if (swatch) {
        const kind = swatch.getAttribute('data-swatch-kind');
        const color = swatch.getAttribute('data-swatch-color');
        this.withSelection(() => this.editor.applyColor(kind, color));
        this.closeMenus();
        return;
      }
      const custom = event.target.closest('[data-color-custom]');
      if (custom) {
        this.pendingColorKind = custom.getAttribute('data-color-custom');
        this.selection.save();
        const bar = document.getElementById(this.pendingColorKind === 'hiliteColor' ? 'highlightBar' : 'textColorBar');
        const current = bar ? getComputedStyle(bar).getPropertyValue('--sw').trim() : '';
        this.customColorInput.value = /^#[0-9a-f]{6}$/i.test(current) ? current : '#1f2937';
        this.customColorInput.click();
        this.closeMenus();
      }
    });

    if (this.customColorInput) {
      this.customColorInput.addEventListener('input', () => {
        const color = this.customColorInput.value;
        this.withSelection(() => this.editor.applyColor(this.pendingColorKind, color));
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Barra de formato                                                   */
  /* ------------------------------------------------------------------ */

  bindToolbar() {
    // Evita que los botones de formato roben la selección del documento.
    const formatBar = document.getElementById('formatBar');
    if (formatBar) {
      formatBar.addEventListener('mousedown', (event) => {
        const control = event.target.closest('button, select, input');
        if (!control) return;
        if (control.tagName === 'BUTTON') {
          event.preventDefault();
        } else {
          this.selection.save();
        }
      });
    }

    const blockStyle = document.getElementById('blockStyle');
    if (blockStyle) {
      blockStyle.addEventListener('change', () => {
        this.withSelection(() => this.editor.setBlockStyle(blockStyle.value));
      });
    }

    const fontFamily = document.getElementById('fontFamily');
    if (fontFamily) {
      fontFamily.addEventListener('change', () => {
        this.withSelection(() => this.editor.setFontFamily(fontFamily.value));
      });
    }

    const fontSize = document.getElementById('fontSizeInput');
    if (fontSize) {
      const commit = () => {
        const value = parseFloat(String(fontSize.value).replace(',', '.'));
        if (!Number.isFinite(value) || value < 5 || value > 120) {
          fontSize.value = String(Math.round(this.editor.currentFontSize() * 10) / 10);
          return;
        }
        this.withSelection(() => this.editor.setFontSize(value));
        fontSize.blur();
      };
      fontSize.addEventListener('change', commit);
      fontSize.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      });
    }

    document.querySelectorAll('[data-line-spacing]').forEach((button) => {
      button.addEventListener('click', () => {
        this.withSelection(() => this.editor.setLineSpacing(Number(button.getAttribute('data-line-spacing'))));
        this.closeMenus();
      });
    });

    document.querySelectorAll('[data-para-spacing]').forEach((button) => {
      button.addEventListener('click', () => {
        this.withSelection(() => this.editor.setParagraphSpacing(Number(button.getAttribute('data-para-spacing'))));
        this.closeMenus();
      });
    });

    document.querySelectorAll('[data-open-inspector]').forEach((button) => {
      button.addEventListener('click', () => {
        this.toggleInspector(true);
        this.closeMenus();
        window.requestAnimationFrame(() => {
          const section = document.getElementById('inspectorPage');
          if (section) section.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Diálogos                                                           */
  /* ------------------------------------------------------------------ */

  bindDialogs() {
    document.querySelectorAll('[data-close-dialog]').forEach((button) => {
      button.addEventListener('click', () => this.closeDialog(button.closest('dialog')));
    });

    document.querySelectorAll('dialog').forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    });

    const tableForm = document.getElementById('formTable');
    if (tableForm) {
      tableForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const rows = document.getElementById('tableRows')?.value;
        const cols = document.getElementById('tableCols')?.value;
        const header = document.getElementById('tableHeader')?.checked;
        this.closeDialog(document.getElementById('dlgTable'));
        this.withSelection(() => this.editor.insertTable(rows, cols, header));
      });
    }

    const linkForm = document.getElementById('formLink');
    if (linkForm) {
      linkForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = document.getElementById('linkText')?.value.trim() || '';
        const url = document.getElementById('linkUrl')?.value.trim() || '';
        this.closeDialog(document.getElementById('dlgLink'));
        if (!url) {
          this.withSelection(() => this.editor.removeLink());
          return;
        }
        this.withSelection(() => {
          if (!this.editor.applyLink(url, text)) this.toast('No se pudo insertar el enlace.', 'err');
        });
      });
    }

    const formulaForm = document.getElementById('formFormula');
    if (formulaForm) {
      formulaForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const tex = this.formulaTex ? this.formulaTex.value.trim() : '';
        const isBlock = document.querySelector('input[name="formulaDisplay"]:checked')?.value === 'block';
        this.closeDialog(document.getElementById('dlgFormula'));

        if (!tex) {
          if (this.editingFormula && this.editingFormula.isConnected) {
            this.editingFormula.remove();
            this.editingFormula = null;
            this.deselectFormula();
            this.afterMutation({ relayout: true, historyNow: true });
            this.toast('Fórmula eliminada.', 'info');
          }
          return;
        }

        if (this.editingFormula && this.editingFormula.isConnected) {
          const newNode = Parser.mathNode(tex, isBlock);
          this.editingFormula.replaceWith(newNode);
          this.editingFormula = null;
          this.deselectFormula();
          this.afterMutation({ relayout: true, historyNow: true });
          this.toast('Fórmula actualizada.', 'ok');
        } else {
          this.withSelection(() => this.editor.insertFormula(tex, isBlock), { allowEmpty: true });
          this.toast('Fórmula insertada.', 'ok');
        }
      });
    }

    const btnEditFormula = document.getElementById('btnEditFormula');
    if (btnEditFormula) {
      btnEditFormula.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openFormulaDialog(this.selectedFormula);
      });
    }

    const btnDeleteFormula = document.getElementById('btnDeleteFormula');
    if (btnDeleteFormula) {
      btnDeleteFormula.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.deleteSelectedFormula();
      });
    }

    document.querySelectorAll('input[name="formulaDisplay"]').forEach((radio) => {
      radio.addEventListener('change', () => this.renderFormulaPreview());
    });

    document.querySelectorAll('[data-example]').forEach((button) => {
      button.addEventListener('click', () => {
        const name = button.getAttribute('data-example');
        this.closeDialog(document.getElementById('dlgExamples'));
        this.loadExample(name);
      });
    });

    const settingsForm = document.getElementById('formSettings');
    if (settingsForm) {
      settingsForm.addEventListener('submit', (event) => {
        event.preventDefault();
        this.closeDialog(document.getElementById('dlgSettings'));
      });
    }
  }

  openDialog(dialog) {
    if (!dialog) return;
    this.closeMenus();
    this.selection.save();
    if (!dialog.open) dialog.showModal();
  }

  closeDialog(dialog) {
    if (dialog && dialog.open) dialog.close();
  }

  openSettings() {
    this.syncSettingsUI();
    this.openDialog(document.getElementById('dlgSettings'));
  }

  openTableDialog() {
    this.selection.save();
    this.openDialog(document.getElementById('dlgTable'));
  }

  openLinkDialog() {
    const info = this.editor.getLinkInfo();
    const selected = this.editor.getSelectedText() || '';
    const linkText = document.getElementById('linkText');
    const linkUrl = document.getElementById('linkUrl');
    if (linkText) linkText.value = info ? info.text : selected;
    if (linkUrl) linkUrl.value = info ? info.href : '';
    this.selection.save();
    this.openDialog(document.getElementById('dlgLink'));
    window.requestAnimationFrame(() => {
      if (linkUrl && !linkUrl.value) linkUrl.focus();
      else if (linkText) linkText.focus();
    });
  }

  selectFormula(formulaNode) {
    if (!formulaNode || !formulaNode.isConnected) return;
    this.deselectFormula({ silent: true });
    this.selectedFormula = formulaNode;
    formulaNode.classList.add('is-selected');
    this.updateFormulaBubble();
  }

  deselectFormula(options = {}) {
    if (this.selectedFormula) {
      this.selectedFormula.classList.remove('is-selected');
      this.selectedFormula = null;
    }
    const bubble = document.getElementById('formulaBubble');
    if (bubble) bubble.hidden = true;
  }

  updateFormulaBubble() {
    const bubble = document.getElementById('formulaBubble');
    if (!bubble || !this.selectedFormula || !this.selectedFormula.isConnected) {
      if (bubble) bubble.hidden = true;
      return;
    }
    const rect = this.selectedFormula.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      bubble.hidden = true;
      return;
    }

    bubble.hidden = false;
    const bubbleRect = bubble.getBoundingClientRect();
    let left = rect.left + (rect.width - bubbleRect.width) / 2;
    left = Math.max(10, Math.min(window.innerWidth - bubbleRect.width - 10, left));

    let top = rect.top - bubbleRect.height - 6;
    if (top < 10) {
      top = rect.bottom + 6;
    }

    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(top)}px`;
  }

  deleteSelectedFormula() {
    if (!this.selectedFormula) return;
    const node = this.selectedFormula;
    this.deselectFormula();
    node.remove();
    this.afterMutation({ relayout: true, historyNow: true });
    this.toast('Fórmula eliminada.', 'info');
  }

  openFormulaDialog(targetMath = null) {
    const math = targetMath || this.selectedFormula || (() => {
      const range = this.selection.currentRange();
      if (!range) return null;
      const element = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
      return element ? element.closest('.math-inline, .math-block') : null;
    })();

    this.editingFormula = math && math.isConnected ? math : null;
    let tex = '';
    let isBlock = false;

    if (this.editingFormula) {
      tex = this.editingFormula.getAttribute('data-tex') || '';
      isBlock = this.editingFormula.classList.contains('math-block');
      this.selectFormula(this.editingFormula);
    }

    if (this.formulaTex) this.formulaTex.value = tex;
    const radioInline = document.querySelector('input[name="formulaDisplay"][value="inline"]');
    const radioBlock = document.querySelector('input[name="formulaDisplay"][value="block"]');
    if (isBlock && radioBlock) radioBlock.checked = true;
    else if (radioInline) radioInline.checked = true;

    const titleText = document.getElementById('formulaDialogTitleText');
    const submitBtn = document.getElementById('formulaSubmit');
    if (titleText) titleText.textContent = this.editingFormula ? 'Editar fórmula LaTeX' : 'Fórmula LaTeX';
    if (submitBtn) submitBtn.textContent = this.editingFormula ? 'Guardar cambios' : 'Insertar fórmula';

    this.selection.save();
    this.renderFormulaPreview();
    this.openDialog(document.getElementById('dlgFormula'));
    window.requestAnimationFrame(() => this.formulaTex?.focus());
  }

  buildFormulaSymbols() {
    const container = document.getElementById('formulaSymbols');
    if (!container) return;
    container.replaceChildren();
    FORMULA_SYMBOLS.forEach((symbol) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = symbol.label;
      button.title = symbol.tex;
      button.addEventListener('click', () => {
        if (!this.formulaTex) return;
        const start = this.formulaTex.selectionStart || 0;
        const end = this.formulaTex.selectionEnd || 0;
        const value = this.formulaTex.value;
        const insert = symbol.tex.includes('\\begin') ? '\n' + symbol.tex + '\n' : symbol.tex;
        this.formulaTex.value = value.slice(0, start) + insert + value.slice(end);
        const caret = start + insert.length;
        this.formulaTex.focus();
        this.formulaTex.setSelectionRange(caret, caret);
        this.renderFormulaPreview();
      });
      container.appendChild(button);
    });

    if (this.formulaTex) {
      this.formulaTex.addEventListener('input', () => this.renderFormulaPreview());
    }
  }

  renderFormulaPreview() {
    if (!this.formulaPreview) return;
    const tex = (this.formulaTex?.value || '').trim();
    const isBlock = document.querySelector('input[name="formulaDisplay"]:checked')?.value === 'block';
    if (this.formulaError) {
      this.formulaError.hidden = true;
      this.formulaError.textContent = '';
    }
    if (!tex) {
      this.formulaPreview.innerHTML = '<span class="muted">Escribe una expresión LaTeX…</span>';
      return;
    }
    const html = Parser.katexHtml(tex, isBlock);
    if (html === null) {
      this.formulaPreview.replaceChildren();
      if (this.formulaError) {
        this.formulaError.hidden = false;
        this.formulaError.textContent = 'La expresión no es válida. Revisa llaves, comandos y entornos.';
      }
      return;
    }
    this.formulaPreview.innerHTML = html;
  }

  insertHeaderMarker() {
    const current = this.settings.header || '';
    const text = window.prompt('Texto de la cabecera para esta página y las siguientes:', current);
    if (text === null) return;
    const value = text.trim();
    if (!value) {
      this.toast('Escribe un texto para la cabecera.', 'info');
      return;
    }
    this.withSelection(() => this.editor.insertHeaderMarker(value), { allowEmpty: true });
  }

  /* ------------------------------------------------------------------ */
  /* Ajustes de página, tipografía y encabezados                        */
  /* ------------------------------------------------------------------ */

  bindSettings() {
    document.querySelectorAll('[data-setting="paper"]').forEach((select) => {
      select.addEventListener('change', () => this.updateSettings({ paper: select.value }));
    });
    document.querySelectorAll('[data-setting="orientation"]').forEach((select) => {
      select.addEventListener('change', () => this.updateSettings({ orientation: select.value }));
    });
    document.querySelectorAll('[data-orientation]').forEach((button) => {
      button.addEventListener('click', () => {
        this.updateSettings({ orientation: button.getAttribute('data-orientation') });
      });
    });

    ['marginPreset', 'marginPresetToolbar'].forEach((id) => {
      const select = document.getElementById(id);
      if (!select) return;
      select.addEventListener('change', () => {
        if (select.value === 'custom') {
          this.toast('Ajusta los márgenes en el panel de propiedades.', 'info');
          return;
        }
        const preset = MARGIN_PRESETS[select.value];
        if (preset) this.updateSettings({ margins: { ...preset.margins } });
      });
    });

    document.querySelectorAll('[data-margin]').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.getAttribute('data-margin');
        const value = clamp(Number(input.value) || 0, 0, 60);
        input.value = String(value);
        this.updateSettings({ margins: { [key]: value } });
      });
    });

    const baseFamily = document.getElementById('baseFontFamily');
    if (baseFamily) {
      baseFamily.addEventListener('change', () => this.updateSettings({ fontFamily: baseFamily.value }));
    }

    const baseSize = document.getElementById('baseFontSize');
    if (baseSize) {
      baseSize.addEventListener('change', () => {
        const value = clamp(Number(baseSize.value) || 11.5, 7, 24);
        baseSize.value = String(value);
        this.updateSettings({ fontSize: value });
      });
    }

    const headerInput = document.getElementById('cfgHeader');
    const footerInput = document.getElementById('cfgFooter');
    const headerDialog = document.getElementById('cfgHeaderDialog');
    const footerDialog = document.getElementById('cfgFooterDialog');
    const applyHeader = debounce((value) => this.updateSettings({ header: value }), 260);
    const applyFooter = debounce((value) => this.updateSettings({ footer: value }), 260);

    [headerInput, headerDialog].forEach((input) => {
      if (!input) return;
      input.addEventListener('input', () => {
        if (headerInput && input !== headerInput) headerInput.value = input.value;
        if (headerDialog && input !== headerDialog) headerDialog.value = input.value;
        applyHeader(input.value);
      });
    });
    [footerInput, footerDialog].forEach((input) => {
      if (!input) return;
      input.addEventListener('input', () => {
        if (footerInput && input !== footerInput) footerInput.value = input.value;
        if (footerDialog && input !== footerDialog) footerDialog.value = input.value;
        applyFooter(input.value);
      });
    });

    const themeSelect = document.getElementById('cfgTheme');
    if (themeSelect) {
      themeSelect.addEventListener('change', () => {
        applyTheme(themeSelect.value);
        this.saveConfig();
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Imágenes                                                           */
  /* ------------------------------------------------------------------ */

  bindImageControls() {
    document.querySelectorAll('[data-image-prop="wrap"]').forEach((select) => {
      select.addEventListener('change', () => this.images.setWrap(select.value));
    });
    document.querySelectorAll('[data-image-prop="align"]').forEach((select) => {
      select.addEventListener('change', () => this.images.setAlign(select.value));
    });
    document.querySelectorAll('[data-image-prop="width"]').forEach((input) => {
      input.addEventListener('change', () => {
        const value = Math.max(16, Number(input.value) || 16);
        input.value = String(Math.round(value));
        this.images.setSize('width', value);
      });
    });
    document.querySelectorAll('[data-image-prop="height"]').forEach((input) => {
      input.addEventListener('change', () => {
        const value = Math.max(16, Number(input.value) || 16);
        input.value = String(Math.round(value));
        this.images.setSize('height', value);
      });
    });
    document.querySelectorAll('[data-image-prop="alt"]').forEach((input) => {
      input.addEventListener('change', () => this.images.setAlt(input.value));
    });
  }

  onImageSelectionChange(info) {
    const visible = !!info;
    if (this.imageGroup) this.imageGroup.hidden = !visible;
    if (this.inspectorImage) this.inspectorImage.hidden = !visible;
    if (!info) return;

    document.querySelectorAll('[data-image-prop="wrap"]').forEach((select) => {
      let value = info.wrap;
      if (info.kind === 'figure' && value !== 'square') value = 'inline';
      select.value = value;
    });
    document.querySelectorAll('[data-image-prop="align"]').forEach((select) => {
      select.value = info.align || 'left';
    });
    document.querySelectorAll('[data-image-prop="width"]').forEach((input) => { input.value = String(info.width); });
    document.querySelectorAll('[data-image-prop="height"]').forEach((input) => { input.value = String(info.height); });
    document.querySelectorAll('[data-image-prop="alt"]').forEach((input) => { input.value = info.alt || ''; });
  }

  /* ------------------------------------------------------------------ */
  /* Archivos, ejemplo e importación                                    */
  /* ------------------------------------------------------------------ */

  bindFiles() {
    if (this.mdInput) {
      this.mdInput.addEventListener('change', async () => {
        const file = this.mdInput.files && this.mdInput.files[0];
        this.mdInput.value = '';
        if (!file) return;
        try {
          const text = await file.text();
          this.loadMarkdownDocument(text, file.name.replace(/\.[^.]+$/, ''));
          this.toast('Markdown importado como documento editable.', 'ok');
        } catch (error) {
          console.error('[Lantex] No se pudo leer el Markdown:', error);
          this.toast('No se pudo leer el archivo Markdown.', 'err');
        }
      });
    }
  }

  async loadExample(name) {
    try {
      const response = await fetch('examples/' + encodeURIComponent(name), { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const text = await response.text();
      const title = name.replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
      this.loadMarkdownDocument(text, title.charAt(0).toUpperCase() + title.slice(1));
      this.toast('Ejemplo cargado: ' + title + '.', 'ok');
    } catch (error) {
      console.warn('[Lantex] No se pudo cargar el ejemplo:', error);
      this.toast('No se pudo cargar el ejemplo. Comprueba que existe examples/' + name + '.', 'err');
    }
  }

  loadMarkdownDocument(markdown, title) {
    if (!String(markdown || '').trim()) {
      this.toast('El documento está vacío.', 'info');
      return;
    }
    this.editor.ensureSelection();
    const html = Parser.markdownToFlowHtml(markdown);
    this.docTitle.value = title || 'Documento sin título';
    this.updateDocumentTitle();
    this.images.deselect({ silent: true });
    this.setPageHtml(html);
    this.relayout();
    this.history.reset();
    this.applyZoom(this.zoomMode === 'fit' ? 'fit' : this.zoomScale);
    this.updateStats();
    this.scheduleSave();
    this.ensureCaretAtStart();
  }

  ensureCaretAtStart() {
    const content = this.pagesEl.querySelector('.a4-page .a4-content');
    if (!content) return;
    const range = document.createRange();
    range.selectNodeContents(content);
    range.collapse(true);
    const selection = window.getSelection();
    if (!selection) return;
    try { content.focus({ preventScroll: true }); } catch (e) { content.focus(); }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  newDocument() {
    const hasContent = this.getMarkdown().trim().length > 0;
    if (hasContent && !window.confirm('¿Crear un documento nuevo? El documento actual se guardará y se reemplazará.')) return;
    this.images.deselect({ silent: true });
    const record = this.emptyRecord();
    this.settings = applyDocumentSettings(record.settings);
    this.paginator.setSettings(this.settings);
    this.docTitle.value = record.title;
    this.updateDocumentTitle();
    this.setPageHtml(record.html);
    this.relayout();
    this.history.reset();
    this.applyZoom('fit');
    this.zoomMode = 'fit';
    this.syncSettingsUI();
    this.updateStats();
    this.scheduleSave();
    this.ensureCaretAtStart();
    this.toast('Documento nuevo.', 'ok');
  }

  async clearStorage() {
    if (!window.confirm('¿Borrar el documento guardado en este navegador? Esta acción no se puede deshacer.')) return;
    try {
      await DocStorage.clear();
      Store.remove('editor-document-v2');
      Store.remove('editor-content');
      this.toast('Datos guardados borrados.', 'ok');
    } catch (error) {
      console.warn('[Lantex] No se pudieron borrar los datos:', error);
      this.toast('No se pudieron borrar todos los datos guardados.', 'err');
    }
    this.images.deselect({ silent: true });
    const record = this.emptyRecord();
    this.settings = applyDocumentSettings(record.settings);
    this.paginator.setSettings(this.settings);
    this.docTitle.value = record.title;
    this.updateDocumentTitle();
    this.setPageHtml(record.html);
    this.relayout();
    this.history.reset();
    this.applyZoom('fit');
    this.zoomMode = 'fit';
    this.syncSettingsUI();
    this.updateStats();
    this.ensureCaretAtStart();
    this.markSaved('saved');
    this.scheduleSave();
    this.saveConfig();
  }

  /* ------------------------------------------------------------------ */
  /* Copiar, descargar e imprimir                                       */
  /* ------------------------------------------------------------------ */

  copyMarkdown() {
    const markdown = this.getMarkdown();
    copyText(markdown, 'Documento copiado como Markdown.', 'No se pudo copiar el Markdown.');
  }

  copyLatex() {
    const markdown = this.getMarkdown();
    copyText(Parser.toLatex(markdown), 'Documento copiado como LaTeX.', 'No se pudo copiar el LaTeX.');
  }

  downloadMarkdown() {
    const markdown = this.getMarkdown();
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, slug(this.docTitle.value || 'documento') + '.md');
    this.toast('Markdown descargado.', 'ok');
  }

  async printDocument() {
    this.history.flush();
    await this.saveNow();
    this.closeMenus();
    window.print();
  }

  async exportPdf() {
    try {
      await this.exporter.exportPdf();
    } catch (error) {
      console.error('[Lantex] Error al exportar PDF:', error);
      this.toast('No se pudo generar el PDF. Se abrirá el diálogo de impresión.', 'err');
      this.printDocument();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Atajos y eventos globales                                          */
  /* ------------------------------------------------------------------ */

  bindKeyboard() {
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const isField = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        this.history.commit();
        this.saveNow();
        return;
      }
      if (mod && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        this.printDocument();
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        this.copyMarkdown();
        return;
      }
      if (event.key === 'Escape') {
        this.closeMenus();
      }
      if (isField) return;
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        this.openLinkDialog();
        return;
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        this.editor.selectAll();
        return;
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        this.withSelection(() => this.editor.format('bold'));
      } else if (mod && !event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        this.withSelection(() => this.editor.format('italic'));
      } else if (mod && !event.shiftKey && event.key.toLowerCase() === 'u') {
        event.preventDefault();
        this.withSelection(() => this.editor.format('underline'));
      }
    });
  }

  bindWindowEvents() {
    this.docTitle.addEventListener('input', () => this.onTitleInput());
    this.docTitle.addEventListener('blur', () => {
      const value = this.docTitle.value.trim() || 'Documento sin título';
      this.docTitle.value = value;
      this.updateDocumentTitle();
      this.history.commit();
      this.scheduleSave();
    });

    window.addEventListener('lantex:toast', (event) => {
      const detail = event.detail || {};
      this.toast(detail.message, detail.type || 'info');
    });

    window.addEventListener('resize', () => {
      this.closeMenus();
      if (this.zoomMode === 'fit') this.scheduleZoom();
      this.images?.updateOverlay();
      this.updateFormulaBubble();
    });

    this.pagesWrap.addEventListener('scroll', debounce(() => {
      this.refreshStatsSoon();
      this.images?.scheduleOverlayUpdate();
      this.updateFormulaBubble();
    }, 70), { passive: true });

    observeResize(this.pagesWrap, () => {
      if (this.zoomMode === 'fit') this.scheduleZoom();
      else this.applyZoom(this.zoomScale);
      this.images?.scheduleOverlayUpdate();
      this.updateFormulaBubble();
    });

    const persist = () => {
      if (!this.ready) return;
      try { this.history.flush(); } catch (error) { /* noop */ }
      try { DocStorage.saveSync(this.serializeDoc()); } catch (error) { /* noop */ }
    };
    window.addEventListener('beforeunload', persist);
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persist();
    });
  }

  bindDropSelectors() {
    // Los eventos de arrastre de imágenes ya están gestionados en ImageManager.
    // Aquí sólo se evita que el navegador abra el archivo fuera de la zona válida.
    ['dragover', 'drop'].forEach((type) => {
      window.addEventListener(type, (event) => {
        if (event.target.closest && event.target.closest('.a4-page, #dropOverlay, .canvas')) return;
        event.preventDefault();
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Notificaciones                                                     */
  /* ------------------------------------------------------------------ */

  toast(message, type = 'info') {
    if (!message) return;
    const container = document.getElementById('toasts');
    if (!container) return;
    while (container.children.length >= 4) container.firstElementChild?.remove();
    const item = document.createElement('div');
    item.className = 'toast ' + type;
    item.textContent = message;
    container.appendChild(item);
    window.setTimeout(() => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(6px)';
      window.setTimeout(() => item.remove(), 220);
    }, 3400);
  }

  createIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try { window.lucide.createIcons(); } catch (error) { console.warn('[Lantex] Lucide:', error); }
    }
  }
}

const app = new LantexApp();
window.lantex = app;
app.init().catch((error) => {
  console.error('[Lantex] Error de arranque:', error);
  const container = document.getElementById('toasts');
  if (container) {
    const item = document.createElement('div');
    item.className = 'toast err';
    item.textContent = 'No se pudo iniciar el editor: ' + (error && error.message ? error.message : 'error desconocido');
    container.appendChild(item);
  }
});

export { LantexApp };
