/**
 * Каналы подключения панелей: разбор `docs/каналы/<код>.md`.
 *
 * Канал — это точка, к которой снаружи подключается одно устройство: станция
 * с ПЧ, манометр, датчик, прибор. Это не сигнал ПЛК: сигналы внутри канала не
 * расписываются построчно, а считаются сводкой в столбце «Сигналы»
 * («2 AI, 4 DI, 4 DO»). Каналы, которые на лицевую панель не выводятся
 * (манометры, термосопротивления подшипников), помечаются «На фасаде: нет» —
 * они не дают шильдов, но занимают входы ПЛК.
 *
 * Заполняет инженер, по одному файлу на код панели, имя файла — только код:
 * `45.md`. Таблицу с данными парсер узнаёт по первому столбцу «Канал»; прочие
 * таблицы файла (состав модулей ПЛК, пояснения) не трогает. Столбцы читаются
 * по названию заголовка, а не по месту: лишние можно убрать, порядок любой,
 * незнакомые заголовки пропускаются с предупреждением. Пустая ячейка и прочерк
 * значат «данных нет».
 *
 * Формат полей — docs/Каналы подключения.md, тип `ChannelSpec` в src/types.ts.
 * Файлы читает генератор библиотеки (scripts/gen-library.mjs).
 *
 * Запуск для проверки разбора: node scripts/channels.mjs [код]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'каналы')

export const SIGNALS = ['AI', 'AO', 'DI', 'DO', 'RTD', 'TC', 'RS485', 'Ethernet']
export const EX = ['Exi', 'Exd', 'нет']
/** Закрытый список устройств — по нему собираются выгрузки. Тип `DeviceKind` */
export const DEVICE_KINDS = ['ПЧ', 'ЭКМ', 'датчик', 'прибор', 'задвижка', 'двигатель']

/** Прочерк любого вида и пустая ячейка — «данных нет» */
const DASHES = ['—', '–', '−', '-']
const isEmpty = (v) => v === '' || DASHES.includes(v)

const YES = ['да', 'есть', '+', 'true']
const NO = ['нет', 'net', '-', 'false']

/** Заголовок столбца (нижний регистр, без точки на конце) → поле записи */
const COLUMNS = {
  'канал': 'id',
  'устройство': 'kind',
  'тип устройства': 'kind',
  'что подключается': 'device',
  'наименование': 'device',
  'объект': 'object',
  'на фасаде': 'facade',
  'сигналы': 'signals',
  'ex': 'ex',
  'взрывозащита': 'ex',
  'барьер': 'barrierName',
  'артикул барьера': 'barrierArticle',
  'барьеров': 'barrierQty',
  'клеммы': 'terminal',
  'клемма': 'terminal',
  'вход плк': 'plc',
  'плк': 'plc',
  'назначение': 'purpose',
}

/** Порядок полей в записи канала — как в ChannelSpec */
const ORDER = ['id', 'kind', 'device', 'object', 'facade', 'signals', 'ex', 'barrier', 'terminal', 'plc', 'purpose']

const norm = (s) => s.trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ')

/** Ячейки строки таблицы. Экранированная черта остаётся в тексте ячейки */
const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim())

const isSeparator = (line) => line.includes('-') && /^\s*\|?[\s:|-]+\|?\s*$/.test(line)

/**
 * Разбор сводки сигналов: «2 AI, 4 DI, 4 DO» → { AI: 2, DI: 4, DO: 4 }.
 * Порядок в паре любой («AI 2» тоже читается), одиночный тип — одна цепь.
 */
