import type ExcelJS from 'exceljs'
import { getModule } from '../library'
import { sectionDesignation, sectionId } from '../lib/designation'
import type { Complex, Project, Section } from '../types'
import { collectDevices } from './bom'
import { collectLabels } from './labels'

/**
 * Спецификация в XLSX. Четыре листа:
 *  «Состав по секциям» — построчно по слотам,
 *  «Сводная»           — по кодам модулей с количеством, ценой и суммой,
 *  «Приборы»           — по артикулам приборов,
 *  «Надписи»           — таблица шильдов для изготовления.
 *
 * Цена в библиотеке модулей пока не заполнена, поэтому колонка «Цена» остаётся
 * пустой, а «Сумма» и итог считаются формулами Excel — достаточно вписать цены.
 */

const HEAD = { bold: true } as const
const FILL_HEAD: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3F9' } }
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB0B0B0' } },
  left: { style: 'thin', color: { argb: 'FFB0B0B0' } },
  bottom: { style: 'thin', color: { argb: 'FFB0B0B0' } },
  right: { style: 'thin', color: { argb: 'FFB0B0B0' } },
}

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = HEAD
    c.fill = FILL_HEAD
    c.border = BORDER
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  row.height = 30
}

function styleBody(ws: ExcelJS.Worksheet, from: number, to: number) {
  for (let r = from; r <= to; r++) {
    ws.getRow(r).eachCell((c) => {
      c.border = BORDER
      c.alignment = { vertical: 'middle', ...(c.alignment ?? {}) }
    })
  }
}

