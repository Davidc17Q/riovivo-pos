-- CreateEnum
CREATE TYPE "EstadoPedidoMesa" AS ENUM ('PENDIENTE', 'ACEPTADO', 'RECHAZADO');

-- CreateTable
CREATE TABLE "PedidoMesa" (
    "id" SERIAL NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mesa" TEXT NOT NULL,
    "nota" TEXT,
    "estado" "EstadoPedidoMesa" NOT NULL DEFAULT 'PENDIENTE',
    "atendidoEn" TIMESTAMPTZ(3),
    "atendidoPorId" INTEGER,
    "cuentaId" INTEGER,

    CONSTRAINT "PedidoMesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoMesaLinea" (
    "id" SERIAL NOT NULL,
    "pedidoId" INTEGER NOT NULL,
    "restaurante" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioCarta" INTEGER NOT NULL,
    "productoId" INTEGER,

    CONSTRAINT "PedidoMesaLinea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AliasCarta" (
    "clave" TEXT NOT NULL,
    "productoId" INTEGER NOT NULL,

    CONSTRAINT "AliasCarta_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE INDEX "PedidoMesa_estado_idx" ON "PedidoMesa"("estado");

-- AddForeignKey
ALTER TABLE "PedidoMesaLinea" ADD CONSTRAINT "PedidoMesaLinea_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "PedidoMesa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
