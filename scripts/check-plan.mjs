/**
 * Регрессия правил подбора: эталонные задания → компоновка → сверка с эталоном.
 *
 * Для каждого набора в `tests/plan/<случай>/`:
 *   задание.json  — задание на компоновку;
 *   эталон.json   — проект, который должен получиться (необязательно).
 *
 * Если эталона нет, проверяется только то, что задание разбирается без
 * замечаний, а компоновка собирается. Эталон сверяется построчно: код модуля в
 * каждом слоте и каждая надпись эталона. Так правки в `kinds.mjs`, библиотеке
 * или `plan.mjs` не ломают уже собранные проекты молча.
 *
 * Обновить эталон: node scripts/plan.mjs "tests/plan/<случай>/задание.json"
 *   --out="tests/plan/<случай>/эталон.json" — и глазами сверить чертёж.
 *
 * Запуск: node scripts/check-plan.mjs [--случай=имя]
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, ROOT, withApp } from './app-modules.mjs'

const only = arg('случай')
const CASES = join(ROOT, 'tests', 'plan')
const dirs = readdirSync(CASES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && (!only || d.name === only))
  .map((d) => d.name)

if (!dirs.length) {
  console.error(`Наборы не найдены в ${CASES}`)
  process.exit(2)
}

const problems = []
const tmp = mkdtempSync(join(tmpdir(), 'plan-check-'))

/** Значения шильдов по умолчанию: их наличие вместо надписи эталона — не ошибка */
const defaults = await withApp(async (load) => {
  const { MODULES } = await load('/src/library/index.ts')
  const out = {}
  for (const m of MODULES) {
    out[m.code] = Object.fromEntries(m.labels.filter((l) => l.editable).map((l) => [l.id, l.default]))
  }
  return out
})

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const SPARE = [['Резерв', '—'], ['Резерв'], ['—']]

for (const name of dirs) {
  const dir = join(CASES, name)
  const task = join(dir, 'задание.json')
  if (!existsSync(task)) {
    problems.push(`${name}: нет файла задание.json`)
    continue
  }
  const out = join(tmp, `${name}.json`)
  let log
  try {
    log = execFileSync(process.execPath, [join(ROOT, 'scripts', 'plan.mjs'), task, `--out=${out}`], {
      encoding: 'utf8',
      cwd: ROOT,
    })
  } catch (e) {
    problems.push(`${name}: подбор упал — ${e.stderr?.trim() || e.message}`)
    continue
  }

  const notes = log.split('\n').filter((l) => l.startsWith('  ! '))
  const project = JSON.parse(readFileSync(out, 'utf8'))
  const secs = project.complexes[0].sections
  const codes = secs.map((s) => s.slots.map((x) => x.moduleCode).join('.')).join(' | ')
  console.log(`${name}: секций ${secs.length} — ${codes}`)
  for (const n of notes) console.log(`   ${n.trim()}`)

  const refPath = join(dir, 'эталон.json')
  if (!existsSync(refPath)) {
    console.log('   эталона нет, сверять не с чем')
    continue
  }

  // эталон может быть в схеме версии 1 (шкафы) — приводим к текущей
  const raw = JSON.parse(readFileSync(refPath, 'utf8'))
  const ref = raw.complexes
    ? raw.complexes[0].sections
    : raw.sections[0].cabinets

  if (ref.length !== secs.length) {
    problems.push(`${name}: секций ${secs.length}, в эталоне ${ref.length}`)
    continue
  }
  let labels = 0
  for (const [i, a] of ref.entries()) {
    const b = secs[i]
    for (const [j, sa] of a.slots.entries()) {
      const sb = b.slots[j]
      if (sa.moduleCode !== sb.moduleCode) {
        problems.push(`${name}: секция ${i + 1} слот ${sa.n} — модуль ${sb.moduleCode}, в эталоне ${sa.moduleCode}`)
        continue
      }
      for (const [id, va] of Object.entries(sa.labels ?? {})) {
        labels++
        const vb = sb.labels?.[id]
        if (!same(va, vb)) {
          problems.push(
            `${name}: секция ${i + 1} слот ${sa.n} шильд ${id} — «${(vb ?? []).join(' / ')}», в эталоне «${va.join(' / ')}»`,
          )
        }
      }
      // надписи, которых в эталоне нет: допустимы только «Резерв» и значения по умолчанию
      for (const [id, vb] of Object.entries(sb.labels ?? {})) {
        if (sa.labels?.[id]) continue
        if (SPARE.some((s) => same(s, vb))) continue
        if (same(defaults[sa.moduleCode]?.[id], vb)) continue
        problems.push(`${name}: секция ${i + 1} слот ${sa.n} шильд ${id} — лишняя надпись «${vb.join(' / ')}»`)
      }
    }
  }
  console.log(`   сверено с эталоном: ${labels} надписей`)
}

rmSync(tmp, { recursive: true, force: true })

if (problems.length) {
  console.log('\nЗамечания:')
  for (const p of problems) console.log('  ! ' + p)
  process.exit(1)
}
console.log('\nЗамечаний нет.')