export async function buildSpecWorkbook(
  project: Project,
  complex: Complex,
  sections: Section[] = complex.sections,
): Promise<ExcelJS.Workbook> {
  // ExcelJS весит около мегабайта, поэтому подгружается только при выгрузке
  const { default: Excel } = await import('exceljs')
  const wb = new Excel.Workbook()
  wb.creator = 'Конфигуратор секций АСУ ТП НТ53'
  wb.created = new Date(project.project.date)

  // --- лист 1: состав по секциям ------------------------------------------
  const ws = wb.addWorksheet('Состав по секциям')
  ws.columns = [
    { header: 'Секция', key: 'sec', width: 12 },
    { header: 'Обозначение секции', key: 'des', width: 22 },
    { header: 'Слот', key: 'slot', width: 7 },
    { header: 'Код', key: 'code', width: 7 },
    { header: 'Наименование модуля', key: 'name', width: 52 },
    { header: 'Высота, мм', key: 'h', width: 11 },
    { header: 'Приборов', key: 'dev', width: 10 },
    { header: 'Шильдов', key: 'lab', width: 10 },
  ]
  styleHeader(ws.getRow(1))
  for (const sec of sections) {
    const id = sectionId(complex.sections.indexOf(sec))
    const des = sectionDesignation(sec)
    for (const slot of sec.slots) {
      const spec = getModule(slot.moduleCode)
      ws.addRow({
        sec: id,
        des,
        slot: slot.n,
        code: slot.moduleCode,
        name: spec?.name ?? 'модуль не найден',
        h: spec?.slotHeight ?? '',
        dev: spec?.devices.length ?? 0,
        lab: spec?.labels.length ?? 0,
      })
    }
  }
  styleBody(ws, 2, ws.rowCount)
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: 'A1', to: { row: 1, column: 8 } }

  // --- лист 2: сводная спецификация ---------------------------------------
  const sum = wb.addWorksheet('Сводная')
  sum.columns = [
    { header: 'Код', key: 'code', width: 7 },
    { header: 'Артикул', key: 'art', width: 16 },
    { header: 'Наименование модуля', key: 'name', width: 52 },
    { header: 'Кол-во', key: 'qty', width: 9 },
    { header: 'Цена, ₽', key: 'price', width: 14 },
    { header: 'Сумма, ₽', key: 'total', width: 16 },
  ]
  styleHeader(sum.getRow(1))

  const counts = new Map<string, number>()
  for (const sec of sections) {
    for (const slot of sec.slots) counts.set(slot.moduleCode, (counts.get(slot.moduleCode) ?? 0) + 1)
  }
  const codes = [...counts.keys()].sort()
  codes.forEach((code, i) => {
    const spec = getModule(code)
    const r = sum.addRow({
      code,
      art: spec?.article ?? '',
      name: spec?.name ?? 'модуль не найден',
      qty: counts.get(code),
      price: spec?.price ?? null,
    })
    const row = i + 2
    r.getCell('total').value = { formula: `IF(E${row}="","",D${row}*E${row})` }
    r.getCell('price').numFmt = '#,##0.00'
    r.getCell('total').numFmt = '#,##0.00'
  })
  const lastRow = sum.rowCount
  const totalRow = sum.addRow({ name: 'Итого', qty: { formula: `SUM(D2:D${lastRow})` } })
  totalRow.getCell('total').value = { formula: `SUM(F2:F${lastRow})` }
  totalRow.getCell('total').numFmt = '#,##0.00'
  totalRow.font = HEAD
  styleBody(sum, 2, sum.rowCount)
  sum.views = [{ state: 'frozen', ySplit: 1 }]

  // --- лист 3: приборы по комплексу ---------------------------------------
  const dev = wb.addWorksheet('Приборы')
  dev.columns = [
    { header: 'Артикул', key: 'art', width: 24 },
    { header: 'Наименование прибора', key: 'name', width: 52 },
    { header: 'Кол-во', key: 'qty', width: 9 },
    { header: 'Обозначения', key: 'refs', width: 40 },
  ]
  styleHeader(dev.getRow(1))
  for (const r of collectDevices(sections)) {
    dev.addRow({ art: r.article, name: r.name, qty: r.qty, refs: r.refs.join('; ') })
  }
  const devLast = dev.rowCount
  const devTotal = dev.addRow({ name: 'Итого', qty: { formula: `SUM(C2:C${devLast})` } })
  devTotal.font = HEAD
  styleBody(dev, 2, dev.rowCount)
  dev.views = [{ state: 'frozen', ySplit: 1 }]

  // --- лист 4: надписи ----------------------------------------------------
  const lab = wb.addWorksheet('Надписи')
  const rows = collectLabels(complex, sections)
  const maxLines = Math.max(1, ...rows.map((r) => r.lines.length))
  lab.columns = [
    { header: 'Секция', key: 'sec', width: 12 },
    { header: 'Обозначение секции', key: 'des', width: 22 },
    { header: 'Слот', key: 'slot', width: 7 },
    { header: 'Код', key: 'code', width: 7 },
    { header: 'Шильд', key: 'id', width: 9 },
    ...Array.from({ length: maxLines }, (_, i) => ({
      header: `Строка ${i + 1}`,
      key: `l${i}`,
      width: 26,
    })),
    { header: 'Ширина, мм', key: 'w', width: 11 },
    { header: 'Высота, мм', key: 'h', width: 11 },
    { header: 'Кегль, мм', key: 'fs', width: 10 },
    { header: 'Редактируемый', key: 'ed', width: 14 },
  ]
  styleHeader(lab.getRow(1))
  for (const r of rows) {
    const data: Record<string, string | number> = {
      sec: r.section,
      des: r.designation,
      slot: r.slot,
      code: r.moduleCode,
      id: r.labelId,
      w: r.w,
      h: r.h,
      fs: r.fontSize,
      ed: r.editable ? 'да' : 'нет',
    }
    for (let i = 0; i < maxLines; i++) data[`l${i}`] = r.lines[i] ?? ''
    lab.addRow(data)
  }
  styleBody(lab, 2, lab.rowCount)
  lab.views = [{ state: 'frozen', ySplit: 1 }]
  lab.autoFilter = { from: 'A1', to: { row: 1, column: lab.columns.length } }

  return wb
}

/** Сформировать XLSX и отдать пользователю */
export async function exportSpecXlsx(project: Project, complex: Complex, sections: Section[], filename: string) {
  const wb = await buildSpecWorkbook(project, complex, sections)
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
