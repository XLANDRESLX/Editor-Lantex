# Editor Lantex

**Editor WYSIWYG paginado en A4, con soporte de Markdown, fórmulas KaTeX y exportación a PDF. 100 % en el navegador.**

Editor Lantex ya no es un editor de doble panel. Ahora se escribe directamente sobre hojas A4 reales: el texto, las imágenes, las tablas y los saltos de página se editan en el lugar donde se van a imprimir. El resultado se guarda solo en el navegador y se puede exportar a PDF o imprimir sin depender de ningún servidor.

## Características

| Área | Detalle |
|---|---|
| **Edición directa en A4** | Todo el documento se edita sobre páginas A4 paginadas automáticamente. No hay panel de vista previa separado. |
| **Formato tipo Word** | Negrita, cursiva, subrayado, tachado, color de texto, resaltado, familia y tamaño de fuente, estilos de bloque, alineación, interlineado, espaciado entre párrafos, listas, sangría y borrado de formato. |
| **Historial propio** | Deshacer y rehacer con instantáneas que conservan la posición del cursor incluso después de repaginar. |
| **Paginación automática** | El contenido fluye entre páginas A4 sin perder texto ni superponer bloques. Los párrafos, listas, tablas y bloques de código largos se dividen y se vuelven a unir al editar. |
| **Imágenes** | Inserción por archivo, pegado o arrastre. Ocho tiradores de redimensionado, movimiento libre, proporción, alineación, modos de ajuste, duplicado y eliminación. |
| **Pegado de Markdown/IA** | Al pegar texto Markdown se convierten encabezados, listas, tablas, enlaces, citas, imágenes y fórmulas en contenido editable. |
| **Fórmulas** | KaTeX en línea y en bloque, con diálogo, previsualización y símbolos frecuentes. |
| **Página** | Tamaño de papel (A4, Carta, Legal, A5…), orientación, márgenes y cabecera/pie con numeración. |
| **Exportación** | PDF con `html2pdf.js`, impresión nativa (`Ctrl+P`), copia como Markdown o LaTeX y descarga `.md`. |
| **Persistencia** | Documento, formato, imágenes, tablas, saltos y ajustes se guardan automáticamente en IndexedDB, con respaldo en LocalStorage. |
| **Interfaz** | Tema claro/oscuro, zoom, panel lateral plegable, barra de estado, diálogos accesibles y diseño adaptable. |

## Cómo usar

