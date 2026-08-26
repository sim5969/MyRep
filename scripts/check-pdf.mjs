/**
 * Сборка и проверка альбома PDF без браузера.
 *
 * Модули выгрузки написаны на TypeScript и берут библиотеку модулей через
 * import.meta.glob, поэтому загружаются загрузчиком Vite (ssrLoadModule) — тем
 * же, что и в приложении.
 *
 * Проверяется: структура файла и таблица ссылок, число листов, вложение шрифта,
 * карта ToUnicode и габарит содержимого каждого листа относительно рамки.
 *
 * Запуск: node scripts/check-pdf.mjs [--out=путь.pdf] [--sections=3]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, dflt) => {
  const a = process.argv.find((v) => v.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : dflt
}

const out = arg('out', join(tmpdir(), 'НТ53 фасад — проверка.pdf'))
const nSections = Number(arg('sections', '3'))

const { createServer } = await import('vite')
const server = await createServer({
  root: ROOT,
  logLevel: 'warn',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
})

let pdf
try {
  const { buildFacadePdf } = await server.ssrLoadModule('/src/export/pdf.ts')
  const { makeProject, makeSlot } = await server.ssrLoadModule('/src/lib/project.ts')
  const { MODULES } = await server.ssrLoadModule('/src/library/index.ts')

  const project = makeProject('Проверка выгрузки PDF', nSections)
  project.project.author = 'Иванов'
  project.project.checker = 'Петров'
  project.project.inspector = 'Сидоров'
  project.project.gip = 'Кузнецов'
  project.project.building = 'Операторная'
  const complex = project.complexes[0]
  // слоты 2…5 заполняем разными модулями библиотеки, чтобы лист был нагружен
  const codes = MODULES.filter((m) => m.allowedSlots.includes(2)).map((m) => m.code)
  complex.sections.forEach((sec, c) => {
    for (let n = 2; n <= 5; n++) sec.slots[n - 1] = makeSlot(n, codes[(c + n) % codes.length])
  })

  const font = new Uint8Array(readFileSync(join(ROOT, 'src/assets/isocpeur-italic.ttf')))
  const logo = new Uint8Array(readFileSync(join(ROOT, 'src/assets/logo-nt.png')))
  pdf = Buffer.from(await buildFacadePdf(project, complex, complex.sections, { font, logo }))
  writeFileSync(out, pdf)
  console.log(`Файл: ${out}`)
  console.log(
    `Размер: ${(pdf.length / 1024).toFixed(1)} КБ, шрифт ${(font.length / 1024).toFixed(1)} КБ,` +
      ` логотип ${(logo.length / 1024).toFixed(1)} КБ`,
  )
  console.log(`Секций: ${complex.sections.length}`)
} finally {
  await server.close()
}

const problems = []
const raw = pdf.toString('latin1')

if (!raw.startsWith('%PDF-1.')) problems.push('файл не начинается с %PDF')
if (!raw.trimEnd().endsWith('%%EOF')) problems.push('файл не заканчивается на %%EOF')

// --- таблица ссылок --------------------------------------------------------
const startxref = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(raw)
if (!startxref) problems.push('нет startxref')
else {
  const at = Number(startxref[1])
  if (!raw.startsWith('xref', at)) problems.push(`startxref указывает не на таблицу: смещение ${at}`)
  const table = raw.slice(at)
  const head = /^xref\s+0\s+(\d+)\s/.exec(table)
  const count = head ? Number(head[1]) : 0
  const rows = [...table.matchAll(/^(\d{10}) (\d{5}) ([nf]) $/gm)]
  if (rows.length !== count) problems.push(`в таблице ссылок ${rows.length} записей вместо ${count}`)
  rows.forEach((r, i) => {
    if (r[3] !== 'n') return
    const off = Number(r[1])
    if (!new RegExp(`^${i} 0 obj`).test(raw.slice(off, off + 24))) {
      problems.push(`объект ${i}: таблица ссылок указывает на «${raw.slice(off, off + 16).trim()}»`)
    }
  })
}

// --- объекты ---------------------------------------------------------------
const objects = new Map()
for (const m of raw.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)) objects.set(Number(m[1]), m[2])

const pagesObj = [...objects.values()].find((o) => o.includes('/Type /Pages'))
const declared = pagesObj ? Number(/\/Count (\d+)/.exec(pagesObj)?.[1]) : 0
const pageObjs = [...objects.values()].filter((o) => o.includes('/Type /Page ')).length
if (declared !== pageObjs) problems.push(`/Count ${declared} не совпадает с числом объектов страниц ${pageObjs}`)
// лист комплекса, лист фасада и лист надписей на каждую секцию
if (declared < 1 + nSections) problems.push(`листов ${declared}, ожидалось не меньше ${1 + nSections}`)

const desc = [...objects.values()].find((o) => o.includes('/FontDescriptor'))
if (!desc) problems.push('нет дескриптора шрифта')
const fontStream = [...objects.entries()].find(([, o]) => o.includes('/Length1'))
if (!fontStream) problems.push('шрифт не вложен (нет FontFile2)')

const cid = [...objects.values()].find((o) => o.includes('/CIDFontType2'))
const widths = cid ? [...cid.matchAll(/(\d+) \[(\d+)\]/g)].length : 0
if (!widths) problems.push('в шрифте нет массива ширин /W')

/** Содержимое потока объекта */
function streamOf(id) {
  const body = objects.get(id)
  const start = body.indexOf('stream\n') + 7
  const end = body.lastIndexOf('\nendstream')
  const bytes = pdf.subarray(raw.indexOf(body) + start, raw.indexOf(body) + end)
  return body.includes('/FlateDecode') ? inflateSync(bytes) : bytes
}

