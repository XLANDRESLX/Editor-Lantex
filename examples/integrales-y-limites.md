# Integrales y límites

Este documento reúne definiciones, propiedades y ejercicios resueltos para repasar cálculo diferencial e integral.

## Límites

La definición formal de límite indica que $\lim_{x \to a} f(x) = L$ si para todo $\varepsilon > 0$ existe un $\delta > 0$ tal que

$$0 < |x-a| < \delta \quad \Rightarrow \quad |f(x)-L| < \varepsilon$$

Algunos límites fundamentales:

$$\lim_{x \to 0} \frac{\sin x}{x} = 1, \qquad \lim_{x \to 0} \frac{1-\cos x}{x^2} = \frac{1}{2}$$

$$\lim_{x \to \infty} \left(1+\frac{1}{x}\right)^x = e$$

> Regla de L'Hôpital: si $\lim \frac{f(x)}{g(x)}$ produce una indeterminación $0/0$ o $\infty/\infty$, se puede estudiar el límite del cociente de derivadas $\frac{f'(x)}{g'(x)}$, siempre que este último exista.

## Derivadas e integrales

El teorema fundamental del cálculo conecta ambos conceptos:

$$\frac{d}{dx}\int_a^x f(t)\,dt = f(x)$$

y permite evaluar integrales definidas mediante primitivas:

$$\int_a^b f(x)\,dx = F(b)-F(a), \qquad F'(x)=f(x)$$

### Integrales inmediatas

- $\int x^n\,dx = \dfrac{x^{n+1}}{n+1}+C$ para $n \ne -1$.
- $\int \dfrac{1}{x}\,dx = \ln|x|+C$.
- $\int e^{ax}\,dx = \dfrac{1}{a}e^{ax}+C$.
- $\int \cos(ax)\,dx = \dfrac{1}{a}\sin(ax)+C$.
- $\int \sec^2 x\,dx = \tan x + C$.

## Ejemplo resuelto

Calcular

$$\int_0^1 x^2\,dx$$

Aplicando la regla de la potencia:

$$\int_0^1 x^2\,dx = \left[\frac{x^3}{3}\right]_0^1 = \frac{1}{3}-\frac{0}{3} = \frac{1}{3}$$

## Ejercicios propuestos

1. Calcular $\lim_{x \to 2} \dfrac{x^2-4}{x-2}$.
2. Evaluar $\int_1^e \dfrac{1}{x}\,dx$.
3. Hallar el área entre $y=x^2$ y $y=x$ en el intervalo $[0,1]$.
4. Demostrar que $\lim_{x \to \infty} \dfrac{\ln x}{x} = 0$.
5. Calcular $\int x e^{x}\,dx$ usando integración por partes.

> Sugerencia: dibuja siempre la región de integración y comprueba si conviene dividir el intervalo antes de aplicar una fórmula.
