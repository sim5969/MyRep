import { PANEL_W, PANEL_X, SECTION_H, SECTION_W, slotHeight, slotTop } from '../geometry'
import { getModule } from '../library'
import { sectionDesignation, sectionId } from '../lib/designation'
import type { Complex, Project, Section } from '../types'
import { collectDevices } from './bom'
import { collectLabels } from './labels'
import { drawSection, SECTION_PITCH, type Painter, type Pen } from './facade'
import { PdfDoc, type PdfPage } from './pdf/doc'
import { drawSheetFrame, FRAME, LOGO_IMAGE, SHEET, STAMP, THIN, type StampValues } from './pdf/frame'
import { drawTable } from './pdf/table'

/**
 * Альбом вида на фасад на листах А3 в фирменной рамке ООО «НТ» — шаблон
 * AI-пакета организации, большой штамп (ГОСТ 21.101 / ГОСТ 2.104).
 *
 * Лист 1 — комплекс секций управления целиком, далее на каждую секцию: лист
 * вида на фасад (состав по слотам и перечень приборов с позиционными
 * обозначениями по рабочей документации) и лист таблицы надписей. Масштаб печатается рядом с заголовком
 * вида: графы «Масштаб» в этом штампе нет.
 */

/** Ряд масштабов уменьшения по ГОСТ 2.302 */
const SCALES = [2, 2.5, 4, 5, 10, 15, 20, 25, 40, 50]

/** Масштаб листов с секцией: 2200 мм по высоте в поле листа А3 */
const SECTION_SCALE = 10

/** Толщина линии на листе по назначению, мм */
const LINE_W: Record<Pen, number> = {
  section: 0.5,
  plinth: 0.35,
  opening: 0.35,
  panel: 0.25,
  device: 0.35,
  cutout: 0.18,
  label: 0.18,
  text: 0,
  position: 0,
  designation: 0.25,
}

/**
 * Наименьшая высота прописной буквы на листе по назначению надписи, мм.
 *
 * Надписи шильдов выводятся в любом масштабе: в масштабе 1:10 буква выходит
 * около 0,22 мм — на бумаге это серая полоса, но текст векторный и читается
 * при увеличении на экране, а на чертеже видно, что и где написано. Читаемый
 * перечень надписей остаётся в выгрузке «Надписи».
 *
 * Наименования приборов внутри их контуров при уменьшении только загрязняют
 * чертёж — состав приборов даёт таблица на листе.
 */
const MIN_CAP: Record<Pen, number> = {
  section: 0,
  plinth: 0,
  opening: 0,
  panel: 0,
  device: 1,
  cutout: 0,
  label: 0,
  text: 0.12,
  position: 0.6,
  designation: 0.4,
}

/** Отрисовка фасада на листе: натуральные миллиметры → миллиметры листа */
class SheetPainter implements Painter {
  constructor(
    private readonly p: PdfPage,
    private readonly k: number,
    private readonly dx: number,
    private readonly dy: number,
  ) {}

  private mx(x: number) {
    return this.dx + x * this.k
  }

  private my(y: number) {
    return this.dy + y * this.k
  }

  line(pen: Pen, x1: number, y1: number, x2: number, y2: number) {
    this.p.line(this.mx(x1), this.my(y1), this.mx(x2), this.my(y2), LINE_W[pen])
  }

  rect(pen: Pen, x: number, y: number, w: number, h: number) {
    this.p.rect(this.mx(x), this.my(y), w * this.k, h * this.k, LINE_W[pen])
  }

  circle(pen: Pen, cx: number, cy: number, r: number) {
    this.p.circle(this.mx(cx), this.my(cy), r * this.k, LINE_W[pen])
  }

  text(pen: Pen, cx: number, cy: number, cap: number, value: string) {
    const c = cap * this.k
    if (c < MIN_CAP[pen]) return
    this.p.textMid(this.mx(cx), this.my(cy), c, value, 'center')
  }
}

const scaleLabel = (s: number) => `1:${String(s).replace('.', ',')}`

/** Высота полосы подписей над видом */
const CAPTION_H = 11
/** Высота полосы заголовка листа */
const HEAD_H = 11
/** Отметка верха основной надписи: ниже неё правая часть листа занята */
const STAMP_TOP = STAMP.y + STAMP.h

/** Подпись над секцией: идентификатор и обозначение */
function sectionCaption(p: PdfPage, cx: number, yBase: number, id: string, designation: string) {
  p.text(cx, yBase + 5.5, 3.5, id, 'center')
  p.text(cx, yBase + 1, 3, designation, 'center')
}

