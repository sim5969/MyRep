/**
 * Справочная книга «Модули НТ53.xlsx» — сводка библиотеки для тех, кто не
 * открывает конфигуратор и JSON: модули с видом фасада, правило подбора,
 * надписи, каналы подключения, панель слота 1 и перечень плагинов Claude Code.
 *
 * Источник истины — библиотека `src/library/*.json`, правило подбора
 * `scripts/kinds.mjs` и маркетплейс `nt-tools`; книга собирается заново целиком,
 * руками в ней ничего не правится. Фасады рисует тот же компонент ModuleView,
 * что и каталог приложения (SVG → PNG через resvg).
 *
 * Запуск:
 *   npm run gen:xlsx                      → <DATA_ROOT>/Модули НТ53.xlsx
 *   npm run gen:xlsx -- --out=книга.xlsx --plugins="C:\NT\nt-tools"
 *
 * Перед запуском закрыть книгу в Excel: открытый файл на P: не перезаписывается.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Resvg } from '@resvg/resvg-js'
import ExcelJS from 'exceljs'
import { arg, withApp } from './app-modules.mjs'
import { DATA_ROOT } from './data-root.mjs'
import { ALIASES, KINDS, SLOT1 } from './kinds.mjs'
import { channelGroups, labelGroups } from './library-rows.mjs'

const out = arg('out', join(DATA_ROOT, 'Модули НТ53.xlsx'))
const pluginsDir = arg('plugins', 'P:\\Projects\\_Tools\\claude-plugins')

/**
 * Описание модуля для листа «Модули» — прозой, для чтения. В библиотеке такого
 * поля нет (решение по панели 104), поэтому живёт здесь. Нет описания —
 * в книгу идёт наименование, а в консоль предупреждение.
 */
const DESCRIPTIONS = {
  '00': 'Панель-заглушка для резервирования свободного места в слоте. Приборов нет.',
  '01':
    'Неизменяемая панель верхнего уровня секции: 8 ламп-светоиндикаторов (L2…L9) и 8 цифровых индикаторов (H11…H24). Меняются только надписи.',
  '02':
    'Аналоговые параметры на 8 цифровых индикаторов: давление, уровень, расход, температура — что по ТЗ идёт «на щит диспетчерской».',
  '03':
    'Регулирующая арматура: 4 клапана/задвижки с указателем положения и заданием 4…20 мА (позиции КР, ЗР, ЭМК).',
  '303':
    'Регулирующая арматура: 3 клапана/задвижки с указателем положения и заданием 4…20 мА. Исполнение панели 03 на три привода, блоки по 180 мм. Описана по фотографии, РД нет; каналы — по аналогии с панелью 03.',
  '04': 'Управление 4 двигателями (насосами) с прямым пуском, без частотного преобразователя.',
  '104':
    'Управление 3 двигателями (насосами) с прямым пуском, без частотного преобразователя. На фасаде щитовой стрелочный амперметр на каждый привод. Описана по фотографии, РД нет.',
  '304':
    'Управление 3 двигателями (насосами) с прямым пуском, без частотного преобразователя. Исполнение панели 04 на три привода: блок панели 04 без изменений, три блока с шагом 180 мм, как в 345. Своей фотографии и РД нет; каналы — по аналогии с панелью 04.',
  '05': '4 прибора ГАММА-8М — 8 точек/каналов измерения уровня (взлив, межфазный уровень). Каналы независимы.',
  '305':
    '3 прибора ГАММА-8М — 6 точек/каналов измерения уровня. Исполнение панели 05 на три прибора — то, что вычерчено в выгрузке EPLAN +05; геометрия и каналы из РД.',
  '15': '8 электрозадвижек запорных (открыть/закрыть/стоп) без индикации положения. Взрывозащита Exd.',
  '41':
    'Контроль загазованности (H2S, CH4): блок питания и сигнализации БПС-21М-М с модулем МОП и перечень каналов на 30 строк — по одной редактируемой строке на точку контроля. Описана по фотографии, РД нет; артикул и каналы подключения не заданы.',
  '45': 'Управление 4 двигателями (насосами) с частотными преобразователями ABB.',
  '345':
    'Управление 3 двигателями (насосами) с частотными преобразователями ABB. Исполнение панели 45 на три станции: блок ПЧ по РД панели 45, три блока с шагом 180 мм, как в 303. Своей выгрузки и фотографии нет; каналы — по аналогии с панелью 45.',
  '48': 'Измерительно-вычислительный комплекс «Зодиак», 2 прибора.',
  '49': 'Блок программного управления, 1 прибор.',
  '65': 'Смешанный модуль: 2 частотных преобразователя (позиции 1, 2) + 2 электрозадвижки (позиции 3, 4).',
}

