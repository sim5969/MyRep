/**
 * Разбор фасада лицевой панели из выгрузки EPLAN в DXF.
 *
 * Находит контур монтажной поверхности панели (LWPOLYLINE шириной 540 на слое
 * EPLAN3xx внутри блока), точку его вставки и пересчитывает всю геометрию листа
 * в координаты панели: X — от левой кромки, Y — вниз от верхней кромки.
 *
 * Запуск:
 *   node scripts/rd-facade.mjs "<путь к DXF>"          — сводка по фасаду
 *   node scripts/rd-facade.mjs "<путь к DXF>" --texts  — плюс все надписи
 */
import { readFileSync } from 'node:fs'

// Монтажная поверхность лицевой панели вычерчивается в EPLAN на слое EPLAN31x.
// Панель слота 1 — 400 мм высотой, слотов 2…5 — 250 мм; в выгрузке высота на 1 мм
// меньше габарита панели. Ширина у разных панелей отличается, поэтому берётся
// самый большой подходящий контур, у которого есть вставка на листе.
const MIN_W = 300
const MAX_W = 620
const MIN_H = 200
const MAX_H = 450

const file = process.argv[2]
const withTexts = process.argv.includes('--texts')
if (!file) {
  console.error('Укажите путь к DXF: node scripts/rd-facade.mjs "<файл>"')
  process.exit(1)
}

const lines = readFileSync(file, 'utf8').split(/\r?\n/)

/** Разбор DXF на объекты по секциям, с поддержкой блоков */
function parse() {
  const blocks = new Map() // имя блока → объекты
  const entities = []
  let section = ''
  let blockName = null
  let pendingBlockName = false
  let cur = null
  let sink = entities

  const flush = () => {
    if (cur) sink.push(cur)
    cur = null
  }

  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = lines[i].trim()
    const val = lines[i + 1].trim()

    if (code === '2' && (val === 'HEADER' || val === 'TABLES' || val === 'BLOCKS' || val === 'ENTITIES' || val === 'OBJECTS')) {
      flush()
      section = val
      sink = entities
      continue
    }
    if (section !== 'BLOCKS' && section !== 'ENTITIES') continue

    if (code === '0') {
      flush()
      if (val === 'BLOCK') {
        pendingBlockName = true
        blockName = null
        continue
      }
      if (val === 'ENDBLK') {
        blockName = null
        sink = entities
        continue
      }
      cur = { type: val, xs: [], ys: [], g: {} }
      continue
    }
    if (pendingBlockName && code === '2') {
      blockName = val
      blocks.set(blockName, [])
      sink = blocks.get(blockName)
      pendingBlockName = false
      continue
    }
    if (!cur) continue
    if (code === '10' || code === '11') cur.xs.push(+val)
    else if (code === '20' || code === '21') cur.ys.push(+val)
    else if (code === '1' || code === '3') cur.g[1] = (cur.g[1] ?? '') + val
    else if (!(code in cur.g)) cur.g[code] = val
  }
  flush()
  return { blocks, entities }
}

const { blocks, entities } = parse()

/** Контуры монтажных поверхностей: LWPOLYLINE на слое EPLAN31x внутри блока */
function findPanels() {
  const found = []
  for (const [name, ents] of blocks) {
    for (const e of ents) {
      if (e.type !== 'LWPOLYLINE' || e.xs.length < 4) continue
      if (!/^EPLAN31/.test(e.g[8] ?? '')) continue
      const w = Math.max(...e.xs) - Math.min(...e.xs)
      const h = Math.max(...e.ys) - Math.min(...e.ys)
      if (w < MIN_W || w > MAX_W || h < MIN_H || h > MAX_H) continue
      const ins = entities.find((x) => x.type === 'INSERT' && x.g[2] === name)
      if (!ins) continue
      found.push({
        block: name,
        w,
        h,
        // левый верхний угол контура в координатах листа
        ox: ins.xs[0] + Math.min(...e.xs),
        oyTop: ins.ys[0] + Math.max(...e.ys),
        layer: e.g[8],
      })
    }
  }
  // Лицевая панель узнаётся по высоте: 249 (слоты 2…5) или 399 (слот 1).
  // Всё прочее — монтажные плиты внутри шкафа, они идут после.
  const isFront = (c) => Math.abs(c.h - 249) < 0.5 || Math.abs(c.h - 399) < 0.5
  return found.sort((a, b) => Number(isFront(b)) - Number(isFront(a)) || b.w * b.h - a.w * a.h)
}

