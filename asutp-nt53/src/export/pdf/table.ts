import type { Align, PdfPage } from './doc'
import { MID, THIN } from './frame'

/** Таблицы на листе: шапка и строки, тонкие линии по ГОСТ 2.303 */

export interface Column {
  title: string
  w: number
  align?: Align
}

export interface TableOptions {
  x: number
  /** Отметка верха таблицы */
  yTop: number
  cols: Column[]
  rows: string[][]
  /** Заголовок над таблицей */
  title?: string
  rowH?: number
  cap?: number
}

/** Таблица с шапкой. Возвращает отметку низа */
export function drawTable(p: PdfPage, o: TableOptions): number {
  const rowH = o.rowH ?? 6
  const cap = o.cap ?? 2.5
  const w = o.cols.reduce((s, c) => s + c.w, 0)
  let yTop = o.yTop
  if (o.title) {
    p.text(o.x, yTop - 3.5, 3.5, o.title)
    yTop -= 6
  }
  const h = rowH * (o.rows.length + 1)
  const yBottom = yTop - h
  p.rect(o.x, yBottom, w, h, MID)
  p.line(o.x, yTop - rowH, o.x + w, yTop - rowH, THIN)
  for (let i = 1; i <= o.rows.length; i++) {
    const y = yTop - rowH * (i + 1)
    if (i < o.rows.length) p.line(o.x, y, o.x + w, y, THIN)
  }
  let x = o.x
  o.cols.forEach((c, i) => {
    if (i) p.line(x, yBottom, x, yTop, THIN)
    const cx = c.align === 'left' ? x + 1 : x + c.w / 2
    p.textMid(cx, yTop - rowH / 2, cap, p.fit(c.title, cap, c.w - 2), c.align === 'left' ? 'left' : 'center')
    o.rows.forEach((row, k) => {
      const v = row[i] ?? ''
      if (!v) return
      p.textMid(cx, yTop - rowH * (k + 1) - rowH / 2, cap, p.fit(v, cap, c.w - 2), c.align === 'left' ? 'left' : 'center')
    })
    x += c.w
  })
  return yBottom
}
