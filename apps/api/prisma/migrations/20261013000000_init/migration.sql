-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Container" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gtmContainerId" TEXT NOT NULL,
    "containerConfig" TEXT NOT NULL,
    "webContainerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "statusMessage" TEXT,
    "upstreamUrl" TEXT NOT NULL,
    "loaderGtmPath" TEXT NOT NULL,
    "loaderGtagPath" TEXT NOT NULL,
    "webhookPath" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "powerUps" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Container_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "containerId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verifiedAt" DATETIME,
    "lastCheckedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Domain_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UsageHour" (
    "containerId" TEXT NOT NULL,
    "hour" DATETIME NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "loader" INTEGER NOT NULL DEFAULT 0,
    "webhook" INTEGER NOT NULL DEFAULT 0,
    "botFlagged" INTEGER NOT NULL DEFAULT 0,
    "botDropped" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("containerId", "hour"),
    CONSTRAINT "UsageHour_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Container_tenantId_idx" ON "Container"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_hostname_key" ON "Domain"("hostname");

-- CreateIndex
CREATE INDEX "Domain_containerId_idx" ON "Domain"("containerId");