/** Подобрать масштаб из ряда ГОСТ 2.302 так, чтобы вид уместился в поле листа */
function pickScale(sections: number): number {
  for (const s of SCALES) {
    const w = (sections * SECTION_W) / s
    const h = SECTION_H / s + CAPTION_H
    // если вид шире свободной части листа, он не должен заходить на штамп
    const availH = w > FRAME.w - STAMP.w - 10 ? FRAME.h - STAMP.h - HEAD_H - 4 : FRAME.h - HEAD_H - 4
    if (w <= FRAME.w - 10 && h <= availH) return s
  }
  return SCALES[SCALES.length - 1]
}

/** Лист комплекса секций управления. Возвращает масштаб вида */
function sheetComplex(page: PdfPage, complex: Complex, sections: Section[]): number {
  const scale = pickScale(sections.length)
  const k = 1 / scale
  page.text(FRAME.x + 5, FRAME.y + FRAME.h - 8, 5, `Комплекс секций управления ${complex.id}. Вид на фасад`)
  page.text(FRAME.x + 5, FRAME.y + FRAME.h - 14, 3.5, `Масштаб ${scaleLabel(scale)}`)

  const viewW = (sections.length * SECTION_W) / scale
  const viewH = SECTION_H / scale
  const top = FRAME.y + FRAME.h - HEAD_H - 4
  const bottom = top - CAPTION_H - viewH
  const x = FRAME.x + 5
  const painter = new SheetPainter(page, k, x, bottom)

  sections.forEach((sec, i) => {
    drawSection(painter, sec, i * SECTION_PITCH, { positions: false, cutouts: false })
    const cx = x + (i * SECTION_PITCH + SECTION_W / 2) / scale
    sectionCaption(page, cx, bottom + viewH, sectionId(complex.sections.indexOf(sec)), sectionDesignation(sec))
  })

  // состав комплекса: справа от вида, а если там не хватает ширины — под видом
  const cols = [
    { title: 'Секция', w: 24 },
    { title: 'Обозначение', w: 44 },
    { title: 'Слот 2', w: 17 },
    { title: 'Слот 3', w: 17 },
    { title: 'Слот 4', w: 17 },
    { title: 'Слот 5', w: 17 },
  ]
  const need = cols.reduce((s, c) => s + c.w, 0)
  const rowH = 5.5
  const height = 6 + rowH * (sections.length + 1)
  const right = FRAME.x + FRAME.w - 5 - (x + viewW + 10) >= need
  // под видом таблица не должна дойти до штампа, если она шире свободной части листа
  const floor = need > FRAME.w - STAMP.w - 10 ? STAMP_TOP + 4 : FRAME.y + 4
  // справа таблица начинается на уровне вида: выше идёт полоса заголовка листа
  const place = right
    ? { x: x + viewW + 10, yTop: top }
    : bottom - 10 - height >= floor
      ? { x, yTop: bottom - 10 }
      : null
  if (place) {
    drawTable(page, {
      ...place,
      title: 'Состав комплекса',
      cols,
      rows: sections.map((sec) => [
        sectionId(complex.sections.indexOf(sec)),
        sectionDesignation(sec),
        ...[2, 3, 4, 5].map((n) => sec.slots.find((s) => s.n === n)?.moduleCode ?? ''),
      ]),
      rowH,
    })
  }
  return scale
}

