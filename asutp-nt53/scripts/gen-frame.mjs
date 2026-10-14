/**
 * Перевод фирменной рамки ООО «НТ» из DXF в данные для выгрузки PDF.
 *
 * Источник — шаблон AI-пакета организации:
 *   P:\Шаблон AI-пакета ООО НТ\AI\templates\Рамка А3 с большим штампом (ГОСТ_A3_БШ).dxf
 * Это выгрузка EPLAN: вся геометрия лежит в блоке EPLFRAME, заполняемые графы —
 * определения атрибутов (ATTDEF) с тегами свойств EPLAN.
 *
 * Скрипт пишет:
 *   src/export/pdf/frame-a3.ts   линии, постоянные надписи, графы с их ячейками
 *   src/assets/logo-nt.png       логотип из AI/company, приведённый к RGB без альфы
 *
 * Запуск: node scripts/gen-frame.mjs ["путь к шаблону.dxf"] ["путь к логотипу.png"]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACK = 'P:/Шаблон AI-пакета ООО НТ/AI'
const dxfPath = process.argv[2] ?? `${PACK}/templates/Рамка А3 с большим штампом (ГОСТ_A3_БШ).dxf`
const logoPath = process.argv[3] ?? `${PACK}/company/ЛОГОТИП малый.png`

// ---------------------------------------------------------------------------
// Разбор DXF
// ---------------------------------------------------------------------------

const lines = readFileSync(dxfPath, 'utf8').split(/\r?\n/)

/** Начало секции по имени */
function section(name) {
  for (let i = 0; i < lines.length - 1; i += 2) {
    if (lines[i].trim() === '2' && lines[i + 1].trim() === name) return i + 2
  }
  throw new Error(`в шаблоне нет секции ${name}`)
}

/** Сущности секции: { t, g: { код: [значения] } } */
function entities(start) {
  const out = []
  let cur = null
  for (let i = start; i < lines.length - 1; i += 2) {
    const code = lines[i].trim()
    const value = lines[i + 1]
    if (code === '0') {
      if (cur) out.push(cur)
      if (value.trim() === 'ENDSEC') break
      cur = { t: value.trim(), g: {} }
      continue
    }
    if (!cur) continue
    ;(cur.g[code] ??= []).push(value.trim())
  }
  return out
}

const g = (e, code, dflt = '') => e.g[code]?.[0] ?? dflt
const num = (e, code, dflt = 0) => {
  const v = Number.parseFloat(g(e, code, ''))
  return Number.isFinite(v) ? v : dflt
}
const r3 = (v) => Math.round(v * 1000) / 1000

/** Толщина линии по слою, мм (код 370 в сотых долях миллиметра) */
const weights = new Map()
for (const e of entities(section('TABLES'))) {
  if (e.t !== 'LAYER') continue
  const w = Number.parseInt(g(e, '370', '25'), 10)
  weights.set(g(e, '2'), Number.isFinite(w) && w > 0 ? w / 100 : 0.25)
}
const lw = (layer) => weights.get(layer) ?? 0.25

const blockEnts = []
{
  let inFrame = false
  for (const e of entities(section('BLOCKS'))) {
    if (e.t === 'BLOCK') inFrame = g(e, '2') === 'EPLFRAME'
    else if (e.t === 'ENDBLK') inFrame = false
    else if (inFrame) blockEnts.push(e)
  }
}
if (!blockEnts.length) throw new Error('в шаблоне не найден блок EPLFRAME')

const insert = entities(section('ENTITIES')).find((e) => e.t === 'INSERT')
if (!insert || g(insert, '2') !== 'EPLFRAME') throw new Error('в шаблоне нет вставки блока EPLFRAME')
if (num(insert, '10') !== 0 || num(insert, '20') !== 0) throw new Error('вставка рамки смещена относительно начала координат')

