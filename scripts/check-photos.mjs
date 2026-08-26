/**
 * Сверка библиотеки модулей с папкой фотографий «Модули».
 * Папка фотографий — единственный источник состава и кодов панелей.
 *
 * Запуск: node scripts/check-photos.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODULES_DIR } from './data-root.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Папка фотографий и выгрузки EPLAN лежит на Synology, вне Git (AI/AI_COLLAB.md).
// Путь берётся из NT_ASUTP_DATA / AI/scripts/local.config (см. scripts/data-root.mjs).
const PHOTOS = MODULES_DIR
const LIB = join(ROOT, 'src', 'library')

if (!existsSync(PHOTOS)) {
  console.log(`Папка фотографий не найдена: ${PHOTOS}`)
  console.log(
    'Она на Synology (P:), в Git не ведётся. Задайте путь к бинарникам проекта в переменной\n' +
      'NT_ASUTP_DATA или в AI/scripts/local.config (см. scripts/data-root.mjs) — тогда сверка\n' +
      'библиотеки с фотографиями заработает. Проверка пропущена.',
  )
  process.exit(0)
}

const IMG = /\.(jpe?g|png|bmp|webp)$/i

/** Код и наименование из имени файла: «<код> <наименование>.jpg» */
function parseName(file) {
  const base = file.replace(IMG, '')
  const m = base.match(/^\s*([0-9]{1,2}(?:-[A-ZА-Я])?)\s+(.+?)\s*(\(\d+\))?$/)
  return m ? { code: m[1].padStart(2, '0'), name: m[2] } : null
}

const photos = new Map()
const badNames = []
for (const f of readdirSync(PHOTOS)) {
  if (!IMG.test(f)) continue
  const p = parseName(f)
  if (!p) {
    badNames.push(f)
    continue
  }
  if (!photos.has(p.code)) photos.set(p.code, [])
  photos.get(p.code).push({ file: f, name: p.name })
}

const lib = new Map()
for (const f of readdirSync(LIB)) {
  if (!f.endsWith('.json')) continue
  const m = JSON.parse(readFileSync(join(LIB, f), 'utf8'))
  lib.set(m.code, m)
}

const codes = [...new Set([...photos.keys(), ...lib.keys()])].sort()
let warn = 0

console.log('Код  Фото  Библиотека  Наименование')
console.log('-'.repeat(78))
for (const code of codes) {
  const ph = photos.get(code)
  const md = lib.get(code)
  const mark = ph && md ? '  ок ' : ph ? ' нет!' : ' —   '
  if (ph && !md) warn++
  console.log(
    `${code.padEnd(4)} ${(ph ? String(ph.length) : '-').padEnd(5)} ${mark.padEnd(11)} ` +
      (md ? md.name : ph[0].name),
  )
}

console.log()
// Количества в наименовании должны совпадать. Расходятся они там, где панель
// собрана по рабочей документации, а фотография подписана иначе, — такие случаи
// нужно разбирать вручную: возможно, это разные исполнения с разными кодами.
const qty = (s) => [...s.matchAll(/(\d+)\s*шт/gi)].map((m) => +m[1]).sort((a, b) => a - b).join('+')
const renamed = []
for (const code of codes) {
  const ph = photos.get(code)
  const md = lib.get(code)
  if (!ph || !md) continue
  const a = qty(ph[0].name)
  const bq = qty(md.name)
  if (a && bq && a !== bq) renamed.push({ code, photo: ph[0].name, lib: md.name })
}
if (renamed.length) {
  console.log('Количество приборов в имени фотографии и в библиотеке расходится:')
  for (const r of renamed) {
    console.log(`   ${r.code}  фото:       ${r.photo}`)
    console.log(`       библиотека: ${r.lib}`)
  }
  console.log()
}

const noPhoto = [...lib.keys()].filter((c) => !photos.has(c))
if (noPhoto.length) {
  console.log(`Панели в библиотеке без фотографии: ${noPhoto.join(', ')}`)
}
if (warn) {
  console.log(`Фотографии без панели в библиотеке: ${warn} — нужно дополнить scripts/gen-library.mjs`)
}
if (badNames.length) {
  console.log('Файлы с именем не по формату «<код> <наименование>.jpg»:')
  for (const f of badNames) console.log('   ' + f)
}
if (!warn && !badNames.length && !noPhoto.length && !renamed.length)
  console.log('Библиотека и папка фотографий совпадают.')
