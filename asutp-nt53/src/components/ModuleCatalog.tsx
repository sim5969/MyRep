import { useMemo, useState } from 'react'
import { PANEL_W } from '../geometry'
import { MODULES } from '../library'
import { useStore } from '../store'
import { ModuleView } from './ModuleView'

export function ModuleCatalog() {
  const [q, setQ] = useState('')
  const sel = useStore((s) => s.sel)
  const setModule = useStore((s) => s.setModule)

  // В каталоге только модули слотов 2..5. Панель слота 1 неизменяема.
  const items = useMemo(() => {
    const list = MODULES.filter((m) => m.allowedSlots.some((n) => n >= 2))
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list.filter((m) => m.name.toLowerCase().includes(needle) || m.code.includes(needle))
  }, [q])

  const canPlace = sel !== null && sel.slot !== 1

  return (
    <aside className="panel catalog">
      <h2>Библиотека модулей</h2>
      <input
        className="search"
        placeholder="Поиск по коду или наименованию"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <p className="hint">
        {canPlace
          ? `Перетащите модуль в слот или кликните дважды — установится в слот ${sel!.slot}`
          : 'Выберите слот 2…5 в секции или перетащите модуль прямо на слот'}
      </p>
      <p className="hint">
        Поменять два модуля местами вместе с надписями: перетащить модуль правой кнопкой мыши на
        нужный слот либо кнопка «Поменять местами» на панели инструментов.
      </p>
      <div className="catalog-list">
        {items.map((m) => (
          <div
            key={m.code}
            className="catalog-item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/module-code', m.code)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onDoubleClick={() => {
              if (canPlace) setModule(sel!.secUid, sel!.slot, m.code)
            }}
            title={m.name}
          >
            <svg
              className="catalog-preview"
              viewBox={`0 0 ${PANEL_W} ${m.slotHeight}`}
              preserveAspectRatio="xMidYMid meet"
            >
              <ModuleView code={m.code} />
            </svg>
            <div className="catalog-meta">
              <span className="code">{m.code}</span>
              <span className="name">{m.name}</span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