const SHEET = { w: 420, h: 297 }
// точка привязки должна лежать на листе: за его пределами шаблон держит
// технологические пометки («ГОСТ_A3_БШ»), печатать их не нужно
const inside = (x, y) => x >= 0 && x <= SHEET.w && y >= 0 && y <= SHEET.h

// --- линии -----------------------------------------------------------------
const segments = []
for (const e of blockEnts) {
  if (e.t === 'LINE') {
    segments.push({ x1: num(e, '10'), y1: num(e, '20'), x2: num(e, '11'), y2: num(e, '21'), lw: lw(g(e, '8')) })
  } else if (e.t === 'LWPOLYLINE') {
    const xs = (e.g['10'] ?? []).map(Number)
    const ys = (e.g['20'] ?? []).map(Number)
    const closed = g(e, '70', '0') === '1'
    const w = lw(g(e, '8'))
    for (let i = 0; i + 1 < xs.length; i++) {
      segments.push({ x1: xs[i], y1: ys[i], x2: xs[i + 1], y2: ys[i + 1], lw: w })
    }
    if (closed && xs.length > 2) {
      segments.push({ x1: xs[xs.length - 1], y1: ys[ys.length - 1], x2: xs[0], y2: ys[0], lw: w })
    }
  }
}
// одинаковые отрезки в шаблоне встречаются дважды — оставляем один
const seen = new Set()
const unique = []
for (const s of segments) {
  const a = [r3(s.x1), r3(s.y1)]
  const b = [r3(s.x2), r3(s.y2)]
  const key = (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a]).flat().join(',') + `:${s.lw}`
  if (seen.has(key)) continue
  seen.add(key)
  unique.push({ x1: r3(s.x1), y1: r3(s.y1), x2: r3(s.x2), y2: r3(s.y2), lw: s.lw })
}

/** Прямоугольник по четырём отрезкам: ищем рамку листа и штамп */
function findRect(pred) {
  const xs = new Map()
  for (const s of unique) {
    if (Math.abs(s.x1 - s.x2) > 0.01 || Math.abs(s.y1 - s.y2) < 1) continue
    const key = r3(s.x1)
    const lo = Math.min(s.y1, s.y2)
    const hi = Math.max(s.y1, s.y2)
    const cur = xs.get(key) ?? []
    cur.push([lo, hi])
    xs.set(key, cur)
  }
  const cands = []
  for (const [x1, r1] of xs) {
    for (const [x2, r2] of xs) {
      if (x2 <= x1) continue
      for (const [lo1, hi1] of r1) {
        for (const [lo2, hi2] of r2) {
          if (Math.abs(lo1 - lo2) > 0.01 || Math.abs(hi1 - hi2) > 0.01) continue
          cands.push({ x: x1, y: lo1, w: r3(x2 - x1), h: r3(hi1 - lo1) })
        }
      }
    }
  }
  return cands.find(pred)
}

const FRAME = findRect((c) => c.x > 10 && c.x < 30 && c.w > 300 && c.h > 250)
const STAMP = findRect((c) => Math.abs(c.w - 185) < 1 && Math.abs(c.h - 55) < 1 && c.y < 10)
if (!FRAME || !STAMP) throw new Error('в шаблоне не распознаны рамка листа и основная надпись')

// --- надписи и графы -------------------------------------------------------
const ALIGN = { 0: 'left', 1: 'center', 2: 'right' }

/**
 * Точка привязки и базовая линия надписи DXF.
 * При выключке (код 72/73/74 ≠ 0) действует вторая точка (11, 21).
 */
function anchor(e, vCode) {
  const h = num(e, '40', 2.5)
  const hAlign = Number.parseInt(g(e, '72', '0'), 10)
  const vAlign = Number.parseInt(g(e, vCode, '0'), 10)
  const useAlt = (hAlign !== 0 || vAlign !== 0) && (num(e, '11') !== 0 || num(e, '21') !== 0)
  const x = useAlt ? num(e, '11') : num(e, '10')
  const y = useAlt ? num(e, '21') : num(e, '20')
  // приводим к базовой линии: 0 — базовая, 1 — низ, 2 — середина, 3 — верх
  const dy = vAlign === 2 ? -h / 2 : vAlign === 3 ? -h : 0
  const rot = Math.round(num(e, '50')) % 360
  return { x: r3(x), y: r3(y), cap: r3(h), align: ALIGN[hAlign] ?? 'left', rot, dy: r3(dy) }
}

