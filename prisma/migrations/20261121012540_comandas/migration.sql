-- CreateEnum
CREATE TYPE "Estacion" AS ENUM ('NINGUNA', 'COCINA', 'BAR');

-- CreateEnum
CREATE TYPE "EstadoComanda" AS ENUM ('PENDIENTE', 'PREPARANDO', 'LISTA', 'ENTREGADA', 'CANCELADA');

-- AlterEnum
ALTER TYPE "Rol" ADD VALUE 'COCINA';

-- AlterTable
ALTER TABLE "Producto" ADD COLUMN     "estacion" "Estacion" NOT NULL DEFAULT 'NINGUNA';

-- CreateTable
CREATE TABLE "Comanda" (
    "id" SERIAL NOT NULL,
    "creadaEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadaEn" TIMESTAMPTZ(3) NOT NULL,
    "estacion" "Estacion" NOT NULL,
    "estado" "EstadoComanda" NOT NULL DEFAULT 'PENDIENTE',
    "referencia" TEXT,
    "ventaId" INTEGER,
    "cuentaId" INTEGER,
    "usuarioId" INTEGER NOT NULL,

    CONSTRAINT "Comanda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComandaItem" (
    "id" SERIAL NOT NULL,
    "comandaId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "ComandaItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Comanda_estado_estacion_idx" ON "Comanda"("estado", "estacion");

-- AddForeignKey
ALTER TABLE "Comanda" ADD CONSTRAINT "Comanda_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comanda" ADD CONSTRAINT "Comanda_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comanda" ADD CONSTRAINT "Comanda_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComandaItem" ADD CONSTRAINT "ComandaItem_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "Comanda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Estación inicial según la categoría del catálogo real (el admin puede cambiarla por producto).
UPDATE "Producto" SET "estacion" = 'COCINA'
WHERE "categoria" IN ('Restaurante', 'Asados y picadas', 'Catering');
UPDATE "Producto" SET "estacion" = 'BAR'
WHERE "categoria" IN ('Bebidas', 'Heladería');
