/**
 * Таблица библиотеки модулей для справочника скила: код, наименование,
 * ёмкость, редактируемые шильды и ограничения длины строк.
 *
 * Источник истины — библиотека `src/library/*.json` и правило подбора
 * `scripts/kinds.mjs`, поэтому справочник не расходится с приложением.
 *
 * Запуск: node scripts/library-table.mjs [--out=путь.md]
 */
import { writeFileSync } from 'node:fs'
import { arg, withApp } from './app-modules.mjs'
import { ALIASES, KINDS, SLOT1, SLOTS_PER_SECTION } from './kinds.mjs'
import { channelGroups, labelGroups } from './library-rows.mjs'

const out = arg('out')

const md = await withApp(async (load) => {
  const { MODULES } = await load('/src/library/index.ts')
  const byCode = new Map(MODULES.map((m) => [m.code, m]))
  const kindOf = new Map(Object.entries(KINDS).map(([k, v]) => [v.module, k]))

  const lines = []
  lines.push('# Библиотека модулей и правило подбора')
  lines.push('')
  lines.push('Файл создан командой `node scripts/library-table.mjs` из библиотеки конфигуратора.')
  lines.push('Не править руками: библиотека пополняется, справочник надо перегенерировать.')
  lines.push('')
  lines.push(`В секции ${SLOTS_PER_SECTION} сменных слота (2…5); слот 1 занят панелью \`01\`.`)
  lines.push('')
  lines.push('## Тип объекта в задании → модуль')
  lines.push('')
  lines.push('| `тип` в задании | Модуль | Объектов в модуле | Что это | Как узнать в документах |')
  lines.push('|---|---|---|---|---|')
  for (const [kind, spec] of Object.entries(KINDS)) {
    const cap = spec.cap === 0 ? '—' : spec.cap
    lines.push(`| \`${kind}\` | \`${spec.module}\` | ${cap} | ${spec.title} | ${spec.hint ?? '—'} |`)
  }
  lines.push('')
  lines.push('Синонимы типов: ' + Object.entries(ALIASES).map(([a, k]) => `\`${a}\` → \`${k}\``).join(', ') + '.')
  lines.push('')
  lines.push('## Модули библиотеки')
  lines.push('')
  lines.push('| Код | Наименование | Слоты | Приборов | Шильдов | Редактируемых | Тип объекта |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const m of MODULES) {
    const ed = m.labels.filter((l) => l.editable).length
    const kind = kindOf.get(m.code) ?? (m.code === '01' ? 'панель слота 1' : '—')
    lines.push(
      `| \`${m.code}\` | ${m.name} | ${m.allowedSlots.join(', ')} | ${m.devices.length} | ${m.labels.length} | ${ed} | ${kind} |`,
    )
  }
  lines.push('')
  lines.push('## Надписи по модулям')
  lines.push('')
  lines.push('Строк в шильде и предел длины строки в символах. Длиннее — не влезет, кегль уменьшать нельзя.')
  lines.push('')
  lines.push('| Модуль | Шильды | Строк | Предел строк, симв. |')
  lines.push('|---|---|---|---|')
  for (const m of MODULES) {
    for (const g of labelGroups(m)) {
      lines.push(`| \`${m.code}\` | ${g.ids.join(', ')} | ${g.lines} | ${g.maxChars.join(' / ')} |`)
    }
  }
  lines.push('')
  // каналы подключения: заполнены не у всех панелей
  const withCh = MODULES.filter((m) => (m.channels ?? []).length)
  if (withCh.length) {
    lines.push('## Каналы подключения')
    lines.push('')
    lines.push('Канал — точка подключения одного внешнего устройства: станции с ПЧ, манометра,')
    lines.push('датчика, прибора. Сигналы ПЛК внутри канала не расписываются, а даны сводкой.')
    lines.push('Канал без вывода на фасад не даёт ни приборов, ни шильдов, но занимает входы ПЛК.')
    lines.push('«Объекты» — номера объектов модуля, к которым привязаны каналы.')
    lines.push('')
    lines.push('| Модуль | Каналы | Устройство | Объекты | На фасаде | Сигналы на канал | Взрывозащита | Барьер |')
    lines.push('|---|---|---|---|---|---|---|---|')
    for (const m of withCh) {
      for (const g of channelGroups(m)) {
        lines.push(
          `| \`${m.code}\` | ${g.ids.join(', ')} | ${g.kind} | ${g.objects.join(', ') || '—'} | ` +
            `${g.facade ? 'да' : 'нет'} | ${g.signals || '—'} | ${g.ex ?? '—'} | ${g.barrier ?? '—'} |`,
        )
      }
    }
    lines.push('')
    lines.push('Данные лежат в `docs/каналы/<код>.md` конфигуратора и берутся из рабочей')
    lines.push('документации. Прочерк в сводке сигналов — данных в документации нет:')
    lines.push('у панели 04 её вообще нет в выгрузке, у панели 05 точка уровня входов ПЛК')
    lines.push('не занимает (датчик работает на прибор, наружу идёт RS-485 от прибора).')
    lines.push('Разная обвязка одной панели (Exi с барьерами против Exd без них) — это разные')
    lines.push('коды в библиотеке; код входит в обозначение секции. Подробнее —')
    lines.push('`P:/Projects/Шкафы АСУТП НТ53/docs/Каналы подключения.md`.')
    lines.push('')
  }
  lines.push('## Панель слота 1 (код `01`)')
  lines.push('')
  const p01 = byCode.get('01')
  lines.push(`${SLOT1.title}. Меняются только надписи, сама панель неизменяема.`)
  lines.push('')
  lines.push(`- лампы (\`слот1.лампы\`): ${SLOT1['лампы'].join(', ')} — ${SLOT1['лампы'].length} шт. на секцию`)
  lines.push(
    `- индикаторы (\`слот1.индикаторы\`): ${SLOT1['индикаторы'].join(', ')} — ${SLOT1['индикаторы'].length} шт. на секцию`,
  )
  if (p01) lines.push(`- шильд \`L1\` («Питание ~220В») неизменяемый`)
  lines.push('')
  return lines.join('\n')
})

if (out) {
  writeFileSync(out, md, 'utf8')
  console.log(`Справочник: ${out} (${md.split('\n').length} строк)`)
} else {
  console.log(md)
}