const texts = []
for (const e of blockEnts) {
  if (e.t !== 'TEXT') continue
  const text = (e.g['1'] ?? []).join('').trim()
  if (!text) continue
  const a = anchor(e, '73')
  if (!inside(a.x, a.y)) continue // технологические пометки шаблона вне листа
  texts.push({ ...a, text })
}

/**
 * Ячейка графы: ближайшие линии сетки вокруг точки привязки.
 * Для повёрнутых на 90° граф роли осей меняются местами.
 */
function cellOf(x, y, rot) {
  const vert = unique.filter((s) => Math.abs(s.x1 - s.x2) < 0.01 && Math.abs(s.y1 - s.y2) > 0.5)
  const horz = unique.filter((s) => Math.abs(s.y1 - s.y2) < 0.01 && Math.abs(s.x1 - s.x2) > 0.5)
  const spanY = (s) => [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)]
  const spanX = (s) => [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)]
  const near = (v, list, get, pick) => {
    let best = null
    for (const s of list) {
      const c = get(s)
      if (pick === 'left' ? c > v + 0.01 : c < v - 0.01) continue
      if (best === null || (pick === 'left' ? c > best : c < best)) best = c
    }
    return best
  }
  if (rot === 90) {
    const cross = vert.filter((s) => {
      const [lo, hi] = spanY(s)
      return lo <= y + 0.01 && hi >= y - 0.01
    })
    const below = near(y, horz.filter((s) => { const [lo, hi] = spanX(s); return lo <= x + 0.01 && hi >= x - 0.01 }), (s) => s.y1, 'left')
    const above = near(y, horz.filter((s) => { const [lo, hi] = spanX(s); return lo <= x + 0.01 && hi >= x - 0.01 }), (s) => s.y1, 'right')
    const left = near(x, cross, (s) => s.x1, 'left')
    const right = near(x, cross, (s) => s.x1, 'right')
    return { w: below !== null && above !== null ? r3(above - below) : 0, h: left !== null && right !== null ? r3(right - left) : 0 }
  }
  const cross = horz.filter((s) => {
    const [lo, hi] = spanX(s)
    return lo <= x + 0.01 && hi >= x - 0.01
  })
  const vertAt = vert.filter((s) => {
    const [lo, hi] = spanY(s)
    return lo <= y + 0.01 && hi >= y - 0.01
  })
  const left = near(x, vertAt, (s) => s.x1, 'left')
  const right = near(x, vertAt, (s) => s.x1, 'right')
  const below = near(y, cross, (s) => s.y1, 'left')
  const above = near(y, cross, (s) => s.y1, 'right')
  return { w: left !== null && right !== null ? r3(right - left) : 0, h: below !== null && above !== null ? r3(above - below) : 0 }
}

const fields = {}
for (const e of blockEnts) {
  if (e.t !== 'ATTDEF') continue
  const tag = g(e, '2')
  const a = anchor(e, '74')
  if (!inside(a.x, a.y)) continue
  const cell = cellOf(a.x, a.y, a.rot)
  fields[tag] = { ...a, w: cell.w, h: cell.h }
}

// значения атрибутов вставки: постоянные метки зон листа переносим как надписи
for (const e of entities(section('ENTITIES'))) {
  if (e.t !== 'ATTRIB') continue
  const tag = g(e, '2')
  const value = (e.g['1'] ?? []).join('').trim()
  if (!/^53_190/.test(tag)) continue // 53_19005/19006 — номера и буквы зон листа
  const f = fields[tag]
  if (!f) continue
  if (value) texts.push({ x: f.x, y: f.y, cap: f.cap, align: f.align, rot: f.rot, dy: f.dy, text: value })
  delete fields[tag]
}

