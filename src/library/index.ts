import type { ModuleSpec } from '../types'

/**
 * Библиотека модулей: все JSON-описания из src/library.
 * Добавление нового модуля = добавление JSON-файла, изменение кода не требуется.
 */
const files = import.meta.glob<ModuleSpec>('./*.json', { eager: true, import: 'default' })

export const MODULES: ModuleSpec[] = Object.values(files).sort((a, b) => a.code.localeCompare(b.code))

const byCode = new Map(MODULES.map((m) => [m.code, m]))

export function getModule(code: string): ModuleSpec | undefined {
  return byCode.get(code)
}

/** Модули, доступные для установки в слот n */
export function modulesForSlot(n: number): ModuleSpec[] {
  return MODULES.filter((m) => m.allowedSlots.includes(n))
}
