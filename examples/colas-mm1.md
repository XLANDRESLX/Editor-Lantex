# Colas M/M/1

Un sistema de colas **M/M/1** tiene llegadas de tipo Poisson, tiempos de servicio exponenciales y un único servidor. Es el modelo más sencillo para estudiar congestión y tiempos de espera.

## Parámetros y estabilidad

Sea $\lambda$ la tasa media de llegadas (clientes por unidad de tiempo) y $\mu$ la tasa media de servicio. La intensidad de tráfico es

$$\rho = \frac{\lambda}{\mu}$$

El sistema es estable cuando $\rho < 1$. Si $\rho \ge 1$, la cola crece sin límite y el tiempo medio de espera diverge.

## Medidas de rendimiento

| Medida | Expresión | Comentario |
| --- | --- | --- |
| Utilización | $\rho = \lambda/\mu$ | Fracción de tiempo con el servidor ocupado |
| Número medio en cola | $L_q = \dfrac{\rho^2}{1-\rho}$ | Clientes esperando |
| Número medio en el sistema | $L = \dfrac{\rho}{1-\rho}$ | En cola y en servicio |
| Tiempo medio en cola | $W_q = \dfrac{\rho}{\mu-\lambda}$ | Espera antes de ser atendido |
| Tiempo medio en el sistema | $W = \dfrac{1}{\mu-\lambda}$ | Espera más servicio |

La ley de Little relaciona las medidas de conteo y de tiempo:

$$L = \lambda W, \qquad L_q = \lambda W_q$$

## Ejemplo numérico

Supongamos $\lambda = 18$ clientes por hora y $\mu = 24$ clientes por hora. Entonces

$$\rho = \frac{18}{24} = 0{,}75$$

$$W_q = \frac{0{,}75}{24-18} = 0{,}125\ \text{h} = 7{,}5\ \text{min}$$

$$L_q = \frac{0{,}75^2}{1-0{,}75} = 2{,}25\ \text{clientes}$$

> La utilización del 75 % deja un margen razonable, pero un aumento de $\lambda$ hasta 23 clientes por hora elevaría $L_q$ a más de 20 clientes.

\pagebreak

## Simulación mínima en Python

El siguiente fragmento estima el tiempo medio de espera mediante una simulación de eventos discretos muy simplificada.

```python
import random

def simular_mm1(lam, mu, clientes=20000):
    t = 0.0
    espera_total = 0.0
    libre = 0.0
    for _ in range(clientes):
        t += random.expovariate(lam)
        inicio = max(t, libre)
        espera_total += inicio - t
        libre = inicio + random.expovariate(mu)
    return espera_total / clientes

print(simular_mm1(18, 24))
```

## Lista de comprobación

1. Verificar que $\lambda < \mu$.
2. Calcular $\rho$ y comprobar que no se acerca peligrosamente a 1.
3. Obtener $L$, $L_q$, $W$ y $W_q$ con las fórmulas de la tabla.
4. Comparar con la simulación o con datos reales.
5. Documentar los supuestos: Poisson, servicio exponencial, un servidor, disciplina FIFO.
