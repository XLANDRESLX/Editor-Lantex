import { Store, clamp, mm2px } from './util.js';

export const PAPER_SIZES = {
  a4: { label: 'A4', width: 210, height: 297 },
  letter: { label: 'Carta', width: 215.9, height: 279.4 },
  legal: { label: 'Oficio', width: 215.9, height: 355.6 },
  a5: { label: 'A5', width: 148, height: 210 }
};

export const MARGIN_PRESETS = {
  normal: { label: 'Normales (2,5 cm)', margins: { top: 25, right: 25, bottom: 25, left: 25 } },
  narrow: { label: 'Estrechos (1,27 cm)', margins: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 } },
  moderate: { label: 'Moderados', margins: { top: 25.4, right: 19.05, bottom: 25.4, left: 19.05 } },
  wide: { label: 'Amplios', margins: { top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 } },
  custom: { label: 'Personalizados', margins: { top: 25, right: 25, bottom: 25, left: 25 } }
};

export const DEFAULT_DOC_SETTINGS = {
  paper: 'a4',
  orientation: 'portrait',
  margins: { top: 25, right: 25, bottom: 25, left: 25 },
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontSize: 11.5,
  header: '',
  footer: ''
};

export const DEFAULT_CONFIG = {
  theme: 'light',
  pdf: { header: '', footer: '' },
  panelOpen: false,
  zoom: 'fit'
};

function normalizeMargins(raw, fallback) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = fallback || DEFAULT_DOC_SETTINGS.margins;
  const pick = (key) => {
    const n = Number(source[key]);
    return Number.isFinite(n) ? clamp(n, 0, 60) : base[key];
  };
  return {
    top: pick('top'),
    right: pick('right'),
    bottom: pick('bottom'),
    left: pick('left')
  };
}

export function sanitizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const paper = PAPER_SIZES[source.paper] ? source.paper : DEFAULT_DOC_SETTINGS.paper;
  const orientation = source.orientation === 'landscape' ? 'landscape' : 'portrait';
  const fontFamily = typeof source.fontFamily === 'string' && source.fontFamily.trim()
    ? source.fontFamily.trim()
    : DEFAULT_DOC_SETTINGS.fontFamily;
  const fontSize = clamp(Number(source.fontSize) || DEFAULT_DOC_SETTINGS.fontSize, 7, 24);
  const margins = normalizeMargins(source.margins, DEFAULT_DOC_SETTINGS.margins);
  const paperData = PAPER_SIZES[paper];
  const swapped = orientation === 'landscape';
  const pw = swapped ? paperData.height : paperData.width;
  const ph = swapped ? paperData.width : paperData.height;
  // Evita áreas editables imposibles manteniendo al menos 35 mm de contenido.
  margins.left = Math.min(margins.left, Math.max(0, pw - 35 - margins.right));
  margins.right = Math.min(margins.right, Math.max(0, pw - 35 - margins.left));
  margins.top = Math.min(margins.top, Math.max(0, ph - 35 - margins.bottom));
  margins.bottom = Math.min(margins.bottom, Math.max(0, ph - 35 - margins.top));
  return {
    paper,
    orientation,
    margins,
    fontFamily,
    fontSize,
    header: typeof source.header === 'string' ? source.header.slice(0, 180) : '',
    footer: typeof source.footer === 'string' ? source.footer.slice(0, 180) : ''
  };
}

export function getPageMetrics(settings) {
  const s = sanitizeSettings(settings);
  const paper = PAPER_SIZES[s.paper];
  const swapped = s.orientation === 'landscape';
  const width = swapped ? paper.height : paper.width;
  const height = swapped ? paper.width : paper.height;
  const contentWidth = width - s.margins.left - s.margins.right;
  const contentHeight = height - s.margins.top - s.margins.bottom;
  return {
    paper: s.paper,
    orientation: s.orientation,
    width,
    height,
    margins: { ...s.margins },
    contentWidth,
    contentHeight,
    widthPx: mm2px(width),
    heightPx: mm2px(height),
    contentWidthPx: mm2px(contentWidth),
    contentHeightPx: mm2px(contentHeight)
  };
}

export function applyDocumentSettings(settings) {
  const s = sanitizeSettings(settings);
  const page = getPageMetrics(s);
  const root = document.documentElement;
  root.style.setProperty('--page-w', page.width + 'mm');
  root.style.setProperty('--page-h', page.height + 'mm');
  root.style.setProperty('--margin-top', page.margins.top + 'mm');
  root.style.setProperty('--margin-right', page.margins.right + 'mm');
  root.style.setProperty('--margin-bottom', page.margins.bottom + 'mm');
  root.style.setProperty('--margin-left', page.margins.left + 'mm');
  root.style.setProperty('--doc-font', s.fontFamily);
  root.style.setProperty('--doc-size', s.fontSize + 'pt');
  root.style.setProperty('--doc-line', '1.6');
  updatePrintPageStyle(page);
  return s;
}

export function updatePrintPageStyle(page) {
  let style = document.getElementById('printPageStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'printPageStyle';
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${page.width}mm ${page.height}mm; margin: 0; }`;
}

export function detectMarginPreset(margins) {
  const eps = 0.15;
  for (const [key, preset] of Object.entries(MARGIN_PRESETS)) {
    if (key === 'custom') continue;
    const a = preset.margins;
    if (Math.abs(a.top - margins.top) < eps
      && Math.abs(a.right - margins.right) < eps
      && Math.abs(a.bottom - margins.bottom) < eps
      && Math.abs(a.left - margins.left) < eps) return key;
  }
  return 'custom';
}

export function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', dark ? 'dark light' : 'light dark');
}

export const Config = {
  data: { ...DEFAULT_CONFIG, pdf: { ...DEFAULT_CONFIG.pdf } },
  load() {
    try {
      const raw = Store.get('editor-config', null);
      if (!raw) return this.data;
      const saved = JSON.parse(raw) || {};
      const pdf = saved.pdf && typeof saved.pdf === 'object' ? saved.pdf : {};
      this.data = {
        theme: saved.theme === 'dark' ? 'dark' : 'light',
        pdf: {
          header: typeof pdf.header === 'string' ? pdf.header : (typeof saved.pdfHeader === 'string' ? saved.pdfHeader : ''),
          footer: typeof pdf.footer === 'string' ? pdf.footer : (typeof saved.pdfFooter === 'string' ? saved.pdfFooter : '')
        },
        panelOpen: !!saved.panelOpen,
        zoom: saved.zoom === 'fit' || Number.isFinite(Number(saved.zoom)) ? saved.zoom : 'fit'
      };
    } catch (e) {
      this.data = { ...DEFAULT_CONFIG, pdf: { ...DEFAULT_CONFIG.pdf } };
    }
    return this.data;
  },
  save() {
    return Store.set('editor-config', JSON.stringify(this.data));
  }
};
