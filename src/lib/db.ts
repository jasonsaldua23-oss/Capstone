import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const candidate = error as {
    name?: string
    code?: string
    message?: string
  }

  if (candidate.name === 'PrismaClientInitializationError') return true
  if (typeof candidate.code === 'string' && ['P1001', 'P1002', 'P1017'].includes(candidate.code)) return true

  const message = String(candidate.message || '')
  return /(can't reach database server|connection timed out|connection refused|connection terminated|enotfound|econnrefused)/i.test(message)
}
