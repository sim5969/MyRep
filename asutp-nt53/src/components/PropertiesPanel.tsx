import { getModule } from '../library'
import { sectionDesignation, sectionId } from '../lib/designation'
import { useStore } from '../store'
import type { ProjectMeta } from '../types'

/** Графы основной надписи чертежа: заполняются один раз на проект */
const META_FIELDS: { key: keyof ProjectMeta; title: string; hint?: string }[] = [
  { key: 'code', title: 'Шифр', hint: 'Номер разработки, участвует в обозначении секции' },
  { key: 'docCode', title: 'Обозначение', hint: 'Графа обозначения документа. Пусто — «<шифр> ВО»' },
  { key: 'building', title: 'Здание' },
  { key: 'stage', title: 'Стадия' },
  { key: 'org', title: 'Организация' },
  { key: 'author', title: 'Разработал' },
  { key: 'checker', title: 'Проверил' },
  { key: 'inspector', title: 'Н. контроль' },
  { key: 'gip', title: 'ГИП' },
  { key: 'date', title: 'Дата' },
]

function StampFields() {
  const meta = useStore((s) => s.project.project)
  const setProjectMeta = useStore((s) => s.setProjectMeta)
  return (
    <>
      <h3>Штамп чертежа</h3>
      <div className="meta">
        {META_FIELDS.map((f) => (
          <label key={f.key} title={f.hint}>
            <span>{f.title}</span>
            <input
              value={meta[f.key] ?? ''}
              placeholder={f.key === 'date' ? 'ГГГГ-ММ-ДД' : ''}
              onChange={(e) => setProjectMeta({ [f.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <p className="hint">Графы штампа выводятся в PDF А3. Наименование объекта берётся из наименования проекта.</p>
    </>
  )
}

export function PropertiesPanel() {
  const project = useStore((s) => s.project)
  const sel = useStore((s) => s.sel)
  const setLabelLine = useStore((s) => s.setLabelLine)

  const complex = project.complexes[0]
  const index = sel ? complex.sections.findIndex((s) => s.uid === sel.secUid) : -1
  const sec = index >= 0 ? complex.sections[index] : undefined
  const slot = sec && sel ? sec.slots.find((s) => s.n === sel.slot) : undefined
  const spec = slot ? getModule(slot.moduleCode) : undefined

  if (!sec || !slot || !spec || !sel) {
    return (
      <aside className="panel props">
        <h2>Свойства</h2>
        <p className="hint">Выберите модуль в секции.</p>
        <StampFields />
      </aside>
    )
  }

  const editable = spec.labels.filter((l) => l.editable)
  const devicesByType = spec.devices.reduce<Record<string, number>>((acc, d) => {
    const key = d.name ?? d.type
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  return (
    <aside className="panel props">
      <h2>Свойства</h2>

      <div className="row">
        <span className="k">Секция</span>
        <span className="v">{sectionId(index)}</span>
      </div>
      <div className="row">
        <span className="k">Обозначение</span>
        <span className="v mono">{sectionDesignation(sec)}</span>
      </div>
      <div className="row">
        <span className="k">Слот</span>
        <span className="v">
          {slot.n} ({spec.slotHeight} мм)
        </span>
      </div>
      <div className="row">
        <span className="k">Модуль</span>
        <span className="v">
          <b className="mono">{spec.code}</b> — {spec.name}
        </span>
      </div>

      <h3>Состав</h3>
      {spec.devices.length === 0 ? (
        <p className="hint">Приборы отсутствуют.</p>
      ) : (
        <ul className="bom">
          {Object.entries(devicesByType).map(([name, n]) => (
            <li key={name}>
              <span>{name}</span>
              <b>{n}</b>
            </li>
          ))}
        </ul>
      )}

      <h3>Надписи</h3>
      {slot.n === 1 ? <p className="hint">Панель слота 1 неизменяема, редактируются только надписи.</p> : null}
      {editable.length === 0 ? (
        <p className="hint">У модуля нет редактируемых надписей.</p>
      ) : (
        <div className="labels">
          {editable.map((l) => {
            const value = slot.labels[l.id] ?? l.default
            return (
              <div className="label-group" key={l.id}>
                <div className="label-id mono">{l.id}</div>
                {Array.from({ length: l.lines }, (_, i) => {
                  const v = value[i] ?? ''
                  const max = l.maxChars[i] ?? 40
                  const over = v.length > max
                  return (
                    <div className="label-line" key={i}>
                      <input
                        className={over ? 'over' : ''}
                        value={v}
                        placeholder={`строка ${i + 1}`}
                        onChange={(e) => setLabelLine(sec.uid, slot.n, l.id, i, e.target.value)}
                      />
                      <span className={over ? 'counter over' : 'counter'}>
                        {v.length}/{max}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      <StampFields />
    </aside>
  )
}
