-- AlterEnum
ALTER TYPE "MetodoPago" ADD VALUE 'MIXTO';

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "cambio" INTEGER,
ADD COLUMN     "recibido" INTEGER,
ADD COLUMN     "referencia" TEXT;

-- CreateTable
CREATE TABLE "VentaPago" (
    "id" SERIAL NOT NULL,
    "ventaId" INTEGER NOT NULL,
    "metodo" "MetodoPago" NOT NULL,
    "monto" INTEGER NOT NULL,

    CONSTRAINT "VentaPago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VentaPago_ventaId_idx" ON "VentaPago"("ventaId");

-- AddForeignKey
ALTER TABLE "VentaPago" ADD CONSTRAINT "VentaPago_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Las ventas anteriores quedan con un único pago por su total, así la caja y
-- los reportes cuadran solo desde VentaPago.
INSERT INTO "VentaPago" ("ventaId", "metodo", "monto")
SELECT v.id, v."metodoPago", v.total FROM "Venta" v
WHERE NOT EXISTS (SELECT 1 FROM "VentaPago" p WHERE p."ventaId" = v.id);
