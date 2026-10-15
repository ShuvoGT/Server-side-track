-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ContainerStatus" AS ENUM ('pending', 'provisioning', 'active', 'failed', 'deleting');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('pending', 'verified', 'failed');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Container" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gtmContainerId" TEXT NOT NULL,
    "containerConfig" TEXT NOT NULL,
    "webContainerId" TEXT,
    "status" "ContainerStatus" NOT NULL DEFAULT 'pending',
    "statusMessage" TEXT,
    "upstreamUrl" TEXT NOT NULL,
    "loaderGtmPath" TEXT NOT NULL,
    "loaderGtagPath" TEXT NOT NULL,
    "webhookPath" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "powerUps" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Container_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "DomainStatus" NOT NULL DEFAULT 'pending',
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageHour" (
    "containerId" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "loader" INTEGER NOT NULL DEFAULT 0,
    "webhook" INTEGER NOT NULL DEFAULT 0,
    "botFlagged" INTEGER NOT NULL DEFAULT 0,
    "botDropped" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageHour_pkey" PRIMARY KEY ("containerId","hour")
);

-- CreateIndex
CREATE INDEX "Container_tenantId_idx" ON "Container"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_hostname_key" ON "Domain"("hostname");

-- CreateIndex
CREATE INDEX "Domain_containerId_idx" ON "Domain"("containerId");

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageHour" ADD CONSTRAINT "UsageHour_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container"("id") ON DELETE CASCADE ON UPDATE CASCADE;

