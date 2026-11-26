-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('PUBLISHED', 'DELETING', 'PURGED');

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "alt" VARCHAR(250) NOT NULL,
    "originalKey" TEXT NOT NULL,
    "originalWidth" INTEGER NOT NULL,
    "originalHeight" INTEGER NOT NULL,
    "status" "PhotoStatus" NOT NULL DEFAULT 'PUBLISHED',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "nextVersion" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoVersion" (
    "photoId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "edits" JSONB NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "PhotoVersion_pkey" PRIMARY KEY ("photoId","version")
);

-- CreateTable
CREATE TABLE "PhotoVariant" (
    "id" SERIAL NOT NULL,
    "photoId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,

    CONSTRAINT "PhotoVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Photo_originalKey_key" ON "Photo"("originalKey");

-- CreateIndex
CREATE INDEX "Photo_status_createdAt_idx" ON "Photo"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoVariant_storageKey_key" ON "PhotoVariant"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoVariant_photoId_version_width_key" ON "PhotoVariant"("photoId", "version", "width");

-- AddForeignKey
ALTER TABLE "PhotoVersion" ADD CONSTRAINT "PhotoVersion_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoVariant" ADD CONSTRAINT "PhotoVariant_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoVariant" ADD CONSTRAINT "PhotoVariant_photoId_version_fkey" FOREIGN KEY ("photoId", "version") REFERENCES "PhotoVersion"("photoId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;