// --- логотип ---------------------------------------------------------------
const image = blockEnts.find((e) => e.t === 'IMAGE')
let logo = null
if (image) {
  // вектор u (11,21) — размер пикселя по X, вектор v (12,22) — по Y
  const px = num(image, '11')
  const py = num(image, '22')
  const w = num(image, '13') * px
  const h = num(image, '23') * py
  logo = { x: r3(num(image, '10')), y: r3(num(image, '20')), w: r3(w), h: r3(h) }
}

// ---------------------------------------------------------------------------
// Логотип: RGBA → RGB на белом, уменьшение до 256 точек, PNG без фильтров
// ---------------------------------------------------------------------------

function readPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('логотип не в формате PNG')
  let i = 8
  let ihdr = null
  const idat = []
  while (i < buf.length) {
    const len = buf.readUInt32BE(i)
    const type = buf.toString('latin1', i + 4, i + 8)
    const data = buf.subarray(i + 8, i + 8 + len)
    if (type === 'IHDR') {
      ihdr = {
        w: data.readUInt32BE(0),
        h: data.readUInt32BE(4),
        depth: data[8],
        color: data[9],
        interlace: data[12],
      }
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    i += 12 + len
  }
  if (!ihdr) throw new Error('в PNG нет IHDR')
  if (ihdr.depth !== 8 || ihdr.interlace !== 0 || ![2, 6].includes(ihdr.color)) {
    throw new Error(`поддерживается только PNG 8 бит RGB/RGBA без интерлейса, получено тип ${ihdr.color}`)
  }
  const ch = ihdr.color === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = ihdr.w * ch
  const out = Buffer.alloc(ihdr.h * stride)
  let p = 0
  for (let y = 0; y < ihdr.h; y++) {
    const filter = raw[p++]
    const row = raw.subarray(p, p + stride)
    p += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0
      const b = prev[x]
      const c = x >= ch ? prev[x - ch] : 0
      let v = row[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 0xff
    }
  }
  return { ...ihdr, ch, pixels: out }
}

/** RGB на белом фоне с уменьшением целым коэффициентом */
function toRgb(img, maxSide) {
  const step = Math.max(1, Math.ceil(Math.max(img.w, img.h) / maxSide))
  const w = Math.floor(img.w / step)
  const h = Math.floor(img.h / step)
  const out = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0]
      let n = 0
      for (let dy = 0; dy < step; dy++) {
        for (let dx = 0; dx < step; dx++) {
          const sx = x * step + dx
          const sy = y * step + dy
          const at = (sy * img.w + sx) * img.ch
          const alpha = img.ch === 4 ? img.pixels[at + 3] / 255 : 1
          for (let k = 0; k < 3; k++) acc[k] += img.pixels[at + k] * alpha + 255 * (1 - alpha)
          n++
        }
      }
      const at = (y * w + x) * 3
      for (let k = 0; k < 3; k++) out[at + k] = Math.round(acc[k] / n)
    }
  }
  return { w, h, data: out }
}

const CRC = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return (buf) => {
    let c = -1
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
})()

