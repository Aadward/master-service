/*
  Warnings:

  - You are about to drop the column `country` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `defaultCurrency` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `industry` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `legalEntity` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Customer` table. All the data in the column will be lost.
  - Added the required column `cust_name` to the `Customer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cust_no` to the `Customer` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "CustomerLocation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "loc_no" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerLocation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("customerId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "customerId" TEXT NOT NULL PRIMARY KEY,
    "cust_no" TEXT NOT NULL,
    "cust_name" TEXT NOT NULL,
    "global_cust_no" TEXT,
    "global_cust_name" TEXT,
    "global_cust_code" TEXT,
    "region_no" TEXT,
    "company_no" TEXT,
    "is_master" BOOLEAN NOT NULL DEFAULT false,
    "is_inter_company" BOOLEAN NOT NULL DEFAULT false,
    "externalRef" TEXT,
    "customerType" TEXT NOT NULL DEFAULT 'standard_b2b',
    "overallStatus" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "updatedBy" TEXT
);
INSERT INTO "new_Customer" ("createdAt", "createdBy", "customerId", "customerType", "externalRef", "overallStatus", "templateId", "templateVersion", "updatedAt", "updatedBy") SELECT "createdAt", "createdBy", "customerId", "customerType", "externalRef", "overallStatus", "templateId", "templateVersion", "updatedAt", "updatedBy" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE UNIQUE INDEX "Customer_cust_no_key" ON "Customer"("cust_no");
CREATE UNIQUE INDEX "Customer_externalRef_key" ON "Customer"("externalRef");
CREATE INDEX "Customer_overallStatus_idx" ON "Customer"("overallStatus");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CustomerLocation_customerId_idx" ON "CustomerLocation"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerLocation_customerId_domain_key" ON "CustomerLocation"("customerId", "domain");
