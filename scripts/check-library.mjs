/**
 * Проверка библиотеки модулей: выход за границы лицевой панели,
 * наложение приборов, наложение приборов и надписей.
 * Запуск: node scripts/check-library.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { countSignals, DEVICE_KINDS, EX, SIGNALS } from './channels.mjs'
import { KINDS } from './kinds.mjs'

/** Ёмкость модуля в объектах — из правила подбора: модуль → cap */
const CAP = new Map(Object.values(KINDS).map((k) => [k.module, k.cap]))

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'library')
const W = 540

const rect = (o) => ({ x1: o.x, y1: o.y, x2: o.x + o.w, y2: o.y + o.h })
const overlap = (a, b) => a.x1 < b.x2 - 0.01 && b.x1 < a.x2 - 0.01 && a.y1 < b.y2 - 0.01 && b.y1 < a.y2 - 0.01

let problems = 0
const blanks = [] // незаполненные поля каналов: печатаются справкой в конце
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
  const m = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
  const errs = []
  const H = m.slotHeight

  for (const d of m.devices) {
    const r = rect(d)
    // подпись под прибором занимает ещё ~5 мм
    const bottom = d.caption ? r.y2 + 5.5 : r.y2
    if (r.x1 < 0 || r.x2 > W || r.y1 < 0 || bottom > H) {
      errs.push(`прибор ${d.id} выходит за панель: x ${r.x1}…${r.x2}, y ${r.y1}…${bottom.toFixed(1)}`)
    }
  }
  for (let i = 0; i < m.devices.length; i++) {
    for (let j = i + 1; j < m.devices.length; j++) {
      const a = m.devices[i]
      const bDev = m.devices[j]
      // подсветка переключателя стоит внутри прибора-носителя — это не наложение
      if (a.builtIn === bDev.id || bDev.builtIn === a.id) continue
      if (overlap(rect(a), rect(bDev))) {
        errs.push(`приборы ${a.id} и ${bDev.id} накладываются`)
      }
    }
  }
  for (const l of m.labels) {
    const lr = { x1: l.x, y1: l.y, x2: l.x + l.w, y2: l.y + l.h }
    if (lr.x1 < -0.01 || lr.x2 > W + 0.01 || lr.y1 < 0 || lr.y2 > H) {
      errs.push(`надпись ${l.id} выходит за панель: x ${lr.x1}…${lr.x2}, y ${lr.y1}…${lr.y2.toFixed(1)}`)
    }
    for (const d of m.devices) {
      if (d.builtIn) continue
      if (overlap(lr, rect(d))) errs.push(`надпись ${l.id} накладывается на прибор ${d.id}`)
    }
  }

  const ids = m.devices.map((d) => d.id)
  if (new Set(ids).size !== ids.length) errs.push('дублируются номера приборов')
  const lids = m.labels.map((l) => l.id)
  if (new Set(lids).size !== lids.length) errs.push('дублируются идентификаторы надписей')

  // каналы подключения: заполнены не у всех панелей, но если заполнены — сверяем.
  // Источник данных — docs/каналы/<код>.md, разбор — scripts/channels.mjs
  const channels = m.channels ?? []
  const cids = channels.map((c) => c.id)
  if (new Set(cids).size !== cids.length) errs.push('дублируются обозначения каналов')
  const cap = CAP.get(m.code)
  for (const c of channels) {
    if (!DEVICE_KINDS.includes(c.kind)) errs.push(`канал ${c.id}: неизвестное устройство «${c.kind}»`)
    if (c.ex !== undefined && !EX.includes(c.ex)) errs.push(`канал ${c.id}: неизвестная взрывозащита «${c.ex}»`)
    if (c.object !== undefined) {
      if (!Number.isInteger(c.object) || c.object < 1) {
        errs.push(`канал ${c.id}: номер объекта «${c.object}» — нужно целое число от 1`)
      } else if (cap && c.object > cap) {
        // объекты модуля — те же, что в правиле подбора (kinds.mjs)
        errs.push(`канал ${c.id}: объект ${c.object}, а в модуле их ${cap}`)
      }
    }
    if (c.facade !== undefined && typeof c.facade !== 'boolean') {
      errs.push(`канал ${c.id}: «на фасаде» должно быть да или нет`)
    }
    for (const [sg, n] of Object.entries(c.signals ?? {})) {
      if (!SIGNALS.includes(sg)) errs.push(`канал ${c.id}: неизвестный тип сигнала «${sg}»`)
      if (!Number.isInteger(n) || n < 1) errs.push(`канал ${c.id}: число сигналов ${sg} «${n}» — нужно целое от 1`)
    }
    if (c.barrier && !c.barrier.name) errs.push(`канал ${c.id}: барьер без наименования`)
  }
  // пробелы в данных — не ошибка, но пусть будут видны: иначе о них забывают
  const gapCount = (test) => channels.filter(test).length
  const gaps = [
    ['артикул барьера', gapCount((c) => c.barrier && !c.barrier.article)],
    ['клеммы', gapCount((c) => !c.terminal)],
    ['вход ПЛК', gapCount((c) => !c.plc)],
    ['взрывозащита', gapCount((c) => c.ex === undefined)],
    ['сигналы', gapCount((c) => !c.signals)],
    ['объект', gapCount((c) => c.object === undefined)],
  ].filter(([, n]) => n)
  if (gaps.length) blanks.push(`[${m.code}] ${gaps.map(([w, n]) => `${w}: ${n}`).join(', ')}`)

  if (errs.length) {
    problems += errs.length
    console.log(`\n[${m.code}] ${m.name}`)
    for (const e of errs) console.log('   ! ' + e)
  } else {
    const sig = [...countSignals(channels)].map(([t, n]) => `${t} ${n}`).join(', ')
    const hidden = channels.filter((c) => c.facade === false).length
    const ch = channels.length
      ? `, каналов ${channels.length}${hidden ? ` (без фасада ${hidden})` : ''}${sig ? `, сигналов ${sig}` : ''}`
      : ''
    console.log(`[${m.code}] ${m.name} — ок (приборов ${m.devices.length}, надписей ${m.labels.length}${ch})`)
  }
}

if (blanks.length) {
  console.log('\nКаналы: не заполнено (данных в рабочей документации нет)')
  for (const b of blanks) console.log('   · ' + b)
}
console.log(problems ? `\nНайдено замечаний: ${problems}` : '\nЗамечаний нет.')
process.exit(problems ? 1 : 0)
