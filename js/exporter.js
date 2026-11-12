import { slug } from './util.js';
import { getPageMetrics } from './config.js';

/**
 * Exportación a PDF y preparación de la impresión nativa.
 * El PDF se genera desde una copia de las hojas A4 reales, sin controles de
 * edición, de modo que la geometría de imágenes, tablas y saltos coincida con
 * lo que se ve en pantalla.
 */
export class Exporter {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('exportRoot');
    this.exporting = false;
  }

  filename() {
    const title = (this.app.docTitle && this.app.docTitle.value.trim()) || 'documento';
    return slug(title) + '.pdf';
  }

  waitForImages(container) {
    const images = Array.from(container.querySelectorAll('img'));
    return Promise.all(images.map((image) => new Promise((resolve) => {
      if (image.complete && image.naturalWidth) {
        resolve();
        return;
      }
      const done = () => resolve();
      image.addEventListener('load', done, { once: true });
      image.addEventListener('error', done, { once: true });
      window.setTimeout(done, 4500);
    })));
  }

  /**
   * Espera dos cuadros de animación, pero no depende de ellos: en una pestaña
   * en segundo plano requestAnimationFrame puede no ejecutarse nunca y la
   * exportación quedaría bloqueada. El temporizador garantiza el avance.
   */
  nextPaint() {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      window.requestAnimationFrame(() => window.requestAnimationFrame(done));
      window.setTimeout(done, 260);
    });
  }

  async fontsReady(timeout = 2500) {
    if (!document.fonts || !document.fonts.ready) return;
    await Promise.race([
      document.fonts.ready.catch(() => {}),
      new Promise((resolve) => window.setTimeout(resolve, timeout))
    ]);
  }

  buildExportTree() {
    const metrics = getPageMetrics(this.app.settings);
    const pages = Array.from(this.app.pagesEl.querySelectorAll('.a4-page'));
    if (!pages.length) return null;

    if (!this.root) return null;
    this.root.replaceChildren();
    this.root.classList.add('exporting');
    this.root.style.width = metrics.width + 'mm';
    this.root.style.visibility = 'visible';

    const documentEl = document.createElement('div');
    documentEl.className = 'export-document';
    documentEl.style.width = metrics.width + 'mm';
    documentEl.style.background = '#ffffff';

    pages.forEach((page, index) => {
      const clone = page.cloneNode(true);
      clone.style.width = metrics.width + 'mm';
      clone.style.height = metrics.height + 'mm';
      clone.style.boxShadow = 'none';
      clone.style.margin = '0';
      clone.style.border = '0';
      clone.style.borderRadius = '0';
      clone.style.overflow = 'hidden';
      clone.setAttribute('data-page-label', '');
      clone.style.breakAfter = index < pages.length - 1 ? 'page' : 'auto';
      clone.style.pageBreakAfter = index < pages.length - 1 ? 'always' : 'auto';
      clone.querySelectorAll('.is-selected').forEach((el) => el.classList.remove('is-selected'));
      clone.querySelectorAll('[contenteditable]').forEach((el) => el.setAttribute('contenteditable', 'false'));
      clone.querySelectorAll('.pagebreak-block, .hdr-marker, .image-anchor').forEach((el) => el.remove());
      documentEl.appendChild(clone);
    });

    this.root.appendChild(documentEl);
    return { documentEl, metrics, pageCount: pages.length };
  }

  async exportPdf() {
    if (this.exporting) return;
    if (!window.html2pdf) {
      this.app.toast('El generador de PDF no está disponible. Usa Imprimir → Guardar como PDF.', 'err');
      this.app.printDocument();
      return;
    }

    this.exporting = true;
    document.body.classList.add('is-exporting');
    try {
      this.app.history.flush();
      this.app.relayout();
      await this.fontsReady();
      const tree = this.buildExportTree();
      if (!tree) {
        this.app.toast('No hay páginas para exportar.', 'info');
        return;
      }
      await this.waitForImages(tree.documentEl);
      this.app.images?.deselect({ silent: true });
      await this.nextPaint();

      this.app.toast('Generando PDF…', 'info');
      const options = {
        margin: 0,
        filename: this.filename(),
        image: { type: 'jpeg', quality: 0.97 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          backgroundColor: '#ffffff',
          logging: false,
          scrollX: 0,
          scrollY: 0,
          windowWidth: Math.ceil(this.root.scrollWidth),
          windowHeight: Math.ceil(this.root.scrollHeight)
        },
        jsPDF: {
          unit: 'mm',
          format: [tree.metrics.width, tree.metrics.height],
          orientation: 'portrait',
          compress: true
        },
        pagebreak: {
          mode: ['css', 'legacy'],
          avoid: ['tr', 'img', '.doc-figure', '.doc-float-image', '.math-block']
        }
      };

      await window.html2pdf().set(options).from(tree.documentEl).save();
      this.app.toast('PDF generado con ' + tree.pageCount + (tree.pageCount === 1 ? ' página.' : ' páginas.'), 'ok');
    } finally {
      this.exporting = false;
      document.body.classList.remove('is-exporting');
      if (this.root) {
        this.root.replaceChildren();
        this.root.classList.remove('exporting');
      }
      this.app.images?.refresh();
    }
  }
}