const candidates = findPanels()
const panel = candidates[0]
if (!panel) {
  console.error('Контур монтажной поверхности панели не найден. Возможно, это не лист фасада.')
  process.exit(2)
}

console.log(`Файл:   ${file}`)
console.log(`Панель: ${panel.w.toFixed(1)} × ${panel.h.toFixed(1)}  (блок ${panel.block}, слой ${panel.layer})`)
console.log(`Начало координат листа: x=${panel.ox.toFixed(2)}  y=${panel.oyTop.toFixed(2)}`)
if (candidates.length > 1) {
  const other = candidates.slice(1).map((c) => `${c.w.toFixed(1)} × ${c.h.toFixed(1)}`)
  console.log(`Другие контуры на листе: ${other.join(', ')}`)
}
console.log()

const lx = (x) => x - panel.ox
const ly = (y) => panel.oyTop - y
const inside = (x, y) => x >= -20 && x <= panel.w + 20 && y >= -20 && y <= panel.h + 20

// --- окружности ------------------------------------------------------------
const circles = new Map()
for (const e of entities) {
  if (e.type !== 'CIRCLE' || !e.xs.length) continue
  const x = lx(e.xs[0])
  const y = ly(e.ys[0])
  if (!inside(x, y)) continue
  const d = (+e.g[40] * 2).toFixed(2)
  if (!circles.has(d)) circles.set(d, [])
  circles.get(d).push({ x, y })
}

console.log('Окружности (Ø, кол-во, ряды по Y):')
for (const [d, arr] of [...circles.entries()].sort((a, b) => +a[0] - +b[0])) {
  const rows = new Map()
  for (const c of arr) {
    const k = c.y.toFixed(1)
    if (!rows.has(k)) rows.set(k, [])
    rows.get(k).push(c.x)
  }
  const desc = [...rows.entries()]
    .sort((a, b) => +a[0] - +b[0])
    .map(([y, xsRow]) => {
      const sorted = xsRow.sort((a, b) => a - b)
      const steps = [...new Set(sorted.slice(1).map((v, i) => +(v - sorted[i]).toFixed(1)))]
      return `y=${y} n=${sorted.length} x=${sorted.map((v) => +v.toFixed(1)).join(',')}${
        steps.length ? ` шаг ${steps.join('/')}` : ''
      }`
    })
  console.log(`  Ø${d}  всего ${arr.length}`)
  for (const d2 of desc) console.log(`      ${d2}`)
}

