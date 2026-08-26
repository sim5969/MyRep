/**
 * Предварительная компоновка комплекса секций управления по заданию.
 *
 * На входе — задание в JSON: сведения проекта и перечень объектов
 * автоматизации (насосы, задвижки, регулирующая арматура, точки уровня,
 * аналоговые параметры). На выходе — проект конфигуратора: объекты разложены
 * по вставным модулям, модули — по секциям, надписи заполнены из задания.
 *
 * Раскладку можно задать явно (`раскладка`) — так работает инженер, когда
 * распределяет нагрузку между секциями; иначе модули набиваются по порядку.
 *
 * Правило «объект → модуль» и адреса шильдов — в scripts/kinds.mjs.
 * Формат задания — docs/Задание на компоновку.md.
 *
 * Запуск: node scripts/plan.mjs "задание.json" [--out=проект.json] [--тихо]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { arg, flag, withApp } from './app-modules.mjs'
import { KINDS, kindOf, SLOT1, SLOTS_PER_SECTION, SPARE_LABEL } from './kinds.mjs'

const src = process.argv[2]
if (!src || src.startsWith('--')) {
  console.error('Укажите файл задания: node scripts/plan.mjs "задание.json" [--out=проект.json]')
  process.exit(2)
}

const task = JSON.parse(readFileSync(src, 'utf8'))
const meta = task['проект'] ?? {}
const objects = task['объекты'] ?? []
const spare = Number(task['резерв'] ?? 0)
const fillSpare = task['резервные надписи'] !== false
const quiet = flag('тихо')

const warnings = []
const say = (s) => {
  if (!quiet) console.log(s)
}

const blank = () => ({ kind: 'резерв', code: '00', objects: [] })

// ---------------------------------------------------------------------------
// 1. Объекты по типам → модули
// ---------------------------------------------------------------------------

const order = [] // типы в порядке первого появления в задании
const byKind = new Map() // тип → все объекты этого типа (для отчёта)

/**
 * Объекты по типам и секциям. Ключ «секция» в задании привязывает сигнал к
 * конкретной секции: так инженер держит в одной секции одну технологическую
 * группу и осознанно оставляет свободные места (компоновка АКН-2026).
 * Объекты без «секции» идут в общую очередь и добираются по остатку.
 */
const pools = new Map()

for (const [i, o] of objects.entries()) {
  const kind = kindOf(o['тип'])
  if (!kind) {
    warnings.push(
      `объект ${i + 1}: неизвестный тип «${o['тип']}», пропущен. Допустимо: ${Object.keys(KINDS).join(', ')}`,
    )
    continue
  }
  if (!byKind.has(kind)) {
    byKind.set(kind, [])
    pools.set(kind, { bySection: new Map(), any: [] })
    order.push(kind)
  }
  byKind.get(kind).push(o)
  const pool = pools.get(kind)
  const n = Number(o['секция'])
  if (Number.isInteger(n) && n > 0) {
    if (!pool.bySection.has(n)) pool.bySection.set(n, [])
    pool.bySection.get(n).push(o)
  } else {
    pool.any.push(o)
  }
}

/** Набрать объекты в модуль типа kind для секции sectionNo (1-based) */
function take(kind, sectionNo) {
  const spec = KINDS[kind]
  const pool = pools.get(kind)
  const list = []
  const drain = (arr) => {
    while (arr?.length && list.length < spec.cap) list.push(arr.shift())
  }
  drain(pool?.bySection.get(sectionNo))
  drain(pool?.any)
  return list
}

/** Сколько объектов типа ещё не размещено */
function left(kind) {
  const pool = pools.get(kind)
  if (!pool) return 0
  let n = pool.any.length
  for (const arr of pool.bySection.values()) n += arr.length
  return n
}

// ---------------------------------------------------------------------------
// 2. Модули → секции
// ---------------------------------------------------------------------------

const layout = task['раскладка']
let sections = []

