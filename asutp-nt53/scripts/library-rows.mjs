/**
 * Группировка надписей и каналов модуля в строки справочников.
 *
 * Общий код для `library-table.mjs` (Markdown для навыка Claude Code) и
 * `gen-xlsx.mjs` (справочная книга «Модули НТ53.xlsx»): обе таблицы должны
 * сворачивать одинаковые шильды и каналы в одну строку одинаково.
 */

/**
 * Редактируемые шильды модуля, свёрнутые по числу строк и пределам длины:
 * [{ ids, lines, maxChars }]. Модуль без редактируемых шильдов — пустой список.
 */
export function labelGroups(m) {
  const groups = new Map()
  for (const l of m.labels) {
    if (!l.editable) continue
    const key = `${l.lines}|${l.maxChars.join('/')}`
    if (!groups.has(key)) groups.set(key, { ids: [], lines: l.lines, maxChars: l.maxChars })
    groups.get(key).ids.push(l.id)
  }
  return [...groups.values()]
}

/**
 * Каналы модуля, свёрнутые по устройству, сводке сигналов, взрывозащите,
 * выводу на фасад и барьеру: [{ ids, kind, objects, facade, signals, ex, barrier }].
 * `signals` — строка вида «2 AI, 4 DI»; объекты в группе не повторяются
 * (у станции с ПЧ и её манометра объект общий).
 */
export function channelGroups(m) {
  const groups = new Map()
  for (const c of m.channels ?? []) {
    const signals = Object.entries(c.signals ?? {})
      .map(([t, n]) => `${n} ${t}`)
      .join(', ')
    const facade = c.facade !== false
    const barrier = c.barrier?.name
    const key = [c.kind, signals, c.ex ?? '', facade, barrier ?? ''].join('|')
    if (!groups.has(key)) groups.set(key, { ids: [], objects: [], kind: c.kind, facade, signals, ex: c.ex, barrier })
    const g = groups.get(key)
    g.ids.push(c.id)
    if (c.object !== undefined && !g.objects.includes(c.object)) g.objects.push(c.object)
  }
  return [...groups.values()]
}