let mapped = 0
for (const [id, o] of objects) {
  if (!o.includes('/Length') || o.includes('/Length1') || o.includes('/Type /Page ')) continue
  const text = streamOf(id).toString('latin1')
  if (!text.includes('beginbfchar')) continue
  // считаем только записи внутри блоков beginbfchar: codespacerange не в счёт
  mapped = [...text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)].reduce(
    (n, m) => n + [...m[1].matchAll(/<[0-9A-F]{4}> <[0-9A-F]{4}>/g)].length,
    0,
  )
}
if (!mapped) problems.push('нет карты ToUnicode: текст не будет копироваться и искаться')
if (mapped && widths && mapped !== widths) problems.push(`ширин ${widths}, а в ToUnicode ${mapped} глифов`)

// --- габарит содержимого листов -------------------------------------------
// У каждой страницы два потока: первый — оформление листа (рамка со штампом,
// доходит до кромки), второй — чертёж, он должен оставаться внутри рамки.
const SHEET = { x1: 0, y1: 0, x2: 420, y2: 297 }
const FRAME = { x1: 20, y1: 5, x2: 415, y2: 292 }
let texts = 0
let sheets = 0
let images = 0

/** Габарит потока содержимого в миллиметрах листа */
function bboxOf(content) {
  const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const add = (x, y) => {
    bbox.minX = Math.min(bbox.minX, x)
    bbox.maxX = Math.max(bbox.maxX, x)
    bbox.minY = Math.min(bbox.minY, y)
    bbox.maxY = Math.max(bbox.maxY, y)
  }
  for (const line of content.split('\n')) {
    const num = line.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
    if (/ (m|l)$/.test(line)) add(num[0], num[1])
    else if (/ re S$/.test(line)) {
      add(num[0], num[1])
      add(num[0] + num[2], num[1] + num[3])
    } else if (/ c( S)?$/.test(line)) {
      for (let i = 0; i + 1 < num.length; i += 2) add(num[i], num[i + 1])
    } else if (/ cm \/\w+ Do Q$/.test(line)) {
      images++
      add(num[4], num[5])
      add(num[4] + num[0], num[5] + num[3])
    } else if (line.startsWith('BT ')) {
      texts++
      const td = / (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (Td|Tm) /.exec(line)
      if (td) add(Number(td[1]), Number(td[2]))
    }
  }
  return bbox
}

for (const [, o] of objects) {
  if (!o.includes('/Type /Page ')) continue
  sheets++
  const ids = [...(/\/Contents \[([^\]]*)\]/.exec(o)?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]))
  if (ids.length !== 2) problems.push(`лист ${sheets}: потоков содержимого ${ids.length}, ожидалось 2`)
  ids.forEach((id, k) => {
    const box = k === 0 ? SHEET : FRAME
    const what = k === 0 ? 'рамку листа' : 'чертёж'
    const bbox = bboxOf(streamOf(id).toString('latin1'))
    if (!Number.isFinite(bbox.minX)) return
    const tol = 0.5
    if (bbox.minX < box.x1 - tol || bbox.minY < box.y1 - tol || bbox.maxX > box.x2 + tol || bbox.maxY > box.y2 + tol) {
      problems.push(
        `лист ${sheets}, ${what}: содержимое выходит за границу — ` +
          `X ${bbox.minX.toFixed(1)}…${bbox.maxX.toFixed(1)}, Y ${bbox.minY.toFixed(1)}…${bbox.maxY.toFixed(1)}`,
      )
    }
  })
}

console.log(`Объектов: ${objects.size}, листов: ${declared}, надписей: ${texts}, растров: ${images}`)
console.log(`Глифов в шрифте документа: ${widths}, в карте ToUnicode: ${mapped}`)

if (problems.length) {
  console.log('\nЗамечания:')
  for (const p of problems) console.log('  ! ' + p)
  process.exit(1)
}
console.log('\nЗамечаний нет.')
