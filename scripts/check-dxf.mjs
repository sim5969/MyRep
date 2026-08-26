/**
 * Проверка выгруженного DXF: структура секций, объявление слоёв,
 * корректность координат, экранирование кириллицы, габарит чертежа.
 *
 * Запуск: node scripts/check-dxf.mjs "путь/к/файлу.dxf"
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Где искать файлы: рабочий каталог, корень проекта, папка загрузок */
const SEARCH_DIRS = [process.cwd(), ROOT, join(homedir(), 'Downloads'), join(homedir(), 'Загрузки')].filter(
  (d) => existsSync(d),
)

/** Самый свежий .dxf в перечисленных каталогах */
function newestDxf() {
  const found = []
  for (const dir of SEARCH_DIRS) {
    for (const f of readdirSync(dir)) {
      if (!/\.dxf$/i.test(f)) continue
      const p = join(dir, f)
      try {
        found.push({ p, mtime: statSync(p).mtimeMs })
      } catch {
        /* недоступный файл пропускаем */
      }
    }
  }
  found.sort((a, b) => b.mtime - a.mtime)
  return found[0]?.p
}

/** Разрешить путь: как указан, затем относительно корня проекта и папки загрузок */
function resolveInput(arg) {
  if (isAbsolute(arg)) return existsSync(arg) ? arg : undefined
  for (const dir of SEARCH_DIRS) {
    const p = join(dir, arg)
    if (existsSync(p)) return p
  }
  // указали «scripts/check-dxf.mjs» вместо файла чертежа — подскажем ниже
  return undefined
}

const arg = process.argv[2]
let file
if (arg) {
  file = resolveInput(arg)
  if (!file) {
    console.error(`Файл не найден: ${arg}`)
    console.error('Искал в: ' + SEARCH_DIRS.join(', '))
    const guess = newestDxf()
    if (guess) console.error(`\nСамый свежий найденный чертёж: ${guess}\nЗапустите без аргумента, чтобы проверить его.`)
    process.exit(2)
  }
} else {
  file = newestDxf()
  if (!file) {
    console.error('Файлы .dxf не найдены. Искал в: ' + SEARCH_DIRS.join(', '))
    console.error('Укажите файл: node scripts/check-dxf.mjs "путь/к/файлу.dxf"')
    process.exit(2)
  }
  console.log(`Файл не указан, проверяю самый свежий: ${basename(file)}`)
}

const raw = readFileSync(file, 'utf8')
const lines = raw.split(/\r?\n/)
while (lines.length && lines[lines.length - 1] === '') lines.pop()

const problems = []
const notes = []
if (lines.length % 2 !== 0) problems.push('нечётное число строк: нарушены пары код/значение')

const pairs = []
for (let i = 0; i < lines.length - 1; i += 2) pairs.push([lines[i].trim(), lines[i + 1]])

// Разбор с учётом текущей секции: заголовок содержит служебные переменные,
// их нельзя путать с геометрией и слоями чертежа.
let section = null
let entity = null
let layerNamed = false
const declared = new Set()
const used = new Set()
const counts = {}
const texts = []
let badNum = 0
const bbox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }

for (let i = 0; i < pairs.length; i++) {
  const [code, value] = pairs[i]

  if (code === '0') {
    entity = value
    layerNamed = false
    if (value === 'SECTION') {
      section = pairs[i + 1] && pairs[i + 1][0] === '2' ? pairs[i + 1][1] : null
    } else if (value === 'ENDSEC') {
      section = null
    } else if (section === 'ENTITIES') {
      counts[value] = (counts[value] ?? 0) + 1
    } else {
      counts[value] = (counts[value] ?? 0) + 1
    }
    continue
  }

  if (section === 'TABLES' && entity === 'LAYER' && code === '2' && !layerNamed) {
    declared.add(value)
    layerNamed = true
    continue
  }

  if (section !== 'ENTITIES') continue

  if (code === '8') used.add(value)
  if (code === '1') texts.push(value)
  if (['10', '11', '20', '21', '40'].includes(code)) {
    const n = Number.parseFloat(value)
    if (!Number.isFinite(n)) {
      badNum++
      continue
    }
    if (code === '10' || code === '11') {
      bbox.minX = Math.min(bbox.minX, n)
      bbox.maxX = Math.max(bbox.maxX, n)
    }
    if (code === '20' || code === '21') {
      bbox.minY = Math.min(bbox.minY, n)
      bbox.maxY = Math.max(bbox.maxY, n)
    }
  }
}

const seq = pairs.filter((p) => p[0] === '0').map((p) => p[1])
if ((counts.SECTION ?? 0) !== (counts.ENDSEC ?? 0)) {
  problems.push(`SECTION ${counts.SECTION ?? 0} != ENDSEC ${counts.ENDSEC ?? 0}`)
}
if (seq[seq.length - 1] !== 'EOF') problems.push('файл не заканчивается на EOF')
if (!declared.size) problems.push('в таблице TABLES не найдено ни одного слоя')

for (const u of used) {
  // слой «0» существует всегда, даже без записи в таблице
  if (u !== '0' && !declared.has(u)) problems.push(`слой не объявлен в таблице: ${u}`)
}
if (badNum) problems.push(`нечисловых координат: ${badNum}`)

// Файл в однобайтовой кодовой странице читается с символами замены
const broken = (raw.match(/\uFFFD/g) ?? []).length
if (broken) {
  notes.push(`файл не в UTF-8: ${broken} нечитаемых символов — вероятно, кодовая страница Windows-1251`)
}

const rawCyr = texts.filter((v) => /[А-Яа-яЁё]/.test(v))
if (rawCyr.length && !broken) {
  problems.push(`кириллица не экранирована в ${rawCyr.length} текстах, например: ${rawCyr[0]}`)
}
const emptyText = texts.filter((v) => v === '').length
if (emptyText) problems.push(`пустых текстов: ${emptyText}`)

const ENT = ['LINE', 'CIRCLE', 'ARC', 'TEXT', 'MTEXT', 'POLYLINE', 'LWPOLYLINE', 'INSERT', 'SOLID']
console.log(`Файл: ${file}`)
console.log(`Пар код/значение: ${pairs.length}`)
console.log(
  'Сущности: ' +
    ENT.filter((k) => counts[k])
      .map((k) => `${k} ${counts[k]}`)
      .join(', '),
)
const layerList = [...declared]
console.log(
  `Слои (${declared.size}): ` +
    layerList.slice(0, 12).join(', ') +
    (layerList.length > 12 ? ` … и ещё ${layerList.length - 12}` : ''),
)
if (Number.isFinite(bbox.minX)) {
  console.log(
    `Габарит: X ${bbox.minX}…${bbox.maxX} мм, Y ${bbox.minY}…${bbox.maxY} мм ` +
      `(${Math.round(bbox.maxX - bbox.minX)} × ${Math.round(bbox.maxY - bbox.minY)})`,
  )
} else {
  problems.push('в секции ENTITIES нет координат')
}
console.log(`Текстов: ${texts.length}`)

for (const n of notes) console.log('  * ' + n)

if (problems.length) {
  console.log('\nЗамечания:')
  for (const p of problems) console.log('  ! ' + p)
  process.exit(1)
}
console.log('\nЗамечаний нет.')