export function parseSignals(text) {
  const out = {}
  for (const part of text.split(/[,;+]/)) {
    const t = part.trim()
    if (!t) continue
    const m = /^(?:(\d+)\s*([A-Za-z0-9]+)|([A-Za-z0-9]+)\s*(\d+)?)$/.exec(t)
    if (!m) return { error: `не разобрана запись «${t}»` }
    const sig = m[2] ?? m[3]
    const n = m[1] ?? m[4] ?? '1'
    const signal = SIGNALS.find((s) => s.toLowerCase() === sig.toLowerCase())
    if (!signal) return { error: `неизвестный тип сигнала «${sig}». Допустимо: ${SIGNALS.join(', ')}` }
    out[signal] = (out[signal] ?? 0) + Number(n)
  }
  return Object.keys(out).length ? { signals: out } : { error: 'пусто' }
}

/**
 * Разбор одного файла. Ошибки возвращаются с номером строки: сообщение должно
 * приводить прямо к месту в файле, а не к «где-то в панели 45».
 */
export function parseChannelFile(text, file = '') {
  // файл правят вручную, и редакторы Windows дописывают в начало BOM —
  // без этого заголовок «# Панель …» не распознаётся
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const errors = []
  const warnings = []
  const channels = []
  const err = (n, msg) => errors.push(`${file}:${n}: ${msg}`)

  let title = null
  let name = null
  for (const line of lines) {
    const m = /^#\s+(.+)$/.exec(line)
    if (!m) continue
    title = m[1].trim()
    const parts = title.split(/\s+[—–]\s+/)
    name = parts.length > 1 ? parts.slice(1).join(' — ').trim() : null
    break
  }

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('|') || !isSeparator(lines[i + 1] ?? '')) continue

    const head = cells(lines[i])
    const fields = head.map((h) => COLUMNS[norm(h)] ?? null)
    // таблица с данными узнаётся по первому столбцу; прочие таблицы файла —
    // пояснения для человека, парсер их не трогает
    if (fields[0] !== 'id') {
      i += 1
      continue
    }
    for (const [k, h] of head.entries()) {
      if (!fields[k]) warnings.push(`${file}:${i + 1}: столбец «${h}» не распознан и пропущен`)
    }

    let n = i + 2
    for (; n < lines.length && lines[n].trim().startsWith('|'); n++) {
      const row = cells(lines[n])
      if (row.every((c) => isEmpty(c))) continue
      const raw = {}
      for (const [k, f] of fields.entries()) if (f) raw[f] = row[k] ?? ''
      const line = n + 1
      const val = (f) => (raw[f] === undefined || isEmpty(raw[f]) ? undefined : raw[f])

      const c = {}
      c.id = val('id')
      if (!c.id) {
        err(line, 'не указано обозначение канала')
        continue
      }

      c.kind = val('kind')
      if (!c.kind) {
        err(line, 'не указано устройство')
        continue
      }
      if (!DEVICE_KINDS.includes(c.kind)) {
        err(line, `неизвестное устройство «${c.kind}». Допустимо: ${DEVICE_KINDS.join(', ')}`)
        continue
      }

      const obj = val('object')
      if (obj !== undefined) {
        const o = Number(obj)
        if (!Number.isInteger(o) || o < 1) {
          err(line, `номер объекта «${obj}» — нужно целое число от 1`)
          continue
        }
        c.object = o
      }

      const facade = val('facade')
      if (facade !== undefined) {
        const f = facade.toLowerCase()
        if (YES.includes(f)) c.facade = true
        else if (NO.includes(f)) c.facade = false
        else {
          err(line, `«на фасаде» — нужно «да» или «нет», а не «${facade}»`)
          continue
        }
      } else if (raw.facade !== undefined && DASHES.includes(raw.facade.trim())) {
        // прочерк в этом столбце читается как «нет»: канала на фасаде не видно
        c.facade = false
      }

      const signals = val('signals')
      if (signals !== undefined) {
        const parsed = parseSignals(signals)
        if (parsed.error) {
          err(line, `сигналы «${signals}»: ${parsed.error}`)
          continue
        }
        c.signals = parsed.signals
      }

      const ex = val('ex')
      if (ex !== undefined) {
        if (!EX.includes(ex)) {
          err(line, `неизвестная взрывозащита «${ex}». Допустимо: ${EX.join(', ')}`)
          continue
        }
        c.ex = ex
      }

      for (const f of ['device', 'terminal', 'plc', 'purpose']) {
        const v = val(f)
        if (v !== undefined) c[f] = v
      }

      const bName = val('barrierName')
      const bArticle = val('barrierArticle')
      const bQty = val('barrierQty')
      if (bName || bArticle) {
        if (!bName) {
          err(line, 'артикул барьера указан без наименования')
          continue
        }
        c.barrier = { name: bName }
        if (bArticle) c.barrier.article = bArticle
        if (bQty) {
          const q = Number(bQty.replace(',', '.'))
          if (!Number.isInteger(q) || q < 1) {
            err(line, `число барьеров «${bQty}» — нужно целое число от 1`)
            continue
          }
          c.barrier.qty = q
        }
      }

      // порядок полей — как в ChannelSpec, чтобы JSON библиотеки читался глазами
      const ordered = {}
      for (const f of ORDER) if (c[f] !== undefined) ordered[f] = c[f]
      channels.push({ ...ordered, line })
    }
    i = n - 1
  }

  if (!channels.length) errors.push(`${file}: нет ни одной таблицы с первым столбцом «Канал»`)

  const seen = new Map()
  for (const c of channels) {
    if (seen.has(c.id)) err(c.line, `обозначение «${c.id}» уже занято строкой ${seen.get(c.id)}`)
    else seen.set(c.id, c.line)
  }

  return { title, name, channels, errors, warnings }
}

