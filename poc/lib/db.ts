import { PrismaClient } from "@prisma/client";

/**
 * Prisma client 单例
 * Next.js 开发模式下 hot reload 会导致重复实例化连接池
 * 这里用 globalThis 缓存来避免
 */
declare global {
  var prisma: PrismaClient | undefined;
}

export const db =
  globalThis.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = db;
}
