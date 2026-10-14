import {
  SECTION_H,
  SECTION_W,
  CORPUS_H,
  OPENING_H,
  OPENING_TOP,
  OPENING_W,
  OPENING_X,
  PANEL_W,
  PANEL_X,
  slotHeight,
  slotTop,
} from '../geometry'
import { getModule } from '../library'
import { sectionDesignation } from '../lib/designation'
import type { DeviceSpec, LabelSpec, Section } from '../types'

/**
 * Вид на фасад секции в чертёжных координатах: миллиметры натуральной величины,
 * начало — левый нижний угол цоколя, ось Y вверх.
 *
 * Геометрия описана один раз и рисуется через Painter, который реализуют
 * выгрузки: DXF (слои) и PDF (толщины линий на листе). Так вид на фасад в обоих
 * документах строится по одному и тому же коду.
 */

/** Назначение линии или надписи. Backend сам решает, чем её рисовать */
export type Pen =
  | 'section' // корпус секции
  | 'plinth' // цоколь
  | 'opening' // рамка проёма
  | 'panel' // лицевая панель модуля
  | 'device' // прибор
  | 'cutout' // монтажный вырез в панели
  | 'label' // рамка шильда
  | 'text' // надпись на шильде
  | 'position' // позиционное обозначение прибора
  | 'designation' // обозначение секции

export interface Painter {
  line(pen: Pen, x1: number, y1: number, x2: number, y2: number): void
  /** Прямоугольник по левому нижнему углу */
  rect(pen: Pen, x: number, y: number, w: number, h: number): void
  circle(pen: Pen, cx: number, cy: number, r: number): void
  /** Надпись по центру точки (cx, cy). cap — высота прописной буквы */
  text(pen: Pen, cx: number, cy: number, cap: number, value: string): void
}

/** Отношение высоты прописной буквы к кеглю */
export const CAP_RATIO = 0.7

/** Шаг секций в комплексе */
export const SECTION_PITCH = SECTION_W

export interface FacadeOptions {
  /** Выводить позиционные обозначения приборов */
  positions?: boolean
  /** Выводить надписи шильдов */
  texts?: boolean
  /** Выводить монтажные вырезы панелей */
  cutouts?: boolean
}

/** Прибор. oyTop — отметка верха лицевой панели */
function drawDevice(p: Painter, d: DeviceSpec, ox: number, oyTop: number, o: FacadeOptions) {
  // Подсветка переключателя стоит внутри прибора-носителя: своего отверстия и
  // своего контура на фасаде у неё нет, в спецификацию она попадает отдельно.
  if (d.builtIn) return
  // Y модели направлена вниз: переводим в координаты чертежа
  const x = ox + d.x
  const y = oyTop - d.y - d.h

  const cut = d.cutout
  if (cut && o.cutouts !== false) {
    const cx = x + d.w / 2
    const cy = y + d.h / 2
    if (cut.d) p.circle('cutout', cx, cy, cut.d / 2)
    else if (cut.w && cut.h) p.rect('cutout', cx - cut.w / 2, cy - cut.h / 2, cut.w, cut.h)
  }

  switch (d.type) {
    case 'lamp':
    case 'switch':
      p.circle('device', x + d.w / 2, y + d.h / 2, Math.min(d.w, d.h) / 2)
      break
    default: {
      p.rect('device', x, y, d.w, d.h)
      const n = d.displays ?? 0
      const dispW = d.w - 12
      const dispH = Math.min(18, (d.h - 22) / Math.max(n, 1) - 6)
      for (let i = 0; i < n; i++) {
        p.rect('device', x + 6, y + d.h - 12 - dispH - i * (dispH + 24), dispW, dispH)
      }
      if (d.name && d.h > 20 && o.texts !== false) {
        p.text('device', x + d.w / 2, y + d.h - 6, 3 * CAP_RATIO, d.name)
      }
    }
  }
}

function drawLabel(p: Painter, l: LabelSpec, values: string[], ox: number, oyTop: number, o: FacadeOptions) {
  const x = ox + l.x
  const yTop = oyTop - l.y
  if (l.box) p.rect('label', x, yTop - l.h, l.w, l.h)
  if (o.texts === false) return
  const lineH = l.h / l.lines
  for (let i = 0; i < l.lines; i++) {
    const v = values[i] ?? ''
    if (!v) continue
    const fs = l.fontSize ?? lineH * 0.6
    p.text('text', x + l.w / 2, yTop - lineH * i - lineH / 2, fs * CAP_RATIO, v)
  }
}

/**
 * Секция целиком: цоколь, корпус, проём, лицевые панели модулей с приборами
 * и надписями. xOff — сдвиг секции по X (шаг SECTION_PITCH в комплексе).
 */
export function drawSection(p: Painter, sec: Section, xOff: number, o: FacadeOptions = {}) {
  const top = SECTION_H

  p.rect('plinth', xOff, 0, SECTION_W, SECTION_H - CORPUS_H)
  p.rect('section', xOff, SECTION_H - CORPUS_H, SECTION_W, CORPUS_H)
  p.rect('opening', xOff + OPENING_X - 12, top - OPENING_TOP - OPENING_H - 12, OPENING_W + 24, OPENING_H + 24)

  // шильд обозначения над проёмом
  p.rect('designation', xOff + SECTION_W / 2 - 180, top - 66, 360, 44)
  if (o.texts !== false) {
    p.text('designation', xOff + SECTION_W / 2, top - 38, 9 * CAP_RATIO, 'Секция автоматизации')
    p.text('designation', xOff + SECTION_W / 2, top - 56, 12 * CAP_RATIO, sectionDesignation(sec))
  }

  for (const slot of sec.slots) {
    const spec = getModule(slot.moduleCode)
    if (!spec) continue
    const h = slotHeight(slot.n)
    const panelTop = top - slotTop(slot.n)
    const ox = xOff + PANEL_X

    p.rect('panel', ox, panelTop - h, PANEL_W, h)

    for (const l of spec.labels) {
      const values = (l.editable ? slot.labels[l.id] : undefined) ?? l.default
      drawLabel(p, l, values, ox, panelTop, o)
    }
    for (const d of spec.devices) {
      drawDevice(p, d, ox, panelTop, o)
      if (o.positions === false || d.builtIn) continue
      p.text('position', ox + d.x + d.w / 2, panelTop - d.y + 2, 2.4 * CAP_RATIO, `${slot.n}.${d.id}`)
    }
  }
}
