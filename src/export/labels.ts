import { getModule } from '../library'
import { sectionDesignation, sectionId } from '../lib/designation'
import type { Complex, Project, Section } from '../types'

/**
 * Таблица надписей (шильдов) для изготовления: печать на плёнке ORACAL,
 * защитная плёнка, обрезка по контуру, наклейка.
 *
 * Выгружается CSV в UTF-8 с BOM и разделителем «;» — открывается в Excel без импорта.
 */

export interface LabelRow {
  /** Обозначение комплекса секций управления */
  complex: string
  /** Обозначение секции: SEC1, SEC2, … */
  section: string
  designation: string
  slot: number
  moduleCode: string
  moduleName: string
  labelId: string
  lines: string[]
  w: number
  h: number
  fontSize: number
  editable: boolean
}

export function collectLabels(complex: Complex, sections: Section[] = complex.sections): LabelRow[] {
  const rows: LabelRow[] = []
  for (const sec of sections) {
    const id = sectionId(complex.sections.indexOf(sec))
    const designation = sectionDesignation(sec)
    for (const slot of sec.slots) {
      const spec = getModule(slot.moduleCode)
      if (!spec) continue
      for (const l of spec.labels) {
        const values = (l.editable ? slot.labels[l.id] : undefined) ?? l.default
        const lines = Array.from({ length: l.lines }, (_, i) => values[i] ?? '')
        rows.push({
          complex: complex.id,
          section: id,
          designation,
          slot: slot.n,
          moduleCode: spec.code,
          moduleName: spec.name,
          labelId: l.id,
          lines,
          // в таблицу для изготовления идут размеры с точностью 0,1 мм
          w: Math.round(l.w * 10) / 10,
          h: Math.round(l.h * 10) / 10,
          fontSize: l.fontSize ?? +((l.h / l.lines) * 0.6).toFixed(1),
          editable: l.editable,
        })
      }
    }
  }
  return rows
}

const q = (v: string | number) => {
  const s = String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function labelsToCsv(project: Project, rows: LabelRow[]): string {
  const maxLines = Math.max(1, ...rows.map((r) => r.lines.length))
  const header = [
    'Проект',
    'КСУ',
    'Секция',
    'Обозначение секции',
    'Слот',
    'Код модуля',
    'Наименование модуля',
    'Шильд',
    ...Array.from({ length: maxLines }, (_, i) => `Строка ${i + 1}`),
    'Ширина, мм',
    'Высота, мм',
    'Кегль, мм',
    'Редактируемый',
  ]
  const body = rows.map((r) =>
    [
      project.project.name,
      r.complex,
      r.section,
      r.designation,
      r.slot,
      r.moduleCode,
      r.moduleName,
      r.labelId,
      ...Array.from({ length: maxLines }, (_, i) => r.lines[i] ?? ''),
      r.w,
      r.h,
      r.fontSize,
      r.editable ? 'да' : 'нет',
    ]
      .map(q)
      .join(';'),
  )
  // BOM, чтобы Excel распознал UTF-8
  return '﻿' + [header.map(q).join(';'), ...body].join('\r\n') + '\r\n'
}
