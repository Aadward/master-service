-- CreateTable
CREATE TABLE "Customer" (
    "customerId" TEXT NOT NULL PRIMARY KEY,
    "externalRef" TEXT,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "industry" TEXT,
    "customerType" TEXT NOT NULL,
    "legalEntity" TEXT,
    "defaultCurrency" TEXT,
    "overallStatus" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "updatedBy" TEXT
);

-- CreateTable
CREATE TABLE "ConfigTask" (
    "taskId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "pageRef" TEXT,
    "status" TEXT NOT NULL,
    "dependsOnJson" TEXT NOT NULL,
    "suggestedConfigSnapshot" TEXT,
    "claimOwner" TEXT,
    "claimedAt" DATETIME,
    "claimTimeoutAt" DATETIME,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lastErrorMsg" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "ConfigTask_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("customerId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConfigTemplate" (
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "customerType" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("templateId", "version")
);

-- CreateTable
CREATE TABLE "LookupTable" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL,
    "entries" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "updatedBy" TEXT
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" TEXT,
    "taskId" INTEGER,
    "eventType" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "actor" TEXT,
    "reason" TEXT,
    "extra" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("customerId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_externalRef_key" ON "Customer"("externalRef");

-- CreateIndex
CREATE INDEX "Customer_overallStatus_idx" ON "Customer"("overallStatus");

-- CreateIndex
CREATE INDEX "ConfigTask_customerId_status_idx" ON "ConfigTask"("customerId", "status");

-- CreateIndex
CREATE INDEX "ConfigTask_module_status_idx" ON "ConfigTask"("module", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigTask_customerId_taskKey_key" ON "ConfigTask"("customerId", "taskKey");

-- CreateIndex
CREATE INDEX "ConfigTemplate_customerType_isActive_idx" ON "ConfigTemplate"("customerType", "isActive");

-- CreateIndex
CREATE INDEX "AuditLog_taskId_createdAt_idx" ON "AuditLog"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_customerId_createdAt_idx" ON "AuditLog"("customerId", "createdAt");
