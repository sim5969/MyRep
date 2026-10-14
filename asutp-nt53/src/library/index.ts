import type { ModuleSpec } from '../types'

/**
 * Библиотека модулей: все JSON-описания из src/library.
 * Добавление нового модуля = добавление JSON-файла, изменение кода не требуется.
 */
const files = import.meta.glob<ModuleSpec>('./*.json', { eager: true, import: 'default' })

// порядок каталога — числовой: базовые панели 00…65, затем исполнения 104…345
export const MODULES: ModuleSpec[] = Object.values(files).sort(
  (a, b) => Number(a.code) - Number(b.code) || a.code.localeCompare(b.code),
)

const byCode = new Map(MODULES.map((m) => [m.code, m]))

export function getModule(code: string): ModuleSpec | undefined {
  return byCode.get(code)
}

/** Модули, доступные для установки в слот n */
export function modulesForSlot(n: number): ModuleSpec[] {
  return MODULES.filter((m) => m.allowedSlots.includes(n))
}
