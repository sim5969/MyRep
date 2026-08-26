import type { PdfPage } from './doc'
import { FIELDS, FRAME, LINES, LOGO, LOGO_PX, SHEET, STAMP, TEXTS, type FrameField } from './frame-a3'

/**
 * Фирменная рамка А3 с большим штампом ООО «НТ».
 *
 * Геометрия и графы взяты из шаблона AI-пакета организации и лежат в
 * `frame-a3.ts` (файл создаётся скриптом `scripts/gen-frame.mjs`). Здесь только
 * отрисовка и подстановка значений в графы.
 */

export { FRAME, SHEET, STAMP }

/** Имя ресурса логотипа в документе */
export const LOGO_IMAGE = 'Im0'

/** Толщины линий чертежа, мм. Толщины рамки берутся из шаблона */
export const MID = 0.35
export const THIN = 0.25

export interface StampValues {
  /** Обозначение документа (шифр) */
  docCode: string
  /** Наименование объекта, до двух строк */
  object: string
  /** Наименование здания, сооружения */
  building: string
  /** Наименование чертежа */
  title: string
  /** Стадия */
  stage: string
  sheet: number
  sheets: number
  /** Наименование организации */
  org: string
  /** Фамилии: разработал, проверил, нормоконтроль, ГИП */
  author: string
  checker: string
  inspector: string
  gip: string
}

/** Графы штампа: теги свойств EPLAN из шаблона */
const TAG = {
  docCode: '4_11090[1]',
  object: '4_11090[2]',
  building: '4_11090[3]',
  title: '4_11090[4]',
  stage: '14_10031',
  sheet: '4_11000',
  sheets: '4_11004',
  org: '14_10015',
  author: '4_40101',
  checker: '4_40102',
  inspector: '4_40103',
  gip: '4_40104',
} as const

/** Наименьший кегль, до которого сжимается надпись в графе, мм */
const MIN_CAP = 1.6
/** Межстрочный шаг в долях кегля — как в шаблоне */
const LINE_STEP = 1.333

/** Свободная ширина графы от точки привязки с учётом выключки */
function avail(f: FrameField): number {
  const pad = 0.8
  if (!f.w) return 60
  return (f.align === 'center' ? f.w : f.w - pad) - pad
}

/** Значение в графу: кегль уменьшается, пока надпись не войдёт в ячейку */
function put(p: PdfPage, tag: string, value: string, line = 0) {
  const f = FIELDS[tag]
  if (!f || !value) return
  const room = avail(f)
  let cap = f.cap
  while (cap > MIN_CAP && p.textWidth(value, cap) > room) cap = Math.round((cap - 0.1) * 10) / 10
  const y = f.y - line * f.cap * LINE_STEP
  p.text(f.x, y, cap, p.fit(value, cap, room), f.align, f.rot ?? 0)
}

/** Разбивка длинной надписи по словам на не более чем maxLines строк */
function wrap(p: PdfPage, tag: string, value: string, maxLines: number): string[] {
  const f = FIELDS[tag]
  if (!f) return [value]
  const room = avail(f)
  if (maxLines < 2 || p.textWidth(value, f.cap) <= room) return [value]
  const words = value.split(/\s+/)
  const rows: string[] = ['']
  for (const word of words) {
    const i = rows.length - 1
    const next = rows[i] ? `${rows[i]} ${word}` : word
    if (p.textWidth(next, f.cap) <= room || !rows[i] || rows.length >= maxLines) rows[i] = next
    else rows.push(word)
  }
  return rows
}

/**
 * Оформление листа: рамка, штамп, зоны, логотип и значения граф.
 * Рисуется в отдельный поток содержимого страницы.
 */
export function drawSheetFrame(p: PdfPage, v: StampValues) {
  p.sheetFrame(() => {
    for (const l of LINES) p.line(l.x1, l.y1, l.x2, l.y2, l.lw)
    for (const t of TEXTS) p.text(t.x, t.y, t.cap, t.text, t.align, t.rot ?? 0)

    if (LOGO) {
      // логотип вписывается в отведённое место без искажения пропорций
      const k = Math.min(LOGO.w / LOGO_PX.w, LOGO.h / LOGO_PX.h)
      const w = LOGO_PX.w * k
      const h = LOGO_PX.h * k
      p.image(LOGO_IMAGE, LOGO.x + (LOGO.w - w) / 2, LOGO.y + (LOGO.h - h) / 2, w, h)
    }

    put(p, TAG.docCode, v.docCode)
    wrap(p, TAG.object, v.object, 2).forEach((line, i) => put(p, TAG.object, line, i))
    put(p, TAG.building, v.building)
    put(p, TAG.title, v.title)
    put(p, TAG.stage, v.stage)
    put(p, TAG.sheet, String(v.sheet))
    put(p, TAG.sheets, String(v.sheets))
    put(p, TAG.org, v.org)
    put(p, TAG.author, v.author)
    put(p, TAG.checker, v.checker)
    put(p, TAG.inspector, v.inspector)
    put(p, TAG.gip, v.gip)
  })
}
