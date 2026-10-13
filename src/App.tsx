import { useEffect, useState } from 'react'
import { ModuleCatalog } from './components/ModuleCatalog'
import { PropertiesPanel } from './components/PropertiesPanel'
import { ComplexCanvas } from './components/ComplexCanvas'
import { Toolbar } from './components/Toolbar'
import { sectionDesignation, sectionId } from './lib/designation'
import { PX_PER_MM, useStore } from './store'

export default function App() {
  const [showPositions, setShowPositions] = useState(false)
  const project = useStore((s) => s.project)
  const fileName = useStore((s) => s.file?.name)
  const complex = project.complexes[0]

  // имя открытого файла — в заголовке вкладки
  useEffect(() => {
    document.title = fileName ? `${fileName} — Конфигуратор секций АСУ ТП НТ53` : 'Конфигуратор секций АСУ ТП — НТ53'
  }, [fileName])

  // горячие клавиши масштаба; не мешаем вводу текста
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const { scale, setScale, fit, swapFrom } = useStore.getState()
      if (e.key === 'Escape') {
        if (!swapFrom) return
        useStore.getState().endDrag()
      } else if (e.key === '+' || e.key === '=') setScale(scale * 1.25)
      else if (e.key === '-') setScale(scale / 1.25)
      else if (e.key === '0') fit()
      else if (e.key === '1') setScale(PX_PER_MM)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // перетаскивание модуля завершается там, где отпустили кнопку мыши
  useEffect(() => {
    const onUp = () => {
      const { dragging, swapFrom, dragOver, swapSlots, endDrag } = useStore.getState()
      if (!dragging) return
      if (swapFrom && dragOver) swapSlots(swapFrom, dragOver)
      else endDrag()
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  return (
    <div className="app">
      <Toolbar showPositions={showPositions} setShowPositions={setShowPositions} />
      <div className="body">
        <ModuleCatalog />
        <main className="workspace">
          <ComplexCanvas showPositions={showPositions} />
          <div className="status">
            {complex.id}: секций {complex.sections.length} ·{' '}
            {complex.sections.map((sec, i) => (
              <span key={sec.uid} className="chip mono">
                {sectionId(i)} {sectionDesignation(sec)}
              </span>
            ))}
          </div>
        </main>
        <PropertiesPanel />
      </div>
    </div>
  )
}
