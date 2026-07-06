-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('pendiente', 'confirmado', 'cancelado', 'no_show');

-- CreateEnum
CREATE TYPE "AppointmentModality" AS ENUM ('spa', 'domicilio');

-- DropIndex
DROP INDEX "Room_tenantId_idx";

-- DropIndex
DROP INDEX "Service_tenantId_idx";

-- DropIndex
DROP INDEX "User_tenantId_idx";

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "offersHomeService" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canAttendAppointments" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientIntake" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "allergiesEnc" BYTEA,
    "allergiesIv" BYTEA,
    "allergiesTag" BYTEA,
    "conditionsEnc" BYTEA,
    "conditionsIv" BYTEA,
    "conditionsTag" BYTEA,
    "consentSigned" BOOLEAN NOT NULL DEFAULT false,
    "consentSignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "modality" "AppointmentModality" NOT NULL DEFAULT 'spa',
    "roomId" TEXT,
    "homeAddress" TEXT,
    "staffId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'pendiente',
    "confirmationToken" TEXT NOT NULL,
    "priceUsd" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_tenantId_idx" ON "Client"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_tenantId_whatsapp_key" ON "Client"("tenantId", "whatsapp");

-- CreateIndex
CREATE UNIQUE INDEX "ClientIntake_clientId_key" ON "ClientIntake"("clientId");

-- CreateIndex
CREATE INDEX "ClientIntake_tenantId_idx" ON "ClientIntake"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_confirmationToken_key" ON "Appointment"("confirmationToken");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_idx" ON "Appointment"("tenantId");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_startsAt_idx" ON "Appointment"("tenantId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_roomId_startsAt_key" ON "Appointment"("roomId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_staffId_startsAt_key" ON "Appointment"("staffId", "startsAt");

-- CreateIndex
CREATE INDEX "Room_tenantId_specialty_active_idx" ON "Room"("tenantId", "specialty", "active");

-- CreateIndex
CREATE INDEX "Service_tenantId_category_active_idx" ON "Service"("tenantId", "category", "active");

-- CreateIndex
CREATE INDEX "User_tenantId_role_active_canAttendAppointments_idx" ON "User"("tenantId", "role", "active", "canAttendAppointments");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientIntake" ADD CONSTRAINT "ClientIntake_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientIntake" ADD CONSTRAINT "ClientIntake_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
