import { useEffect, useRef, useState } from 'react'
import { SECTION_H, SECTION_W } from '../geometry'
import { sectionId } from '../lib/designation'
import { MAX_SCALE, MIN_SCALE, useStore } from '../store'
import { SectionView } from './SectionView'

const MARGIN_X = 60
const MARGIN_TOP = 40
const MARGIN_BOTTOM = 90
/** Отступ от краёв области просмотра при подгонке под окно */
const FIT_PAD = 32

export function ComplexCanvas({ showPositions }: { showPositions: boolean }) {
  const project = useStore((s) => s.project)
  const mode = useStore((s) => s.mode)
  const scale = useStore((s) => s.scale)
  const autoFit = useStore((s) => s.autoFit)
  const applyFitScale = useStore((s) => s.applyFitScale)
  const sel = useStore((s) => s.sel)

  const viewRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [panning, setPanning] = useState(false)

  const complex = project.complexes[0]
  const all = complex.sections
  const visible = mode === 'section' && sel ? all.filter((s) => s.uid === sel.secUid) : all
  const list = visible.length ? visible : all

  const w = list.length * SECTION_W + MARGIN_X * 2
  const h = SECTION_H + MARGIN_TOP + MARGIN_BOTTOM

  // размер области просмотра
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // подгонка под окно, пока масштаб не задан вручную
  useEffect(() => {
    if (!autoFit || !box.w || !box.h) return
    applyFitScale(Math.min((box.w - FIT_PAD) / w, (box.h - FIT_PAD) / h))
  }, [autoFit, box.w, box.h, w, h, applyFitScale])

  // зум колесом к точке под курсором
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey) return // Shift + колесо оставляем прокрутке
      e.preventDefault()
      const { scale: cur, setScale } = useStore.getState()
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cur * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      if (next === cur) return
      const r = el.getBoundingClientRect()
      const vx = e.clientX - r.left
      const vy = e.clientY - r.top
      // точка под курсором в координатах содержимого
      const cx = (vx + el.scrollLeft) / cur
      const cy = (vy + el.scrollTop) / cur
      setScale(next)
      requestAnimationFrame(() => {
        el.scrollLeft = cx * next - vx
        el.scrollTop = cy * next - vy
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /** Панорамирование: средняя кнопка мыши или Ctrl + левая */
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 1 && !(e.button === 0 && e.ctrlKey)) return
    const el = viewRef.current
    if (!el) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startL = el.scrollLeft
    const startT = el.scrollTop
    setPanning(true)
    const move = (ev: PointerEvent) => {
      el.scrollLeft = startL - (ev.clientX - startX)
      el.scrollTop = startT - (ev.clientY - startY)
    }
    const up = () => {
      setPanning(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={panning ? 'canvas panning' : 'canvas'}
      ref={viewRef}
      onPointerDown={onPointerDown}
      title="Колесо — масштаб, средняя кнопка или Ctrl + перетаскивание — панорама"
    >
      <div className="canvas-inner">
        <svg
          width={w * scale}
          height={h * scale}
          viewBox={`${-MARGIN_X} ${-MARGIN_TOP} ${w} ${h}`}
          style={{ background: '#f7f7f5' }}
        >
          {list.map((sec, i) => (
            <g key={sec.uid} transform={`translate(${i * SECTION_W}, 0)`}>
              <SectionView sec={sec} displayId={sectionId(all.indexOf(sec))} showPositions={showPositions} />
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}
