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
npm run db:seed               # usuarios y catálogo de prueba
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
  descuento en $ o %, método de pago), ticket imprimible y ventas del día.
- **Administración** — `http://localhost:3100/admin` (solo admin): productos, inventario,
  usuarios y reportes por día y por método de pago. Un vendedor que abra esta dirección
  vuelve a ventas, y la API le responde 403.

## Cómo funciona lo importante

- **Venta atómica**: la venta, sus líneas y el descuento de inventario se guardan en una sola
  transacción. Si algo falla (por ejemplo, no alcanza el stock), no se guarda nada.
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
src/       server.ts, auth.ts, util.ts, db.ts, routes/ventas.ts, routes/admin.ts
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

## Fuera de este MVP

Facturación electrónica DIAN, nómina, propinas, integraciones, anulación de ventas y cierre de caja.
