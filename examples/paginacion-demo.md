# Demostración de paginación

Este documento contiene suficiente contenido para comprobar que la paginación automática reparte los bloques entre varias hojas A4 sin perder texto ni superponer elementos.

## Sección 1

La paginación mide el alto real de cada bloque y traslada a una hoja nueva todo lo que no cabe. Cuando un párrafo es más alto que el espacio disponible, el editor lo divide por líneas y vuelve a unir las mitades antes de guardar o exportar.

El texto de esta sección sirve como relleno controlado. No contiene instrucciones especiales, sólo frases completas que permiten observar cómo se comporta el flujo de lectura en una hoja vertical.

## Sección 2

Los encabezados no se separan del párrafo que los sigue. Si un título queda demasiado cerca del borde inferior, se traslada junto con su contenido a la página siguiente. Esto evita títulos huérfanos al final de una hoja.

- Primer elemento de una lista.
- Segundo elemento, con texto suficiente para ocupar una línea completa.
- Tercer elemento con una nota final.
- Cuarto elemento para comprobar el espaciado entre viñetas.

## Sección 3

Una tabla también puede dividirse por filas cuando no cabe completa:

| Columna A | Columna B | Columna C |
| --- | --- | --- |
| Dato 1 | Descripción breve | 12 |
| Dato 2 | Descripción algo más larga | 24 |
| Dato 3 | Texto de prueba | 36 |
| Dato 4 | Otra fila de ejemplo | 48 |
| Dato 5 | Más contenido | 60 |
| Dato 6 | Cierre de la tabla | 72 |

## Sección 4

Una fórmula en bloque ocupa su propio espacio y nunca se parte por la mitad:

$$\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}$$

Después de la fórmula continúa el texto con normalidad. Las fórmulas en línea, como $a^2+b^2=c^2$, se integran con la tipografía del párrafo.

## Sección 5

El contenido puede pegarse desde una respuesta de IA en formato Markdown. El editor detecta encabezados, listas, tablas, enlaces, citas e imágenes, y los convierte en bloques editables.

> Una cita de ejemplo para comprobar el estilo del bloque y su separación respecto del texto anterior.

Enlaces de prueba: [documentación de KaTeX](https://katex.org/) y [Markdown Guide](https://www.markdownguide.org/).

## Sección 6

Para forzar una página nueva se puede usar el botón de salto de página de la barra superior. El marcador es visible mientras se edita, pero se oculta al imprimir y al exportar.

\pagebreak

## Página forzada

Este contenido empieza en una hoja nueva gracias al salto de página manual. Sirve para separar capítulos, anexos o secciones que deben comenzar en una hoja limpia.

### Subsección de control

1. Comprueba que el salto se conserva al guardar.
2. Recarga el navegador y verifica que el documento sigue dividido.
3. Exporta a PDF y revisa que la hoja forzada coincide.

## Cierre

Si ves este texto y las páginas anteriores conservan su contenido, la paginación, el almacenamiento y la exportación están funcionando correctamente.
