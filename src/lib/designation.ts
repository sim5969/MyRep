import { BLANK_CODE, DEV_PREFIX } from '../geometry'
import type { Section } from '../types'

/**
 * Обозначение секции: НТ53.AA.BB.CC.DD,
 * где AA…DD — коды модулей в слотах 2…5. Слот 1 в коде не участвует.
 */
export function sectionDesignation(sec: Section): string {
  const codes = [2, 3, 4, 5].map((n) => sec.slots.find((s) => s.n === n)?.moduleCode || BLANK_CODE)
  return [DEV_PREFIX, ...codes].join('.')
}

/** Отображаемый идентификатор секции в комплексе: SEC1, SEC2, … */
export function sectionId(index: number): string {
  return `SEC${index + 1}`
}

/** Позиционное обозначение устройства: «слот.номер» */
export function devicePosition(slot: number, deviceId: string): string {
  return `${slot}.${deviceId}`
}
