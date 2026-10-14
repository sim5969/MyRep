/**
 * Геометрия секции. Все размеры в миллиметрах.
 * Начало координат секции — левый верхний угол корпуса, ось Y вниз.
 */

export const SECTION_W = 600
export const CORPUS_H = 2000
export const PLINTH_H = 200
/** Полная высота секции с цоколем */
export const SECTION_H = CORPUS_H + PLINTH_H // 2200

/** Проём в двери под модули */
export const OPENING_W = 540
export const OPENING_H = 1400
/** Отметка низа проёма от пола */
export const OPENING_BOTTOM_FROM_FLOOR = 700
/** Y верха проёма от верха секции */
export const OPENING_TOP = SECTION_H - OPENING_BOTTOM_FROM_FLOOR - OPENING_H // 100
export const OPENING_X = (SECTION_W - OPENING_W) / 2 // 30

/** Лицевая панель модуля совпадает с проёмом по ширине */
export const PANEL_W = 540
export const PANEL_X = (SECTION_W - PANEL_W) / 2 // 30

/** Высоты слотов сверху вниз */
export const SLOT_HEIGHTS = [400, 250, 250, 250, 250] as const
export const SLOT_COUNT = SLOT_HEIGHTS.length

/** Y верха слота n (n = 1..5) от верха секции */
export function slotTop(n: number): number {
  let y = OPENING_TOP
  for (let i = 0; i < n - 1; i++) y += SLOT_HEIGHTS[i]
  return y
}

export function slotHeight(n: number): number {
  return SLOT_HEIGHTS[n - 1]
}

/** Код модуля-заглушки */
export const BLANK_CODE = '00'
/** Код неизменяемой панели слота 1. В обозначении секции не выводится */
export const SLOT1_CODE = '01'
/** Номер разработки */
export const DEV_PREFIX = 'НТ53'
