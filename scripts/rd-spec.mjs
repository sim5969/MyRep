/**
 * Разбор групповой спецификации изделий (лист «СО») из выгрузки EPLAN в DXF.
 *
 * Колонки определяются по строке заголовка «№ | Артикул | Наименование | Ед. |
 * Кол. | Прим.», строки — группировкой надписей по координате Y.
 *
 * Запуск: node scripts/rd-spec.mjs "<файл1.dxf>" ["<файл2.dxf>" …]
 * Несколько файлов одного комплекта выводятся одной таблицей.
 */
import { readFileSync } from 'node:fs'

const files = process.argv.slice(2)
if (!files.length) {
  console.error('Укажите листы спецификации: node scripts/rd-spec.mjs "<файл.dxf>" …')
  process.exit(1)
}

const clean = (s) =>
  s
    .replace(/\\P/g, ' ')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Надписи листа: {x, y, text, layer} */
function texts(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  let i = 0
  while (i < lines.length - 1 && !(lines[i].trim() === '2' && lines[i + 1].trim() === 'ENTITIES')) i += 2
  const out = []
  let cur = null
  const flush = () => {
    if (cur && cur.t) {
      const t = clean(cur.t)
      if (t) out.push({ x: cur.x, y: cur.y, text: t, layer: cur.layer })
    }
    cur = null
  }
  for (; i < lines.length - 1; i += 2) {
    const code = lines[i].trim()
    const val = lines[i + 1].trim()
    if (code === '0') {
      flush()
      if (val === 'ENDSEC') break
      if (val === 'TEXT' || val === 'MTEXT' || val === 'ATTRIB') cur = { t: '', x: 0, y: 0, layer: '' }
      continue
    }
    if (!cur) continue
    if (code === '1' || code === '3') cur.t += val
    else if (code === '10') cur.x = +val
    else if (code === '20') cur.y = +val
    else if (code === '8') cur.layer = val
  }
  flush()
  return out
}

/**
 * Границы колонок в миллиметрах листа. Значения относятся к шаблону
 * «Групповая спецификация изделий» EPLAN, по которому выполнены все выгрузки
 * этого проекта: заголовки отцентрованы по колонке, а текст выровнен влево,
 * поэтому по заголовкам границы восстановить нельзя.
 * Переопределяются ключом --cols=28,55,155,170,182
 */
const DEFAULT_CUTS = [28, 55, 155, 170, 182]
const NAMES = ['№', 'Артикул', 'Наименование', 'Ед', 'Кол', 'Прим']

const cutsArg = process.argv.find((a) => a.startsWith('--cols='))
const CUTS = cutsArg ? cutsArg.slice(7).split(',').map(Number) : DEFAULT_CUTS

const columnOf = (x) => NAMES[CUTS.findIndex((c) => x < c) === -1 ? NAMES.length - 1 : CUTS.findIndex((c) => x < c)]

/** Y строки заголовка: ниже неё идёт тело таблицы */
function headerY(all) {
  const head = all.filter((t) => /^(Артикул|Наименование)$/.test(t.text)).sort((a, b) => b.y - a.y)
  return head.length ? head[0].y : Infinity
}

const rows = []
for (const file of files) {
  const all = texts(file)
  const hy = headerY(all)
  if (!Number.isFinite(hy)) {
    console.error(`${file}: строка заголовка не найдена, лист пропущен`)
    continue
  }
  // EPLAN450 — тело таблицы; EPLAN451…453 это рамка, зоны и штамп, они не нужны
  const body = all.filter((t) => /^EPLAN(400|450)$/.test(t.layer) && t.y < hy - 3)
  // группировка по строкам: якорь — номер позиции в первой колонке
  const numbers = body.filter((t) => t.x < CUTS[0] && /^\d{1,3}$/.test(t.text)).sort((a, b) => b.y - a.y)
  for (let k = 0; k < numbers.length; k++) {
    const yTop = numbers[k].y + 4
    const yBot = k + 1 < numbers.length ? numbers[k + 1].y + 4 : -Infinity
    const cells = {}
    for (const t of body) {
      if (t.y >= yTop || t.y < yBot) continue
      const col = columnOf(t.x)
      cells[col] = cells[col] ? `${cells[col]} ${t.text}` : t.text
    }
    rows.push({ n: +numbers[k].text, ...cells })
  }
}

// пустые строки (перенос таблицы на следующий лист) отбрасываем
const filled = rows.filter((r) => r['Артикул'] || r['Наименование'])
filled.sort((a, b) => a.n - b.n)
const pad = (s, n) => String(s ?? '').padEnd(n)
console.log(
  `${pad('№', 4)}${pad('Артикул', 24)}${pad('Наименование', 62)}${pad('Ед', 5)}${pad('Кол', 7)}Прим.`,
)
console.log('-'.repeat(130))
for (const r of filled) {
  console.log(
    pad(r['№'] ?? r.n, 4) +
      pad(r['Артикул'], 24) +
      pad(r['Наименование'], 62) +
      pad(r['Ед'], 5) +
      pad(r['Кол'], 7) +
      (r['Прим'] ?? ''),
  )
}
console.log(`\nПозиций: ${rows.length}`)
