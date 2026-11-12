# Matrices y tablas

Las matrices permiten representar sistemas lineales, transformaciones y datos tabulares. Este ejemplo combina fórmulas LaTeX en bloque con tablas de Markdown convertidas a tablas editables.

## Operaciones básicas

Suma y producto por escalar:

$$A+B = \begin{pmatrix} a_{11} & a_{12} \\ a_{21} & a_{22} \end{pmatrix} + \begin{pmatrix} b_{11} & b_{12} \\ b_{21} & b_{22} \end{pmatrix} = \begin{pmatrix} a_{11}+b_{11} & a_{12}+b_{12} \\ a_{21}+b_{21} & a_{22}+b_{22} \end{pmatrix}$$

Producto de matrices:

$$AB = \begin{pmatrix} a_{11} & a_{12} \\ a_{21} & a_{22} \end{pmatrix} \begin{pmatrix} b_{11} & b_{12} \\ b_{21} & b_{22} \end{pmatrix} = \begin{pmatrix} a_{11}b_{11}+a_{12}b_{21} & a_{11}b_{12}+a_{12}b_{22} \\ a_{21}b_{11}+a_{22}b_{21} & a_{21}b_{12}+a_{22}b_{22} \end{pmatrix}$$

Determinante de una matriz $2 \times 2$:

$$\det(A) = a_{11}a_{22}-a_{12}a_{21}$$

## Matriz identidad e inversa

La matriz identidad $I_n$ cumple $AI = IA = A$. Una matriz cuadrada $A$ es invertible si $\det(A) \ne 0$, y entonces

$$A^{-1} = \frac{1}{\det(A)} \begin{pmatrix} d & -b \\ -c & a \end{pmatrix}, \qquad A = \begin{pmatrix} a & b \\ c & d \end{pmatrix}$$

## Tabla de propiedades

| Propiedad | Expresión | Observación |
| --- | --- | --- |
| Asociativa | $(AB)C = A(BC)$ | Válida si las dimensiones coinciden |
| Distributiva | $A(B+C) = AB+AC$ | Distribuye por la izquierda |
| No conmutativa | $AB \ne BA$ | En general el producto no conmuta |
| Transpuesta del producto | $(AB)^T = B^T A^T$ | Cambia el orden |
| Determinante del producto | $\det(AB) = \det(A)\det(B)$ | Matrices cuadradas |

## Tabla de datos

| Muestra | $x_1$ | $x_2$ | Media |
| --- | ---: | ---: | ---: |
| Grupo A | 12 | 15 | 13,5 |
| Grupo B | 9 | 14 | 11,5 |
| Grupo C | 18 | 21 | 19,5 |

\pagebreak

## Sistema lineal

Consideremos el sistema

$$\begin{cases} 2x + y = 5 \\ x - 3y = -1 \end{cases}$$

En forma matricial:

$$\begin{pmatrix} 2 & 1 \\ 1 & -3 \end{pmatrix} \begin{pmatrix} x \\ y \end{pmatrix} = \begin{pmatrix} 5 \\ -1 \end{pmatrix}$$

El determinante es $2(-3)-1(1) = -7 \ne 0$, por lo que existe solución única. Resolviendo:

$$x = 2, \qquad y = 1$$

## Comprobación

| Ecuación | Sustitución | Resultado |
| --- | --- | --- |
| $2x+y=5$ | $2(2)+1$ | $5$ ✓ |
| $x-3y=-1$ | $2-3(1)$ | $-1$ ✓ |

> Convierte siempre los datos en una tabla cuando compares varios casos: es más fácil detectar errores y ordenar la información.