/** Ширина картинки фасада в книге, пикселей; высота — по пропорции панели 540 × H */
const IMG_W = 340
const DEVICE_RU = { lamp: 'лампа', indicator: 'индикатор', switch: 'переключатель', opPanel: 'панель оператора', meter: 'амперметр', device: 'прибор' }

// --- оформление -------------------------------------------------------------
const FONT = 'Arial'
const thin = { style: 'thin', color: { argb: 'FF8C8C8C' } }
const BORDER = { top: thin, left: thin, bottom: thin, right: thin }
const HEADER = {
  font: { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } },
  alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
  border: BORDER,
}
const KEY = { font: { name: FONT, size: 11, bold: true }, alignment: { vertical: 'middle', horizontal: 'center', wrapText: true }, border: BORDER }
const CENTER = { font: { name: FONT, size: 10 }, alignment: { vertical: 'middle', horizontal: 'center', wrapText: true }, border: BORDER }
const TEXT = { font: { name: FONT, size: 10 }, alignment: { vertical: 'top', wrapText: true }, border: BORDER }
const NOTE = { font: { name: FONT, size: 9, italic: true, color: { argb: 'FF444444' } }, alignment: { vertical: 'top', wrapText: true } }

/**
 * Лист с шапкой, фильтром и закреплённой первой строкой.
 * columns: [{ header, width, style }]; rows — массивы значений;
 * note — текст, объединённый по ширине таблицы под ней.
 */
function sheet(wb, title, columns, rows, { note, headerHeight = 30, rowHeight } = {}) {
  const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = columns.map((c) => ({ width: c.width }))
  const h = ws.addRow(columns.map((c) => c.header))
  h.height = headerHeight
  h.eachCell((cell) => Object.assign(cell, HEADER))
  for (const r of rows) {
    const row = ws.addRow(r)
    if (rowHeight) row.height = rowHeight
    row.eachCell({ includeEmpty: true }, (cell, i) => Object.assign(cell, columns[i - 1].style ?? TEXT))
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } }
  if (note) {
    const n = ws.addRow([note])
    n.height = Math.max(44, 14 * Math.ceil(note.length / 110))
    ws.mergeCells(n.number, 1, n.number, columns.length)
    Object.assign(n.getCell(1), NOTE)
  }
  return ws
}

/** Фасад модуля в PNG: тот же ModuleView, что и в каталоге приложения */
function facadePng(ModuleView, m) {
  const inner = renderToStaticMarkup(createElement(ModuleView, { code: m.code }))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 ${m.slotHeight}" ` +
    `font-family="${FONT}" style="background:#fff">${inner}</svg>`
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: IMG_W },
    font: { loadSystemFonts: true, defaultFontFamily: FONT },
    background: '#ffffff',
  }).render()
  return { buffer: png.asPng(), width: png.width, height: png.height }
}

