import { SECTION_W } from '../geometry'
import { sectionId } from '../lib/designation'
import type { Complex, Section } from '../types'
import { CAP_RATIO, drawSection, SECTION_PITCH, type Painter, type Pen } from './facade'

/**
 * Выгрузка вида на фасад в DXF (формат R12, читается всеми CAD).
 *
 * Единицы — миллиметры, ось Y направлена вверх (в модели вниз, при выгрузке зеркалится).
 * Кириллица кодируется escape-последовательностями \U+XXXX, чтобы не зависеть от кодовой
 * страницы файла.
 */

/**
 * Слои чертежа по назначению линии. Имена латиницей: имена таблиц DXF не
 * поддерживают escape-последовательности \U+
 */
export const LAYERS: Record<Pen, { name: string; color: number }> = {
  section: { name: 'SECTION', color: 7 }, // корпус секции
  plinth: { name: 'PLINTH', color: 8 }, // цоколь
  opening: { name: 'OPENING', color: 7 }, // рамка проёма
  panel: { name: 'PANEL', color: 9 }, // лицевые панели модулей
  device: { name: 'DEVICES', color: 5 }, // приборы
  cutout: { name: 'CUTOUT', color: 4 }, // монтажные вырезы в панели
  label: { name: 'LABELS', color: 3 }, // рамки шильдов
  text: { name: 'TEXT', color: 2 }, // надписи на шильдах
  position: { name: 'POSITIONS', color: 1 }, // позиционные обозначения
  designation: { name: 'DESIGNATION', color: 6 }, // обозначение секции и комплекса
}

function esc(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    out += c < 128 ? ch : `\\U+${c.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

const num = (v: number) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(3).replace(/\.?0+$/, ''))

class DxfWriter implements Painter {
  private out: string[] = []

  private g(code: number, value: string | number) {
    this.out.push(String(code), String(value))
  }

  private layer(pen: Pen): string {
    return LAYERS[pen].name
  }

  line(pen: Pen, x1: number, y1: number, x2: number, y2: number) {
    this.g(0, 'LINE')
    this.g(8, this.layer(pen))
    this.g(10, num(x1))
    this.g(20, num(y1))
    this.g(30, '0')
    this.g(11, num(x2))
    this.g(21, num(y2))
    this.g(31, '0')
  }

  rect(pen: Pen, x: number, y: number, w: number, h: number) {
    this.line(pen, x, y, x + w, y)
    this.line(pen, x + w, y, x + w, y + h)
    this.line(pen, x + w, y + h, x, y + h)
    this.line(pen, x, y + h, x, y)
  }

  circle(pen: Pen, cx: number, cy: number, r: number) {
    this.g(0, 'CIRCLE')
    this.g(8, this.layer(pen))
    this.g(10, num(cx))
    this.g(20, num(cy))
    this.g(30, '0')
    this.g(40, num(r))
  }

  /** Текст, выключенный по центру относительно точки (cx, cy). cap — высота прописной буквы */
  text(pen: Pen, cx: number, cy: number, cap: number, value: string) {
    if (!value) return
    this.g(0, 'TEXT')
    this.g(8, this.layer(pen))
    this.g(10, num(cx))
    this.g(20, num(cy))
    this.g(30, '0')
    this.g(40, num(cap))
    this.g(1, esc(value))
    this.g(72, 1) // по центру
    this.g(11, num(cx))
    this.g(21, num(cy))
    this.g(31, '0')
    this.g(73, 2) // по середине высоты
  }

  build(): string {
    const head: string[] = []
    const push = (code: number, value: string | number) => head.push(String(code), String(value))

    push(0, 'SECTION')
    push(2, 'HEADER')
    push(9, '$ACADVER')
    push(1, 'AC1009')
    push(9, '$INSUNITS')
    push(70, 4) // миллиметры
    push(0, 'ENDSEC')

    push(0, 'SECTION')
    push(2, 'TABLES')
    push(0, 'TABLE')
    push(2, 'LAYER')
    push(70, Object.keys(LAYERS).length)
    for (const l of Object.values(LAYERS)) {
      push(0, 'LAYER')
      push(2, l.name)
      push(70, 0)
      push(62, l.color)
      push(6, 'CONTINUOUS')
    }
    push(0, 'ENDTAB')
    push(0, 'ENDSEC')

    push(0, 'SECTION')
    push(2, 'ENTITIES')

    return [...head, ...this.out, '0', 'ENDSEC', '0', 'EOF', ''].join('\r\n')
  }
}

/** Собрать DXF по комплексу. sections — какие секции выгружать (по умолчанию все) */
export function buildDxf(complex: Complex, sections: Section[] = complex.sections): string {
  const w = new DxfWriter()
  sections.forEach((sec, i) => {
    const xOff = i * SECTION_PITCH
    drawSection(w, sec, xOff)
    // идентификатор секции под цоколем
    w.text('designation', xOff + SECTION_W / 2, -30, 18 * CAP_RATIO, sectionId(complex.sections.indexOf(sec)))
  })
  return w.build()
}