/** Все файлы каталога: код панели → разбор файла */
export function loadChannelFiles() {
  const out = new Map()
  if (!existsSync(DIR)) return out
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.md')).sort()) {
    const code = f.slice(0, -3)
    const parsed = parseChannelFile(readFileSync(join(DIR, f), 'utf8'), f)
    // код панели: две цифры, у исполнения — три («45», «303», «345»)
    if (!/^[0-9]{2,3}$/.test(code)) {
      parsed.errors.push(`${f}: имя файла должно быть кодом панели, например «45.md»`)
    }
    out.set(code, { code, file: f, ...parsed })
  }
  return out
}

/** Каналы файла без служебного номера строки */
export function channelsOf(entry) {
  return { channels: entry.channels.map(({ line, ...c }) => c), errors: [...entry.errors], warnings: entry.warnings }
}

/** Число точек подключения */
export const channelCount = (channels) => (channels ?? []).length

/** Сумма сигналов ПЛК по типам: «AI: 8, DI: 24, DO: 16» */
export function countSignals(channels) {
  const out = new Map()
  for (const c of channels ?? []) {
    for (const [s, n] of Object.entries(c.signals ?? {})) out.set(s, (out.get(s) ?? 0) + n)
  }
  return out
}

// --- запуск из командной строки --------------------------------------------

if (process.argv[1] && basename(process.argv[1]) === 'channels.mjs') {
  const only = process.argv[2]
  const files = loadChannelFiles()
  if (!files.size) console.log(`Файлов каналов нет: ${DIR}`)
  let bad = 0
  for (const [code, e] of files) {
    if (only && code !== only) continue
    const sig = [...countSignals(e.channels)].map(([s, n]) => `${s}: ${n}`).join(', ')
    const hidden = e.channels.filter((c) => c.facade === false).length
    console.log(
      `\n[${code}] ${e.title ?? e.file} — каналов ${e.channels.length}` +
        (hidden ? ` (без вывода на фасад ${hidden})` : '') +
        (sig ? `, сигналов ПЛК ${sig}` : ''),
    )
    for (const w of e.warnings) console.log('   ? ' + w)
    for (const x of e.errors) {
      console.log('   ! ' + x)
      bad++
    }
  }
  console.log(bad ? `\nОшибок: ${bad}` : '\nОшибок нет.')
  process.exit(bad ? 1 : 0)
}
