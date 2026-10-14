/**
 * Загрузка модулей приложения (TypeScript) в Node.
 *
 * Библиотека панелей подтягивается через import.meta.glob, поэтому модули
 * грузятся загрузчиком Vite — тем же, что и в браузере. Так командная строка
 * и приложение дают побайтово одинаковые выгрузки.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Значение аргумента --имя=значение */
export function arg(name, dflt) {
  const a = process.argv.find((v) => v.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : dflt
}

/** Есть ли флаг --имя */
export function flag(name) {
  return process.argv.includes(`--${name}`)
}

/**
 * Выполнить fn, передав ей функцию загрузки модуля приложения.
 * Сервер Vite закрывается в любом случае.
 */
export async function withApp(fn) {
  const { createServer } = await import('vite')
  const server = await createServer({
    root: ROOT,
    logLevel: 'warn',
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  })
  try {
    return await fn((path) => server.ssrLoadModule(path))
  } finally {
    await server.close()
  }
}