function writePng({ w, h, data }) {
  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12)
    out.writeUInt32BE(body.length, 0)
    out.write(type, 4, 'latin1')
    body.copy(out, 8)
    out.writeUInt32BE(CRC(out.subarray(4, 8 + body.length)), 8 + body.length)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2 // RGB
  // строки без фильтрации: поток годится для прямого вложения в PDF
  const rows = Buffer.alloc(h * (1 + w * 3))
  for (let y = 0; y < h; y++) {
    rows[y * (1 + w * 3)] = 0
    data.copy(rows, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const logoRgb = toRgb(readPng(readFileSync(logoPath)), 256)
writeFileSync(`${ROOT}/src/assets/logo-nt.png`, writePng(logoRgb))

// ---------------------------------------------------------------------------
// Запись модуля данных
// ---------------------------------------------------------------------------

const j = (v) => JSON.stringify(v)
const textLine = (t) =>
  `  { x: ${t.x}, y: ${r3(t.y + t.dy)}, cap: ${t.cap}, align: ${j(t.align)}${t.rot ? `, rot: ${t.rot}` : ''}, text: ${j(t.text)} },`
const fieldLine = ([tag, f]) =>
  `  ${j(tag)}: { x: ${f.x}, y: ${r3(f.y + f.dy)}, cap: ${f.cap}, align: ${j(f.align)}${f.rot ? `, rot: ${f.rot}` : ''}, w: ${f.w}, h: ${f.h} },`

const out = `/**
 * Фирменная рамка А3 с большим штампом. Файл создан скриптом scripts/gen-frame.mjs
 * из шаблона AI-пакета ООО «НТ» — вручную не править.
 *
 * Источник: ${dxfPath.replace(/\\/g, '/')}
 * Единицы — миллиметры, начало координат — левый нижний угол листа.
 * Надписи заданы базовой линией и высотой прописной буквы, как в DXF.
 */

export interface FrameLine {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Толщина линии по слою шаблона, мм */
  lw: number
}

export interface FrameText {
  x: number
  /** Базовая линия */
  y: number
  /** Высота прописной буквы */
  cap: number
  align: 'left' | 'center' | 'right'
  /** Поворот, градусы (0 или 90) */
  rot?: number
  text: string
}

/** Заполняемая графа: точка привязки и размеры ячейки сетки */
export interface FrameField extends Omit<FrameText, 'text'> {
  w: number
  h: number
}

export const SHEET = { w: ${SHEET.w}, h: ${SHEET.h} } as const
/** Рамка листа */
export const FRAME = { x: ${FRAME.x}, y: ${FRAME.y}, w: ${FRAME.w}, h: ${FRAME.h} } as const
/** Основная надпись */
export const STAMP = { x: ${STAMP.x}, y: ${STAMP.y}, w: ${STAMP.w}, h: ${STAMP.h} } as const
/** Логотип организации: место в рамке под растр из src/assets/logo-nt.png */
export const LOGO = ${logo ? `{ x: ${logo.x}, y: ${logo.y}, w: ${logo.w}, h: ${logo.h} } as const` : 'null'}
/** Размер растра логотипа в точках: нужен, чтобы вписать его без искажения */
export const LOGO_PX = { w: ${logoRgb.w}, h: ${logoRgb.h} } as const

export const LINES: FrameLine[] = [
${unique.map((s) => `  { x1: ${s.x1}, y1: ${s.y1}, x2: ${s.x2}, y2: ${s.y2}, lw: ${s.lw} },`).join('\n')}
]

export const TEXTS: FrameText[] = [
${texts.map(textLine).join('\n')}
]

/** Графы штампа по тегам свойств EPLAN */
export const FIELDS: Record<string, FrameField> = {
${Object.entries(fields).map(fieldLine).join('\n')}
}
`

writeFileSync(`${ROOT}/src/export/pdf/frame-a3.ts`, out)

console.log(`Шаблон: ${dxfPath}`)
console.log(`Лист ${SHEET.w} × ${SHEET.h}, рамка ${FRAME.w} × ${FRAME.h} от (${FRAME.x}, ${FRAME.y}), штамп ${STAMP.w} × ${STAMP.h} от (${STAMP.x}, ${STAMP.y})`)
console.log(`Линий: ${unique.length}, надписей: ${texts.length}, граф: ${Object.keys(fields).length}`)
console.log(`Логотип: ${logo ? `${logo.w} × ${logo.h} мм от (${logo.x}, ${logo.y}), растр ${logoRgb.w} × ${logoRgb.h}` : 'нет'}`)
console.log('Записаны src/export/pdf/frame-a3.ts и src/assets/logo-nt.png')
