# Editor-Lantex

**Editor Markdown + LaTeX con vista previa paginada A4, KaTeX (SVG) y exportación a PDF. 100% cliente.**

## ¿Qué es?

Editor-Lantex es una aplicación web completa para escribir y visualizar documentos que contienen Markdown y fórmulas LaTeX. Se caracteriza por:

- **Vista previa paginada A4**: Muestra el documento en hojas de tamaño A210 × 297 mm con márgenes de 2.5 cm
- **Renderizado KaTeX**: Fórmulas matemáticas con salida SVG/MathML para máxima fidelidad
- **Exportación a PDF**: Descarga directa del documento formateado
- **100% cliente**: Todo procesamiento ocurre en el navegador, sin backend

## Características principales

| Característica | Descripción |
|---|---|
| **Vista dual** | Editor Markdown/LaTeX a la izquierda, vista previa A4 a la derecha |
| **KaTeX** | Motor de fórmulas matemáticas con soporte de macros calculus (R, N, Z, Q, C, Ind, abs, norm, set, paren, avg, euler, ddx, dydx) |
| **Markdown** | Sintaxis completa mediante marked.js |
| **PDF export** | Descarga con `html2pdf.js` o impresión clásica (Ctrl+P) |
| **Configuración** | Guardado en LocalStorage: tema, tamaño de fuente, números de línea, encabezados y pies de página |
| **Símbolos** | Acceso rápido a macros de cálculo frecuentes |
| **Modo impresión** | `@media print` con saltos de página `page-break-before` |
| **Móvil** | Bottom sheet con herramientas y símbolos (< 640px) |

## Cómo usar

### Interfaz principal

1. **Editor (izquierda)**: Escribe tu documento usando Markdown y LaTeX
2. **Vista previa (derecha)**: Se actualiza automáticamente mostrando el documento paginado en formato A4

### Sintaxis compatible

#### Fórmulas LaTeX en bloque

```latex
$$ \int_a^b f(x) \, dx $$
```

#### Fórmulas LaTeX en línea

`$E = mc^2$`

#### Macros calculus predefinidas

Los siguientes atajos están disponibles automáticamente:

- `\R` → `ℝ`, `\N` → `ℕ`, `\Z` → `ℤ`, `\Q` → `ℚ`, `\C` → `ℂ`
- `\Ind` → `ℐ`, `\abs{expr}` → `|expr|`, `\norm{expr}` → `||expr||`
- `\set{expr}` → `{expr}`, `\paren{expr}` → `(expr)`
- `\avg{expr}` → `ēxpr`, `\euler` → `e`, `\ddx` → `dx`, `\dydx` → `dy/dx`

### Herramientas de la toolbar

| Botón | Atajo | Acción |
|---|---|---|
| **Copiar Markdown** | `Ctrl+Shift+C` | Copia el contenido formateado a Markdown |
| **Copiar LaTeX** | N/A | Copia el texto LaTeX puro (fórmulas y todo) |
| **Descargar .md** | N/A | Guarda el archivo Markdown localmente |
| **Cargar ejemplo** | N/A | Carga un documento de muestra con ejemplos |
| **Exportar PDF** | N/A | Genera y descarga el PDF del documento |
| **Configuración** | N/A | Abre panel para ajustar tema, fuente, números de línea y encabezados/pies |
| **Tema claro/oscuro** | N/A | Alterna entre modo claro y oscuro |

### Configuración

Accede al panel de configuración (botón de engranaje) para personalizar:

- **Tema**: Claro u oscuro (se persiste en LocalStorage)
- **Tamaño de fuente**: 13px, 14px, 16px o 18px
- **Mostrar números de línea**: Activa/desactiva números en el editor
- **Encabezado PDF**: Texto que aparecerá en la cabecera de todas las páginas
- **Pie de página PDF**: Texto que aparecerá en el pie de todas las páginas

### Modo impresión

Para imprimir o exportar a PDF de alta calidad:

1. Presiona `Ctrl+P` (o usa el botón "Exportar PDF")
2. En el diálogo de impresión, asegúrate de que el fondo esté habilitado
3. El CSS `@media print` garantiza saltos de página apropiados con `<!-- pagebreak -->`, `\newpage` o `\pagebreak`

### Atajos de teclado

- `Ctrl+Shift+C`: Copiar Markdown
- `Ctrl+Shift+L`: Alternar números de línea (si está configurado)
- `Ctrl+P`: Imprimir/exportar PDF

## Tecnologías utilizadas

- **HTML5** + **Tailwind CSS** (CDN)
- **KaTEX** para renderizado de fórmulas matemáticas
- **marked** para parseo de Markdown
- **html2pdf.js** para exportación a PDF
- **Lucide** para iconos
- **LocalStorage** para persistencia de configuración

## Requisitos

- Navegador moderno con soporte para ES6+
- No requiere ningún backend o servidor especial
- Funciona offline después de la carga inicial