-- CreateTable
CREATE TABLE "Ajuste" (
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Ajuste_pkey" PRIMARY KEY ("clave")
);