/** Лист «Плагины» по marketplace.json и папкам плагинов */
function pluginRows(dir) {
  const manifest = join(dir, '.claude-plugin', 'marketplace.json')
  if (!existsSync(manifest)) {
    console.warn(`Лист «Плагины» пропущен: нет ${manifest}`)
    return null
  }
  const mp = JSON.parse(readFileSync(manifest, 'utf8'))
  const names = (sub, label) => {
    if (!existsSync(sub)) return []
    return readdirSync(sub).map((f) => `${label} ${f.replace(/\.md$/, '')}`)
  }
  const rows = mp.plugins.map((p) => {
    const root = join(dir, p.source)
    const parts = [
      ...names(join(root, 'skills'), 'навык'),
      ...names(join(root, 'commands'), 'команда /'),
      ...names(join(root, 'agents'), 'агент'),
    ].map((s) => s.replace('команда / ', 'команда /'))
    return [p.name, p.version, p.description, parts.join('\n'), (p.keywords ?? []).join(', '), `claude plugin install ${p.name}@${mp.name}`]
  })
  return { name: mp.name, rows }
}

await withApp(async (load) => {
  const { MODULES } = await load('/src/library/index.ts')
  const { ModuleView } = await load('/src/components/ModuleView.tsx')
  const kindOf = new Map(Object.entries(KINDS).map(([k, v]) => [v.module, k]))
  const kindName = (code) => kindOf.get(code) ?? (code === '01' ? 'панель слота 1' : '—')

  const wb = new ExcelJS.Workbook()
  wb.creator = 'asutp-nt53 / scripts/gen-xlsx.mjs'
  wb.created = new Date()

  // --- Модули ---------------------------------------------------------------
  const modRows = MODULES.map((m) => {
    if (!DESCRIPTIONS[m.code]) console.warn(`  ! нет описания для панели ${m.code} — добавить в DESCRIPTIONS`)
    return [m.code, m.name, DESCRIPTIONS[m.code] ?? m.name, m.labels.filter((l) => l.editable).length, kindName(m.code), '']
  })
  const wsMod = sheet(
    wb,
    'Модули',
    [
      { header: 'Код', width: 7, style: KEY },
      { header: 'Наименование', width: 32 },
      { header: 'Описание', width: 50 },
      { header: 'Редактируемых', width: 14, style: CENTER },
      { header: 'Тип объекта', width: 16, style: CENTER },
      { header: 'Внешний вид', width: 49.6 },
    ],
    modRows,
  )
  MODULES.forEach((m, i) => {
    const img = facadePng(ModuleView, m)
    const id = wb.addImage({ buffer: img.buffer, extension: 'png' })
    const row = i + 2
    wsMod.getRow(row).height = img.height * 0.75 + 6
    wsMod.addImage(id, { tl: { col: 5, row: row - 1 }, ext: { width: img.width, height: img.height }, editAs: 'oneCell' })
  })
  // фильтр — без столбца с картинками (openpyxl рисунки exceljs не читает, Excel показывает)
  wsMod.autoFilter = { from: { row: 1, column: 1 }, to: { row: MODULES.length + 1, column: 5 } }

  // --- Тип → модуль ---------------------------------------------------------
  const byKind = new Map()
  for (const [a, k] of Object.entries(ALIASES)) byKind.set(k, [...(byKind.get(k) ?? []), a])
  const synonyms = [...byKind].map(([k, as]) => `${as.join('/')}→${k}`).join(', ')
  sheet(
    wb,
    'Тип → модуль',
    [
      { header: 'Тип в задании', width: 16 },
      { header: 'Модуль', width: 9.2, style: KEY },
      { header: 'Объектов в модуле', width: 20, style: CENTER },
      { header: 'Что это', width: 62 },
    ],
    Object.entries(KINDS).map(([k, s]) => [k, s.module, s.cap === 0 ? '—' : String(s.cap), s.title]),
    { note: `Синонимы: ${synonyms}.`, headerHeight: 24 },
  )

  // --- Надписи --------------------------------------------------------------
  const labelRows = []
  for (const m of MODULES) for (const g of labelGroups(m)) labelRows.push([m.code, g.ids.join(', '), g.lines, g.maxChars.join(' / ')])
  sheet(
    wb,
    'Надписи',
    [
      { header: 'Модуль', width: 9.2, style: KEY },
      { header: 'Шильды', width: 52 },
      { header: 'Строк', width: 8, style: CENTER },
      { header: 'Предел строки, симв.', width: 20, style: CENTER },
    ],
    labelRows,
    {
      note: 'Строк в шильде и предел длины строки в символах. Длиннее — не влезет: кегль уменьшать нельзя. Панель 01: шильд L1 («Питание ~220В») неизменяемый.',
    },
  )

  // --- Каналы подключения ---------------------------------------------------
  const chRows = []
  for (const m of MODULES) {
    for (const g of channelGroups(m)) {
      chRows.push([m.code, g.ids.join(', '), g.kind, g.objects.join(', ') || '—', g.facade ? 'да' : 'нет', g.signals || '—', g.ex ?? '—', g.barrier ?? '—'])
    }
  }
  const noChannels = MODULES.filter((m) => !(m.channels ?? []).length).map((m) => m.code)
  sheet(
    wb,
    'Каналы подключения',
    [
      { header: 'Модуль', width: 9.2, style: KEY },
      { header: 'Каналы', width: 40 },
      { header: 'Устройство', width: 12, style: CENTER },
      { header: 'Объекты', width: 20, style: CENTER },
      { header: 'На фасаде', width: 11, style: CENTER },
      { header: 'Сигналы на канал', width: 18, style: CENTER },
      { header: 'Взрывозащита', width: 14, style: CENTER },
      { header: 'Барьер', width: 44 },
    ],
    chRows,
    {
      note:
        'Канал — точка подключения одного внешнего устройства (станция с ПЧ, манометр, датчик, прибор); сигналы ПЛК даны сводкой. ' +
        'Канал без вывода на фасад не даёт приборов и шильдов, но занимает входы ПЛК. «Объекты» — номера объектов модуля. ' +
        'Прочерк в сигналах — данных в РД нет (у 04 нет в выгрузке; у 05 и 305 точка уровня входов ПЛК не занимает — наружу идёт RS-485 от прибора). ' +
        `Панели без каналов: ${noChannels.join(', ') || 'нет'}. ` +
        'Разная обвязка одной панели (Exi с барьерами / Exd без них) — разные коды библиотеки. Источник: docs/каналы/<код>.md конфигуратора.',
    },
  )

  // --- Панель слота 1 -------------------------------------------------------
  const p01 = MODULES.find((m) => m.code === '01')
  const slot1Rows = []
  if (p01) {
    const chById = new Map((p01.channels ?? []).map((c) => [c.id, c]))
    const labels = new Map(p01.labels.map((l) => [l.id, l]))
    // лампы и индикаторы сопоставлены с шильдами по порядку: i-я лампа — i-й шильд L, i-й индикатор — i-й H
    const lampLabels = p01.labels.filter((l) => l.id.startsWith('L')).map((l) => l.id)
    const indLabels = p01.labels.filter((l) => l.id.startsWith('H')).map((l) => l.id)
    let lamp = 0
    let ind = 0
    for (const d of p01.devices) {
      const labelId = d.type === 'lamp' ? lampLabels[lamp++] : d.type === 'indicator' ? indLabels[ind++] : undefined
      const l = labelId ? labels.get(labelId) : undefined
      const field = !l?.editable
        ? '— (неизменяемый)'
        : d.type === 'lamp'
          ? `слот1.лампы[${SLOT1['лампы'].indexOf(labelId) + 1}]`
          : `слот1.индикаторы[${SLOT1['индикаторы'].indexOf(labelId) + 1}]`
      const c = chById.get(d.ref)
      const sig = c ? Object.entries(c.signals ?? {}).map(([t, n]) => `${t}×${n}`).join(', ') : ''
      const ex = c ? [c.ex, c.barrier ? `${c.barrier.name}${c.barrier.article ? ` (${c.barrier.article})` : ''}` : null].filter(Boolean).join(', ') : ''
      slot1Rows.push([
        d.ref ?? d.id,
        DEVICE_RU[d.type] ?? d.type,
        d.name ?? '',
        d.article ?? '—',
        labelId ?? '—',
        l ? l.default.join(' / ') : '—',
        l ? (l.editable ? 'да' : 'нет') : '—',
        l ? l.maxChars.join(' / ') : '—',
        field,
        c?.id ?? '—',
        c?.device ?? '—',
        sig || '—',
        c?.terminal ?? '—',
        c?.plc ?? '—',
        ex || '—',
      ])
    }
  }
  sheet(
    wb,
    'Панель слота 1',
    [
      { header: 'Поз.', width: 7, style: KEY },
      { header: 'Элемент', width: 11, style: CENTER },
      { header: 'Прибор', width: 40 },
      { header: 'Артикул', width: 22 },
      { header: 'Шильд', width: 7, style: CENTER },
      { header: 'Надпись по умолчанию', width: 30 },
      { header: 'Редакт.', width: 8, style: CENTER },
      { header: 'Предел строки, симв.', width: 12, style: CENTER },
      { header: 'Поле задания', width: 20 },
      { header: 'Канал', width: 7, style: CENTER },
      { header: 'Устройство', width: 26 },
      { header: 'Сигналы', width: 9.2, style: CENTER },
      { header: 'Клеммы', width: 12, style: CENTER },
      { header: 'Вход ПЛК', width: 10, style: CENTER },
      { header: 'Взрывозащита / барьер', width: 42 },
    ],
    slot1Rows,
    {
      note:
        'Панель слота 1 (код 01) стоит в каждой секции и неизменяема — меняются только надписи. ' +
        `В задании на секцию: «слот1.лампы» — до ${SLOT1['лампы'].length} ламп (${SLOT1['лампы'][0]}…${SLOT1['лампы'].at(-1)}), ` +
        `«слот1.индикаторы» — до ${SLOT1['индикаторы'].length} индикаторов (${SLOT1['индикаторы'][0]}…${SLOT1['индикаторы'].at(-1)}); ` +
        'каждая запись — «назначение» + «объект» → две строки шильда. HL1 — лампа «Питание ~220В», шильд L1 не редактируется, канала нет. ' +
        'Источник: src/library/01.json конфигуратора (генерируется из РД).',
    },
  )

  // --- Плагины --------------------------------------------------------------
  const plugins = pluginRows(pluginsDir)
  if (plugins) {
    sheet(
      wb,
      'Плагины',
      [
        { header: 'Плагин', width: 20, style: KEY },
        { header: 'Версия', width: 8, style: CENTER },
        { header: 'Назначение', width: 70 },
        { header: 'Состав', width: 34 },
        { header: 'Ключевые слова', width: 36 },
        { header: 'Установка', width: 40 },
      ],
      plugins.rows,
      {
        rowHeight: 60,
        note:
          `Маркетплейс «${plugins.name}» ООО «НТ»: источник — P:\\Projects\\_Tools\\claude-plugins (клон Gitea NT/nt-tools), ` +
          'подключается как папка: claude plugin marketplace add "P:\\Projects\\_Tools\\claude-plugins". ' +
          `Правки видны в следующем сеансе; если не подхватилось — claude plugin marketplace update ${plugins.name}. ` +
          'Памятка — ПАМЯТКА.md в той же папке. Лист собран из marketplace.json и файлов плагинов.',
      },
    )
  }

  const bytes = await wb.xlsx.writeBuffer()
  try {
    writeFileSync(out, Buffer.from(bytes))
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      console.error(`Не записать ${out}: файл открыт в Excel — закрыть и повторить`)
      process.exit(1)
    }
    throw e
  }
  console.log(
    `Справочник: ${out} (${(bytes.byteLength / 1024).toFixed(0)} КБ) — модулей ${MODULES.length}, типов ${Object.keys(KINDS).length}, ` +
      `надписей ${labelRows.length} строк, каналов ${chRows.length} строк, плагинов ${plugins ? plugins.rows.length : 0}`,
  )
})