1. Abre `index.html` desde un servidor HTTP (ver [Desarrollo](#desarrollo)).
2. Haz clic en cualquier página y escribe. La barra superior permite aplicar formato y el botón **PDF** exporta el documento.
3. Usa el menú **Documento** para crear uno nuevo, importar Markdown, cargar ejemplos o cambiar la página.
4. Los cambios se guardan solos; el indicador de la barra de estado muestra el estado del guardado.

### Barra de formato

La barra agrupa las herramientas por función, con descripciones emergentes:

- **Historial y estilo de bloque**: deshacer, rehacer, párrafo, títulos, cita y bloque de código.
- **Fuente**: familia, tamaño (con incremento/decremento), negrita, cursiva, subrayado, tachado y borrado de formato.
- **Color**: color de texto y resaltado, con paleta y color personalizado.
- **Párrafo**: alineación, interlineado, espaciado, listas con viñetas o numeradas, sangría y salida de sangría.
- **Insertar**: imagen, tabla, enlace, fórmula y salto de página.
- **Página**: papel, orientación y márgenes desde el menú o el panel lateral.

### Pegado de Markdown

Copia el resultado de un chat de IA y pégalo directamente sobre una página. Se interpretan:

- Encabezados `#`, `##`, `###`
- Negrita, cursiva, tachado, código y enlaces
- Listas con viñetas y numeradas
- Citas y bloques de código
- Tablas Markdown
- Imágenes Markdown
- Fórmulas `$…$` y `$$…$$`
- Saltos de página `\pagebreak`, `\newpage` o `<!-- pagebreak -->`

El contenido insertado sigue siendo editable como cualquier otro bloque.

### Imágenes

- **Insertar**: botón de imagen, pegar desde el portapapeles o arrastrar un archivo a la página.
- **Redimensionar**: selecciona la imagen y usa los ocho tiradores. Mantener la proporción es el comportamiento predeterminado.
- **Mover**: arrastra la imagen flotante libremente; su posición se conserva al repaginar.
- **Ajuste**: en línea, flotante delante o detrás del texto.
- **Alinear**: izquierda, centro o derecha.
- **Duplicar y eliminar**: desde la barra contextual de la imagen o con `Supr`.

### Página, cabecera y pie

En **Documento → Configuración** o en el panel lateral se puede ajustar:

- Tamaño de papel y orientación.
- Márgenes superior, inferior, izquierdo y derecho (con preajustes).
- Cabecera y pie de página; admiten texto y el marcador de numeración.
- Tema y zoom de la vista.

Los saltos de página manuales se insertan como marcadores visibles en pantalla y desaparecen al imprimir o exportar.

## Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl+S` | Guardar ahora |
| `Ctrl+P` | Imprimir o guardar como PDF |
| `Ctrl+Shift+C` | Copiar el documento como Markdown |
| `Ctrl+K` | Insertar o editar un enlace |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | Negrita / cursiva / subrayado |
| `Ctrl+Z` / `Ctrl+Y` | Deshacer / rehacer |
| `Tab` / `Shift+Tab` | Navegar entre celdas de una tabla |
| `Esc` | Cerrar menús o deseleccionar una imagen |
| `Supr` / `Retroceso` | Eliminar la imagen seleccionada |

## Persistencia

- El documento se guarda en **IndexedDB** (`lantex-editor` → `documents` → `current`).
- Si IndexedDB no está disponible se usa **LocalStorage** con la clave `editor-document-v2`.
- Los ajustes de interfaz y página se guardan en `editor-config`.
- Los datos de la versión anterior (`editor-content`) se migran automáticamente la primera vez.
- El registro guardado incluye `{ version, title, html, settings, floats, savedAt }`; las imágenes flotantes conservan su geometría.

Para empezar de cero usa **Documento → Borrar datos guardados**.

## Exportación e impresión

- **PDF**: genera un PDF con una página por hoja A4, sin marcadores de edición ni controles.
- **Imprimir**: usa el diálogo nativo del navegador. El CSS de impresión oculta la interfaz y respeta los saltos manuales.
- **Markdown**: conserva títulos, listas, tablas, enlaces, fórmulas y saltos como `\pagebreak`.
- **LaTeX**: copia el documento convertido a LaTeX.

## Arquitectura

La aplicación mantiene una estructura modular, sin compilación ni dependencias locales:

```
index.html            Estructura, barra, diálogos y carga de CDN
css/app.css           Interfaz, hojas A4, imágenes, impresión y temas
js/app.js             Arranque, estado, acciones, ajustes, zoom y persistencia
js/editor.js          Edición sobre las páginas, formato, pegado e inserción
js/pagination.js      Reparto del flujo en hojas A4 y división de bloques
js/images.js          Inserción, geometría, ajuste y serialización de imágenes
js/parser.js          Markdown ↔ HTML, KaTeX, sanitización y marcadores
js/selection.js       Marcadores de selección que sobreviven a la repaginación
js/history.js         Historial de instantáneas con deshacer/rehacer
js/storage.js         IndexedDB, LocalStorage y migración de datos
js/exporter.js        Generación de PDF y esperas seguras para exportar
js/config.js          Métricas de página, ajustes y variables CSS
js/util.js            Utilidades compartidas
examples/             Documentos de ejemplo en Markdown
```

### Decisiones de diseño

- La paginación mueve nodos reales del DOM; los bloques partidos se marcan con `data-split-head`/`data-split-tail` y se recomponen al editar.
- Las imágenes flotantes usan un ancla invisible en el flujo y se separan temporalmente durante la repaginación.
- El historial guarda HTML más marcadores de selección, no el historial nativo del navegador.
- `window.lantex` expone la instancia de la aplicación para depuración.

## Desarrollo

Los módulos usan ES Modules, por lo que la aplicación debe servirse por HTTP; abrir `index.html` con `file://` no funciona en la mayoría de navegadores.

Con Python:

```bash
python -m http.server 8080
```

Luego abre <http://localhost:8080/>.

> Consejo: durante el desarrollo usa un servidor con `Cache-Control: no-store` (como el usado en este proyecto) para evitar que el navegador reutilice módulos antiguos.

### GitHub Pages

El proyecto usa rutas relativas y no necesita compilación. Publica la raíz del repositorio con GitHub Pages y la aplicación funcionará directamente.

## Tecnologías

- HTML5, CSS3 y JavaScript moderno (ES Modules)
- [marked](https://marked.js.org/) para Markdown
- [KaTeX](https://katex.org/) para fórmulas matemáticas
- [html2pdf.js](https://github.com/eKoopmans/html2pdf.js) para exportación a PDF
- [Lucide](https://lucide.dev/) para iconos
- IndexedDB y LocalStorage para persistencia

Las bibliotecas se cargan desde CDN; la aplicación no necesita backend ni proceso de compilación.

## Requisitos y compatibilidad

- Navegador moderno con soporte de ES Modules, IndexedDB y `contenteditable`.
- Conexión a Internet la primera vez para cargar las bibliotecas desde CDN (después pueden quedar en caché).
- Recomendado: Chrome, Edge, Firefox o Safari actuales.

## Limitaciones conocidas

- La paginación se calcula con las métricas del navegador; cambios extremos de zoom del sistema pueden alterar los cortes respecto al PDF.
- Las fuentes personalizadas deben estar disponibles en el sistema o cargarse por CSS.
- El historial se reinicia al recargar la página; el documento guardado sí se conserva.
