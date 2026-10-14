import { getModule } from '../library'
import type { Section } from '../types'

/** Строка перечня приборов: один тип прибора с количеством и обозначениями */
export interface DeviceRow {
  article: string
  name: string
  qty: number
  /** Позиционные обозначения по РД в виде «слот:обозначение» */
  refs: string[]
}

/**
 * Приборы секций, сгруппированные по артикулу и наименованию.
 *
 * Позиционные обозначения относятся к панели, а не к секции: в комплексе из
 * нескольких одинаковых секций один и тот же перечень повторялся бы, поэтому
 * обозначения не дублируются.
 */
export function collectDevices(sections: Section[]): DeviceRow[] {
  const rows = new Map<string, DeviceRow>()
  for (const sec of sections) {
    for (const slot of sec.slots) {
      const spec = getModule(slot.moduleCode)
      if (!spec) continue
      for (const d of spec.devices) {
        const name = d.name ?? d.type
        const article = d.article ?? ''
        const key = `${article} ${name}`
        const row = rows.get(key) ?? { article, name, qty: 0, refs: [] }
        row.qty++
        const ref = d.ref ? `${slot.n}:${d.ref}` : ''
        if (ref && !row.refs.includes(ref)) row.refs.push(ref)
        rows.set(key, row)
      }
    }
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
}