/** Лист секции */
function sheetSection(page: PdfPage, complex: Complex, sec: Section) {
  const scale = SECTION_SCALE
  const k = 1 / scale
  const id = sectionId(complex.sections.indexOf(sec))
  const designation = sectionDesignation(sec)

  page.text(FRAME.x + 5, FRAME.y + FRAME.h - 8, 5, `Секция ${id}  ${designation}`)
  page.text(FRAME.x + 5, FRAME.y + FRAME.h - 14, 3.5, `Вид на фасад. Масштаб ${scaleLabel(scale)}`)

  const top = FRAME.y + FRAME.h - 20
  const bottom = top - SECTION_H / scale
  const x = FRAME.x + 8
  drawSection(new SheetPainter(page, k, x, bottom), sec, 0, { positions: false, cutouts: false })

  // выноски номеров слотов: связывают вид с таблицей состава
  const panelRight = x + (PANEL_X + PANEL_W) * k
  const markX = x + SECTION_W * k + 4
  for (const slot of sec.slots) {
    const yMid = bottom + (SECTION_H - slotTop(slot.n) - slotHeight(slot.n) / 2) * k
    page.line(panelRight, yMid, markX - 1, yMid, THIN)
    page.textMid(markX, yMid, 3, String(slot.n), 'left')
  }

  // --- состав секции по слотам ---------------------------------------------
  const tableX = x + SECTION_W / scale + 12
  const y = drawTable(page, {
    x: tableX,
    yTop: top,
    title: 'Состав секции',
    cols: [
      { title: 'Слот', w: 14 },
      { title: 'Код', w: 14 },
      { title: 'Наименование модуля', w: 190, align: 'left' },
      { title: 'Приборов', w: 22 },
      { title: 'Шильдов', w: 22 },
    ],
    rows: sec.slots.map((slot) => {
      const spec = getModule(slot.moduleCode)
      return [
        String(slot.n),
        slot.moduleCode,
        spec?.name ?? 'модуль не найден',
        String(spec?.devices.length ?? 0),
        String(spec?.labels.length ?? 0),
      ]
    }),
    rowH: 5.5,
  })

  // --- приборы на фасаде ----------------------------------------------------
  const devices = collectDevices([sec])
  const rowH = 5
  // таблица не должна заходить на основную надпись
  const limit = STAMP_TOP + 4
  const maxRows = Math.max(0, Math.floor((y - 12 - limit) / rowH) - 1)
  const shown = devices.slice(0, maxRows)
  drawTable(page, {
    x: tableX,
    yTop: y - 8,
    title: 'Приборы на фасаде',
    cols: [
      { title: 'Наименование', w: 132, align: 'left' },
      { title: 'Артикул', w: 46, align: 'left' },
      { title: 'Кол.', w: 12, align: 'center' },
      { title: 'Позиционные обозначения', w: 112, align: 'left' },
    ],
    rows: shown.map((d) => [d.name, d.article, String(d.qty), d.refs.join(', ')]),
    rowH,
  })
  if (shown.length < devices.length) {
    page.text(
      tableX,
      limit - 4,
      2.5,
      `Показано ${shown.length} позиций из ${devices.length}. Полный перечень — в спецификации XLSX.`,
    )
  }
}

// ---------------------------------------------------------------------------
// Лист надписей
// ---------------------------------------------------------------------------

/** Строка таблицы надписей: одинаковые шильды сведены в одну строку */
interface LabelRow {
  slot: number
  qty: number
  lines: string[]
  /** Размер шильда, мм */
  size: string
}

/**
 * Надписи секции для таблицы. Выводятся только редактируемые надписи — то, что
 * задаёт проектировщик; неизменяемые подписи органов управления («Готов»,
 * «Стоп PLC») входят в состав модуля и на лист не идут.
 *
 * Совпадающие шильды одного модуля сводятся в одну строку с количеством: на
 * листе важны сами тексты, а привязка к конкретному шильду есть в выгрузке
 * «Надписи», где каждый шильд идёт отдельной строкой.
 */
function labelRows(complex: Complex, sec: Section): LabelRow[] {
  const mm = (v: number) => String(v).replace('.', ',')
  const rows = new Map<string, LabelRow>()
  for (const l of collectLabels(complex, [sec]).filter((l) => l.editable)) {
    const size = `${mm(l.w)} × ${mm(l.h)}`
    const key = `${l.slot}|${l.lines.join('|')}|${size}`
    const row = rows.get(key) ?? { slot: l.slot, qty: 0, lines: l.lines, size }
    row.qty++
    rows.set(key, row)
  }
  // в пределах слота сначала двухстрочные шильды «назначение / объект»,
  // затем однострочные подписи органов управления
  return [...rows.values()]
    .filter((r) => r.lines.some(Boolean))
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => a.slot - b.slot || b.lines.filter(Boolean).length - a.lines.filter(Boolean).length || a.i - b.i)
}

/** Высота строки и кегль таблицы надписей */
const LABEL_ROW_H = 4.5
const LABEL_CAP = 2.2
const LABEL_COLS = [
  { title: 'Слот', w: 12 },
  { title: 'Кол.', w: 11 },
  { title: 'Строка 1', w: 64, align: 'left' as const },
  { title: 'Строка 2', w: 64, align: 'left' as const },
  { title: 'Размер, мм', w: 22 },
]
const LABEL_COL_W = LABEL_COLS.reduce((s, c) => s + c.w, 0)

/** Отступ верха таблицы надписей от верха поля листа: заголовок и примечание */
const LABEL_TOP = 26

/** Сколько строк входит в столбец: правый столбец упирается в основную надпись */
function labelColumnRows(right: boolean): number {
  const top = FRAME.y + FRAME.h - LABEL_TOP
  const bottom = (right ? STAMP_TOP : FRAME.y) + 4
  return Math.max(0, Math.floor((top - bottom) / LABEL_ROW_H) - 1)
}

