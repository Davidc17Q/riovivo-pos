-- CreateEnum
CREATE TYPE "EstadoCuenta" AS ENUM ('ABIERTA', 'COBRADA', 'CANCELADA');

-- CreateTable
CREATE TABLE "Cuenta" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "estado" "EstadoCuenta" NOT NULL DEFAULT 'ABIERTA',
    "abiertaEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "abiertaPorId" INTEGER NOT NULL,
    "cerradaEn" TIMESTAMPTZ(3),
    "ventaId" INTEGER,

    CONSTRAINT "Cuenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuentaItem" (
    "id" SERIAL NOT NULL,
    "cuentaId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "CuentaItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cuenta_ventaId_key" ON "Cuenta"("ventaId");

-- CreateIndex
CREATE INDEX "Cuenta_estado_idx" ON "Cuenta"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "CuentaItem_cuentaId_productoId_key" ON "CuentaItem"("cuentaId", "productoId");

-- AddForeignKey
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_abiertaPorId_fkey" FOREIGN KEY ("abiertaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
