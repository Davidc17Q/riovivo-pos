-- CreateEnum
CREATE TYPE "EstadoCaja" AS ENUM ('ABIERTA', 'CERRADA');

-- CreateEnum
CREATE TYPE "EstadoVenta" AS ENUM ('ACTIVA', 'ANULADA');

-- AlterEnum
ALTER TYPE "TipoMovimiento" ADD VALUE 'ANULACION';

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "anuladaEn" TIMESTAMPTZ(3),
ADD COLUMN     "anuladaPorId" INTEGER,
ADD COLUMN     "cajaId" INTEGER,
ADD COLUMN     "estado" "EstadoVenta" NOT NULL DEFAULT 'ACTIVA',
ADD COLUMN     "motivoAnulacion" TEXT;

-- CreateTable
CREATE TABLE "SesionCaja" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "estado" "EstadoCaja" NOT NULL DEFAULT 'ABIERTA',
    "baseInicial" INTEGER NOT NULL,
    "abiertaEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradaEn" TIMESTAMPTZ(3),
    "cerradaPorId" INTEGER,
    "ventasEfectivo" INTEGER,
    "ventasTarjeta" INTEGER,
    "ventasTransferencia" INTEGER,
    "efectivoEsperado" INTEGER,
    "efectivoContado" INTEGER,
    "diferencia" INTEGER,
    "nota" TEXT,

    CONSTRAINT "SesionCaja_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SesionCaja_usuarioId_estado_idx" ON "SesionCaja"("usuarioId", "estado");

-- CreateIndex
CREATE INDEX "Venta_cajaId_idx" ON "Venta"("cajaId");

-- AddForeignKey
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_cerradaPorId_fkey" FOREIGN KEY ("cerradaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "SesionCaja"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_anuladaPorId_fkey" FOREIGN KEY ("anuladaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