/** Сколько листов надписей нужно секции */
function labelSheetCount(rows: number): number {
  const perSheet = labelColumnRows(false) + labelColumnRows(true)
  return rows ? Math.ceil(rows / perSheet) : 0
}

/** Лист надписей: две колонки таблицы, part — номер листа надписей секции */
function sheetLabels(page: PdfPage, id: string, designation: string, rows: LabelRow[], part: number, parts: number) {
  page.text(FRAME.x + 5, FRAME.y + FRAME.h - 8, 5, `Секция ${id}  ${designation}`)
  page.text(
    FRAME.x + 5,
    FRAME.y + FRAME.h - 14,
    3.5,
    `Надписи на фасаде${parts > 1 ? `. Лист ${part} из ${parts}` : ''}`,
  )
  page.text(
    FRAME.x + 5,
    FRAME.y + FRAME.h - 19,
    2.5,
    'Приведены редактируемые надписи. Неизменяемые подписи органов управления входят в состав модулей.',
  )

  const left = labelColumnRows(false)
  const right = labelColumnRows(true)
  const from = (part - 1) * (left + right)
  const yTop = FRAME.y + FRAME.h - LABEL_TOP
  const cell = (r: LabelRow) => [String(r.slot), String(r.qty), r.lines[0] ?? '', r.lines[1] ?? '', r.size]

  const first = rows.slice(from, from + left)
  if (first.length) {
    drawTable(page, {
      x: FRAME.x + 5,
      yTop,
      cols: LABEL_COLS,
      rows: first.map(cell),
      rowH: LABEL_ROW_H,
      cap: LABEL_CAP,
    })
  }
  const second = rows.slice(from + left, from + left + right)
  if (second.length) {
    drawTable(page, {
      x: FRAME.x + 5 + LABEL_COL_W + 12,
      yTop,
      cols: LABEL_COLS,
      rows: second.map(cell),
      rowH: LABEL_ROW_H,
      cap: LABEL_CAP,
    })
  }
}

/** Файлы оформления листа: чертёжный шрифт и логотип организации */
export interface PdfAssets {
  font: Uint8Array
  logo?: Uint8Array
}

/** Собрать альбом. sections — какие секции выгружать */
export async function buildFacadePdf(
  project: Project,
  complex: Complex,
  sections: Section[],
  assets: PdfAssets,
): Promise<Uint8Array> {
  const doc = new PdfDoc(assets.font)
  if (assets.logo) doc.addImage(LOGO_IMAGE, assets.logo)

  const meta = project.project
  // состав альбома: лист комплекса, затем на каждую секцию лист фасада и листы надписей
  const parts = sections.map((sec) => {
    const rows = labelRows(complex, sec)
    return { sec, rows, labelSheets: labelSheetCount(rows.length) }
  })
  const sheets = 1 + parts.reduce((n, p) => n + 1 + p.labelSheets, 0)
  const common: Omit<StampValues, 'title' | 'sheet'> = {
    docCode: meta.docCode?.trim() || `${meta.code || 'НТ53'} ВО`,
    object: meta.name,
    building: meta.building ?? '',
    stage: meta.stage ?? '',
    sheets,
    org: meta.org ?? '',
    author: meta.author,
    checker: meta.checker ?? '',
    inspector: meta.inspector ?? '',
    gip: meta.gip ?? '',
  }

  const first = doc.addPage(SHEET.w, SHEET.h)
  sheetComplex(first, complex, sections)
  drawSheetFrame(first, { ...common, title: `Вид на фасад комплекса ${complex.id}`, sheet: 1 })

  let sheet = 1
  for (const { sec, rows, labelSheets } of parts) {
    const id = sectionId(complex.sections.indexOf(sec))
    const designation = sectionDesignation(sec)

    const page = doc.addPage(SHEET.w, SHEET.h)
    sheetSection(page, complex, sec)
    drawSheetFrame(page, { ...common, title: `Вид на фасад секции ${id}`, sheet: ++sheet })

    for (let part = 1; part <= labelSheets; part++) {
      const labels = doc.addPage(SHEET.w, SHEET.h)
      sheetLabels(labels, id, designation, rows, part, labelSheets)
      drawSheetFrame(labels, { ...common, title: `Надписи на фасаде секции ${id}`, sheet: ++sheet })
    }
  }

  return doc.build({
    title: `${meta.name} — вид на фасад ${complex.id}`,
    author: meta.author,
    date: meta.date,
  })
}