if (Array.isArray(layout)) {
  // раскладка задана инженером: строка — секция, ячейка — тип модуля в слоте 2…5
  sections = layout.map((row, s) => {
    const part = (row ?? []).slice(0, SLOTS_PER_SECTION).map((cell, k) => {
      if (!cell || cell === '00') return blank()
      const kind = kindOf(cell)
      if (!kind) {
        warnings.push(`раскладка, секция ${s + 1} слот ${k + 2}: неизвестный тип «${cell}», поставлена глухая панель`)
        return blank()
      }
      if (kind === 'резерв') return blank()
      const picked = take(kind, s + 1)
      if (!picked.length) {
        warnings.push(
          `раскладка, секция ${s + 1} слот ${k + 2}: объектов типа «${cell}» не осталось, поставлена глухая панель`,
        )
        return blank()
      }
      return { kind, code: KINDS[kind].module, objects: picked }
    })
    while (part.length < SLOTS_PER_SECTION) part.push(blank())
    return part
  })
  for (const kind of order) {
    const n = left(kind)
    if (n) {
      warnings.push(
        `не размещено объектов «${kind}»: ${n} — добавьте модуль в раскладку либо снимите привязку к секции`,
      )
    }
  }
} else {
  // автоматическая раскладка: объекты каждого типа набиваются подряд,
  // привязка к секции учитывается как порядок
  const flat = []
  for (const kind of order) {
    const spec = KINDS[kind]
    if (spec.cap === 0) {
      for (let i = 0; i < byKind.get(kind).length; i++) flat.push(blank())
      continue
    }
    const nums = [...pools.get(kind).bySection.keys()].sort((a, b) => a - b)
    const queue = [...nums.flatMap((n) => pools.get(kind).bySection.get(n)), ...pools.get(kind).any]
    for (let i = 0; i < queue.length; i += spec.cap) {
      flat.push({ kind, code: spec.module, objects: queue.slice(i, i + spec.cap) })
    }
  }
  for (let i = 0; i < spare; i++) flat.push(blank())
  for (let i = 0; i < flat.length; i += SLOTS_PER_SECTION) {
    const part = flat.slice(i, i + SLOTS_PER_SECTION)
    while (part.length < SLOTS_PER_SECTION) part.push(blank())
    sections.push(part)
  }
}

