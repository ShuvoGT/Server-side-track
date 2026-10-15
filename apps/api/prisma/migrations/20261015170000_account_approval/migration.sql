-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('pending', 'active', 'rejected');

-- AlterTable: accounts that exist already are approved; new ones wait for approval.
ALTER TABLE "User" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'active';
UPDATE "User" SET "approvedAt" = "createdAt";
ALTER TABLE "User" ALTER COLUMN "status" SET DEFAULT 'pending';
