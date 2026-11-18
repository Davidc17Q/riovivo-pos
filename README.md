# Río Vivo POS (MVP)

Punto de venta para Río Vivo Spa. Node.js + Fastify + TypeScript, PostgreSQL con Prisma,
frontend HTML/CSS/JS sin framework. Dinero en pesos enteros (COP), hora de Colombia.

## Levantar en local

Requisitos: Node 20.12 o superior y Docker.

```bash
docker compose up -d          # Postgres local en el puerto 5433
cp .env.example .env          # en PowerShell: Copy-Item .env.example .env
npm install
npm run db:deploy             # crea las tablas
npm run db:seed               # usuarios de prueba y catálogo real de Río Vivo
npm run db:catalogo           # (bases ya creadas) sincroniza el catálogo real y apaga el de demo
npm run dev                   # http://localhost:3100
```

Producción: `npm run build` y `npm start`, con `DATABASE_URL`, `SESSION_SECRET` (larga y
aleatoria) y `NODE_ENV=production` en el entorno. Sirve la app por HTTPS.

## Usuarios de prueba

| Rol      | Usuario | Contraseña  | Qué ve                   |
|----------|---------|-------------|--------------------------|
| Admin    | `admin` | `admin1234` | Ventas y administración  |
| Vendedor | `caja`  | `caja1234`  | Solo ventas              |

Son solo para probar. Antes de usar el sistema de verdad, crea usuarios propios y desactiva estos.

## Áreas

- **Ventas** — `http://localhost:3100/ventas`: armar la venta (productos, cantidades,
  descuento en $ o %, método de pago), ticket imprimible, ventas del día y **caja**
  (abrir, ver el cuadre en vivo y cerrar con arqueo).
- **Administración** — `http://localhost:3100/admin` (solo admin): productos, inventario,
  cajas de todos, usuarios y reportes (día, método de pago, producto, categoría y vendedor). Un vendedor que abra esta dirección
  vuelve a ventas, y la API le responde 403.

## Caja, anulaciones y reportes

### Caja (apertura, cierre y arqueo)

- Cada usuario abre **su** caja con una base inicial en efectivo (Ventas → Caja). Solo puede
  tener una abierta a la vez.
- **Sin caja abierta no se vende**: la pantalla lo avisa y el servidor rechaza la venta (409).
  Cada venta queda ligada a la caja abierta de quien la registra.
- Al cerrar se escribe el efectivo contado y se guarda el cuadre:
  `efectivo esperado = base inicial + ventas en efectivo` y
  `diferencia = contado − esperado` (positivo sobra, negativo falta). Tarjeta y transferencia
  se guardan aparte.
- El vendedor solo cierra y consulta sus cajas. El admin ve todas (Administración → Cajas) y
  puede cerrar la de otro, por ejemplo si quedó abierta al final del turno.

### Anulación de ventas

- **Regla: solo un ADMIN anula.** Se hace desde Ventas → Ventas del día → tocar la venta →
  "Anular venta", con motivo obligatorio (mínimo 5 caracteres).
- La venta no se borra: queda `ANULADA` con quién, cuándo y por qué. El inventario que
  descontó se repone con un movimiento de tipo "Anulación". Todo en una transacción.
- Una venta anulada **no cuenta** en el cuadre de la caja abierta ni en los reportes, pero sigue
  visible (tachada en el listado, con aviso en el ticket).
- Si se anula **después** de cerrar su caja, el cuadre guardado no se reescribe (es lo que se
  contó ese día); el cuadre muestra un aviso con lo anulado tras el cierre, y la venta sí sale
  de los reportes de ingresos.

### Reportes

En un rango de fechas: total, número de ventas, descuentos y anuladas; por día, por método de
pago, por producto, por categoría y por vendedor. Producto y categoría muestran el valor de las
líneas **antes del descuento** de la venta, así que su suma es `total + descuentos`.

### Cómo probarlo

1. Entra como `caja`. En "Nueva venta" verás el aviso de que no hay caja abierta.
2. Ve a "Caja", abre con una base (p. ej. 100000) y registra una venta en efectivo y otra con tarjeta.
3. Vuelve a "Caja": el efectivo esperado es la base más lo vendido en efectivo.
4. Sal, entra como `admin`, abre "Ir a ventas" → "Ventas del día", toca una venta y anúlala con
   un motivo. Revisa que el total del día baja y que el stock se repone (Administración → Inventario).
5. Entra otra vez como `caja`, escribe el efectivo contado y cierra: verás el cuadre con la diferencia.
6. Como `admin`: Administración → Cajas y → Reportes (prueba el rango "Hoy").

## Cómo funciona lo importante

- **Venta atómica**: la venta, sus líneas y el descuento de inventario se guardan en una sola
  transacción. Si algo falla (por ejemplo, no alcanza el stock), no se guarda nada.
- **Concurrencia**: el stock se descuenta solo si alcanza en ese instante (nunca queda
  negativo). El cierre de caja espera a las ventas en curso y bloquea las nuevas, así que el
  cuadre incluye exactamente lo vendido. Una venta no se puede anular dos veces.
- **Roles en el servidor**: anular, reportes, productos, inventario y usuarios responden 403 a un
  vendedor, aunque llame a la API directamente.
- **Precios**: el servidor toma el precio de la base, no del navegador. Cada línea guarda el
  nombre y el precio del momento, así que editar un producto no cambia ventas pasadas.
- **Inventario**: solo para productos con "Lleva inventario". Cada venta descuenta stock; las
  entradas, salidas y ajustes (conteo físico) se registran en Administración → Inventario, con
  historial. Un insumo interno es un producto con "Se vende en caja" desmarcado.
- **Productos con ventas** no se borran: se desactivan.
- **Sesión**: cookie firmada httpOnly de 12 horas; contraseñas con bcrypt.

## Estructura

```
prisma/    schema.prisma, migraciones, seed.ts
src/       server.ts, auth.ts, util.ts, db.ts, routes/ventas.ts, routes/caja.ts, routes/admin.ts
views/     login.html, ventas.html, admin.html
public/    styles.css, common.js, ventas.js, admin.js
```

## Comandos

| Comando              | Qué hace                                             |
|----------------------|------------------------------------------------------|
| `npm run dev`        | Servidor con recarga automática                      |
| `npm run build`      | Compila TypeScript a `dist/`                         |
| `npm start`          | Corre la versión compilada                           |
| `npm run db:deploy`  | Aplica las migraciones existentes                    |
| `npm run db:migrate` | Crea una migración nueva tras cambiar `schema.prisma` |
| `npm run db:seed`    | Carga los datos de prueba (no duplica)               |
| `npm run test:e2e`   | Prueba de punta a punta (con `npm run dev` corriendo) |

Para empezar con la base vacía: `docker compose down -v`, y luego otra vez
`docker compose up -d`, `npm run db:deploy` y `npm run db:seed`.

## Fuera de alcance por ahora

Facturación electrónica DIAN, nómina, propinas, integraciones, egresos de caja (retiros o
devoluciones de efectivo registradas como movimiento) y anulación parcial de una venta.