if (!sections.length) {
  console.error('В задании нет объектов, которые можно разложить по модулям.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 3. Сборка проекта конфигуратора
// ---------------------------------------------------------------------------

/** Строки шильда для объекта по адресу шильда */
function linesFor(descriptor, obj) {
  if (descriptor.lines >= 2) return [obj['назначение'] ?? '', obj['объект'] ?? '']
  // однострочный шильд несёт одну роль: назначение, объект либо подпись целиком
  const role = descriptor.role ?? 'подпись'
  if (role === 'подпись') return [obj['подпись'] ?? obj['назначение'] ?? obj['объект'] ?? '']
  return [obj[role] ?? '']
}

const out = await withApp(async (load) => {
  const { makeProject, makeSlot, normalizeProject, DEFAULT_COMPLEX_ID } = await load('/src/lib/project.ts')
  const { sectionId, sectionDesignation } = await load('/src/lib/designation.ts')
  const { getModule } = await load('/src/library/index.ts')

  const project = makeProject(meta['наименование'] ?? 'Предварительная компоновка', sections.length)
  Object.assign(project.project, {
    code: meta['шифр'] ?? project.project.code,
    author: meta['разработал'] ?? '',
    date: meta['дата'] ?? project.project.date,
    docCode: meta['обозначение'] ?? '',
    building: meta['здание'] ?? '',
    stage: meta['стадия'] ?? 'Р',
    org: meta['организация'] ?? project.project.org,
    checker: meta['проверил'] ?? '',
    inspector: meta['контроль'] ?? '',
    gip: meta['гип'] ?? '',
  })
  const complex = project.complexes[0]
  complex.id = task['комплекс'] ?? DEFAULT_COMPLEX_ID

  /** Проверка длины строки по библиотеке */
  const fit = (code, id, lines, where) => {
    const spec = getModule(code)
    const l = spec?.labels.find((x) => x.id === id)
    if (!l) {
      warnings.push(`${where}: в модуле ${code} нет шильда ${id}`)
      return
    }
    lines.forEach((v, i) => {
      const max = l.maxChars[i] ?? 40
      if (v && v.length > max) {
        warnings.push(`${where}: строка «${v}» — ${v.length} симв., шильд ${id} держит ${max}`)
      }
    })
  }

  // надписи панели слота 1: либо массив по секциям, либо общая очередь
  const perSection = Array.isArray(task['слот1']) ? task['слот1'] : null
  const lamps = perSection ? null : [...(task['слот1']?.['лампы'] ?? [])]
  const tops = perSection ? null : [...(task['слот1']?.['индикаторы'] ?? [])]

  sections.forEach((part, s) => {
    const sec = complex.sections[s]
    const id = sectionId(s)

    // --- слот 1: неизменяемая панель, заполняем только надписи ---
    const slot1 = sec.slots[0]
    const myLamps = perSection ? [...(perSection[s]?.['лампы'] ?? [])] : lamps
    const myTops = perSection ? [...(perSection[s]?.['индикаторы'] ?? [])] : tops
    const filled = new Set()
    const put1 = (ids, queue) => {
      for (const lid of ids) {
        const o = queue.shift()
        if (!o) continue
        filled.add(lid)
        const v = [o['назначение'] ?? '', o['объект'] ?? '']
        slot1.labels[lid] = v
        fit('01', lid, v, `${id} слот 1`)
      }
    }
    put1(SLOT1['лампы'], myLamps)
    put1(SLOT1['индикаторы'], myTops)
    if (fillSpare) {
      // свободные места панели слота 1 подписываются «Резерв», как в АКН-2026
      for (const lid of [...SLOT1['лампы'], ...SLOT1['индикаторы']]) {
        if (filled.has(lid)) continue
        slot1.labels[lid] = [SPARE_LABEL['назначение'], SPARE_LABEL['объект']]
      }
    }

    // --- слоты 2…5: модули компоновки ---
    part.forEach((m, k) => {
      const n = k + 2
      sec.slots[n - 1] = makeSlot(n, m.code)
      const slot = sec.slots[n - 1]
      const spec = KINDS[m.kind]
      if (spec.cap === 0) return

      for (let i = 0; i < spec.cap; i++) {
        const obj = m.objects[i]
        if (!obj && !fillSpare) continue
        for (const d of spec.labels(i)) {
          const lines = linesFor(d, obj ?? SPARE_LABEL)
          slot.labels[d.id] = lines
          if (obj) fit(m.code, d.id, lines, `${id} слот ${n}`)
        }
      }
    })
  })

  normalizeProject(project)

  // --- отчёт -------------------------------------------------------------
  say(`Задание: ${src}`)
  say(`Проект: ${project.project.name}`)
  const counts = order.map((k) => `${byKind.get(k).length} × ${k}`).join(', ')
  say(`Объектов: ${objects.length}${counts ? ` (${counts})` : ''}`)

  const placed = sections.flat()
  const used = new Map()
  for (const m of placed) used.set(m.code, (used.get(m.code) ?? 0) + 1)
  say(
    `Модулей: ${placed.length} — ` +
      [...used.entries()]
        .sort()
        .map(([c, n]) => `${c} × ${n}`)
        .join(', '),
  )
  say(`Раскладка: ${Array.isArray(layout) ? 'задана в задании' : 'автоматическая'}`)
  say(`Комплекс ${complex.id}: секций ${complex.sections.length}`)
  complex.sections.forEach((sec, s) => {
    const slots = sec.slots
      .filter((x) => x.n > 1)
      .map((x) => `${x.n}:${x.moduleCode}`)
      .join('  ')
    say(`  ${sectionId(s)}  ${sectionDesignation(sec)}   ${slots}`)
  })
  const free = placed.filter((m) => m.code === '00').length
  say(`Свободных слотов: ${free} из ${sections.length * SLOTS_PER_SECTION}`)
  for (const m of placed) {
    const cap = KINDS[m.kind].cap
    if (cap > 1 && m.objects.length && m.objects.length < cap) {
      say(`  запас в модуле ${m.code}: занято ${m.objects.length} из ${cap}`)
    }
  }

  const outPath = arg('out', join(dirname(src), `${project.project.name}.json`))
  writeFileSync(outPath, JSON.stringify(project, null, 2), 'utf8')
  say(`Проект: ${outPath}`)
  return outPath
})

if (warnings.length) {
  console.log('\nЗамечания:')
  for (const w of warnings) console.log('  ! ' + w)
}
if (!quiet) console.log(`\nВыгрузка документов: node scripts/export.mjs "${out}" --all --out=<папка>`)
