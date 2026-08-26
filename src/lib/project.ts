import { BLANK_CODE, SLOT1_CODE, SLOT_COUNT, DEV_PREFIX } from '../geometry'
import { getModule } from '../library'
import type { Complex, Project, ProjectMeta, Section, SlotInstance } from '../types'

let uidCounter = 0
export function newUid(): string {
  uidCounter += 1
  return `c${Date.now().toString(36)}${uidCounter}`
}

/** Значения надписей по умолчанию для модуля */
export function defaultLabels(moduleCode: string): Record<string, string[]> {
  const spec = getModule(moduleCode)
  if (!spec) return {}
  const out: Record<string, string[]> = {}
  for (const l of spec.labels) {
    if (l.editable) out[l.id] = [...l.default]
  }
  return out
}

export function makeSlot(n: number, moduleCode: string): SlotInstance {
  return { n, moduleCode, labels: defaultLabels(moduleCode) }
}

export function makeSection(): Section {
  const slots: SlotInstance[] = []
  for (let n = 1; n <= SLOT_COUNT; n++) {
    slots.push(makeSlot(n, n === 1 ? SLOT1_CODE : BLANK_CODE))
  }
  return { uid: newUid(), slots }
}

/** Комплекс секций управления из заданного числа секций */
export function makeComplex(id: string, sections = 1): Complex {
  return { id, sections: Array.from({ length: sections }, () => makeSection()) }
}

/** Обозначение комплекса по умолчанию */
export const DEFAULT_COMPLEX_ID = 'КСУ1'

/** Сведения проекта, они же графы основной надписи чертежа */
export function defaultMeta(name = 'Новый проект'): ProjectMeta {
  return {
    name,
    code: DEV_PREFIX,
    author: '',
    date: new Date().toISOString().slice(0, 10),
    docCode: '',
    building: '',
    stage: 'Р',
    org: 'ООО «Нефтяные технологии»',
    checker: '',
    inspector: '',
    gip: '',
  }
}

export function makeProject(name = 'Новый проект', sections = 3): Project {
  return {
    version: 2,
    project: defaultMeta(name),
    complexes: [makeComplex(DEFAULT_COMPLEX_ID, sections)],
  }
}

/** Глубокая копия секции с новым uid. Надписи можно не переносить. */
export function cloneSection(sec: Section, withLabels: boolean): Section {
  return {
    uid: newUid(),
    slots: sec.slots.map((s) => ({
      n: s.n,
      moduleCode: s.moduleCode,
      labels: withLabels ? JSON.parse(JSON.stringify(s.labels)) : defaultLabels(s.moduleCode),
    })),
  }
}

/** Допустим ли модуль в слоте n */
export function isAllowed(code: string, n: number): boolean {
  const spec = getModule(code)
  return !!spec && spec.allowedSlots.includes(n)
}

/**
 * Проект версии 1: комплекс назывался секцией, а секция — шкафом.
 * Обозначение прежней секции (SEC1) больше не нужно: так теперь обозначаются
 * сами секции, а комплекс получает обозначение по умолчанию.
 */
interface LegacyProject {
  sections?: { id?: string; cabinets?: Section[] }[]
}

function migrate(p: Project & LegacyProject): Project {
  if (Array.isArray(p.complexes)) return p
  const legacy = p.sections ?? []
  p.complexes = legacy.map((s, i) => ({
    id: i === 0 ? DEFAULT_COMPLEX_ID : `КСУ${i + 1}`,
    sections: s.cabinets ?? [],
  }))
  delete p.sections
  p.version = 2
  return p
}

/** Приведение загруженного проекта к текущей схеме */
export function normalizeProject(raw: unknown): Project {
  const p = raw as Project & LegacyProject
  if (!p || typeof p !== 'object' || !(Array.isArray(p.complexes) || Array.isArray(p.sections))) {
    throw new Error('Файл не является проектом конфигуратора')
  }
  migrate(p)
  // сведения проекта могли быть сохранены прежней версией — дополняем
  p.project = { ...defaultMeta(), ...(p.project ?? {}) }
  if (!p.complexes.length) p.complexes.push(makeComplex(DEFAULT_COMPLEX_ID))
  for (const complex of p.complexes) {
    if (!complex.id) complex.id = DEFAULT_COMPLEX_ID
    if (!Array.isArray(complex.sections)) complex.sections = []
    if (!complex.sections.length) complex.sections.push(makeSection())
    for (const sec of complex.sections) {
      if (!sec.uid) sec.uid = newUid()
      const slots: SlotInstance[] = []
      for (let n = 1; n <= SLOT_COUNT; n++) {
        const found = sec.slots?.find((s) => s.n === n)
        const fallback = n === 1 ? SLOT1_CODE : BLANK_CODE
        const code = n === 1 ? SLOT1_CODE : found?.moduleCode || fallback
        // модуль должен существовать в библиотеке и быть допустимым для этого слота
        const known = isAllowed(code, n) ? code : fallback
        slots.push({ n, moduleCode: known, labels: { ...defaultLabels(known), ...(found?.labels ?? {}) } })
      }
      sec.slots = slots
    }
  }
  return p
}