// --- прямоугольные контуры приборов ---------------------------------------
const rects = new Map()
for (const e of entities) {
  if (e.type !== 'LWPOLYLINE' || e.xs.length < 4) continue
  const xs = e.xs.map(lx)
  const ys = e.ys.map(ly)
  if (!xs.every((x, i) => inside(x, ys[i]))) continue
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  if (w < 8 || h < 8) continue
  const k = `${w.toFixed(1)} × ${h.toFixed(1)}`
  if (!rects.has(k)) rects.set(k, [])
  rects.get(k).push({ x: Math.min(...xs), y: Math.min(...ys) })
}
if (rects.size) {
  console.log('\nПрямоугольники ≥ 8 мм (габарит, кол-во, левый верхний угол):')
  for (const [k, arr] of [...rects.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const pos = arr
      .sort((a, b) => (Math.abs(a.y - b.y) > 1 ? a.y - b.y : a.x - b.x))
      .map((p) => `(${p.x.toFixed(1)}; ${p.y.toFixed(1)})`)
    console.log(`  ${k}  n=${arr.length}  ${pos.slice(0, 12).join(' ')}${pos.length > 12 ? ' …' : ''}`)
  }
}

// --- прямоугольные вырезы, собранные из четырёх LINE ------------------------
{
  const hor = []
  const ver = []
  for (const e of entities) {
    if (e.type !== 'LINE' || e.xs.length < 2 || e.ys.length < 2) continue
    const x1 = lx(e.xs[0])
    const x2 = lx(e.xs[1])
    const y1 = ly(e.ys[0])
    const y2 = ly(e.ys[1])
    if (!inside(x1, y1) || !inside(x2, y2)) continue
    const r = (v) => +v.toFixed(2)
    if (Math.abs(y1 - y2) < 0.1 && Math.abs(x1 - x2) > 1) {
      hor.push({ a: r(Math.min(x1, x2)), b: r(Math.max(x1, x2)), y: r(y1) })
    } else if (Math.abs(x1 - x2) < 0.1 && Math.abs(y1 - y2) > 1) {
      ver.push({ a: r(Math.min(y1, y2)), b: r(Math.max(y1, y2)), x: r(x1) })
    }
  }
  const vkey = new Set(ver.map((v) => `${v.x}|${v.a}|${v.b}`))
  const found = new Map()
  for (let i = 0; i < hor.length; i++) {
    for (let j = i + 1; j < hor.length; j++) {
      const p = hor[i]
      const q = hor[j]
      if (p.a !== q.a || p.b !== q.b || Math.abs(p.y - q.y) < 1) continue
      const top = Math.min(p.y, q.y)
      const bot = Math.max(p.y, q.y)
      if (!vkey.has(`${p.a}|${top}|${bot}`) || !vkey.has(`${p.b}|${top}|${bot}`)) continue
      const k = `${(p.b - p.a).toFixed(1)} × ${(bot - top).toFixed(1)}`
      if (!found.has(k)) found.set(k, [])
      found.get(k).push({ x: p.a, y: top })
    }
  }
  if (found.size) {
    console.log('\nПрямоугольники из четырёх линий (вырезы под щитовые приборы):')
    for (const [k, arr] of [...found.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const rows = new Map()
      for (const p of arr) {
        const key = p.y.toFixed(1)
        if (!rows.has(key)) rows.set(key, [])
        rows.get(key).push(p.x)
      }
      console.log(`  ${k}  всего ${arr.length}`)
      for (const [y, xsRow] of [...rows.entries()].sort((a, b) => +a[0] - +b[0])) {
        const sorted = xsRow.sort((a, b) => a - b)
        const steps = [...new Set(sorted.slice(1).map((v, i2) => +(v - sorted[i2]).toFixed(1)))]
        console.log(
          `      y=${y} n=${sorted.length} x=${sorted.map((v) => +v.toFixed(1)).join(',')}` +
            (steps.length ? ` шаг ${steps.join('/')}` : ''),
        )
      }
    }
  }
}

// --- надписи --------------------------------------------------------------
const clean = (s) =>
  s
    .replace(/\\P/g, ' / ')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const texts = []
for (const e of entities) {
  if (e.type !== 'TEXT' && e.type !== 'MTEXT' && e.type !== 'ATTRIB') continue
  if (!e.xs.length) continue
  const x = lx(e.xs[0])
  const y = ly(e.ys[0])
  if (!inside(x, y)) continue
  const t = clean(e.g[1] ?? '')
  if (t) texts.push({ x, y, h: +(e.g[40] ?? 0), t })
}
texts.sort((a, b) => (Math.abs(a.y - b.y) > 1.5 ? a.y - b.y : a.x - b.x))

console.log(`\nНадписей внутри панели: ${texts.length}`)
if (withTexts) {
  for (const t of texts) console.log(`  y=${t.y.toFixed(1).padStart(6)}  x=${t.x.toFixed(1).padStart(6)}  h=${t.h}  «${t.t}»`)
} else {
  const rows = new Map()
  for (const t of texts) {
    const k = t.y.toFixed(0)
    if (!rows.has(k)) rows.set(k, [])
    rows.get(k).push(t.t)
  }
  for (const [y, arr] of [...rows.entries()].sort((a, b) => +a[0] - +b[0])) {
    console.log(`  y≈${y.padStart(4)}  ${arr.length} шт.  ${arr.slice(0, 10).join(' | ')}${arr.length > 10 ? ' …' : ''}`)
  }
}
