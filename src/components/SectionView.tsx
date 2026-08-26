import {
  SECTION_H,
  SECTION_W,
  CORPUS_H,
  OPENING_H,
  OPENING_TOP,
  OPENING_W,
  OPENING_X,
  PANEL_X,
  PANEL_W,
  slotHeight,
  slotTop,
} from '../geometry'
import { sectionDesignation } from '../lib/designation'
import { useStore } from '../store'
import type { Section } from '../types'
import { ModuleView } from './ModuleView'

interface Props {
  sec: Section
  displayId: string
  showPositions: boolean
}

/** Вид одной секции на фасад. Локальные координаты 0..600 × 0..2200. */
export function SectionView({ sec, displayId, showPositions }: Props) {
  const sel = useStore((s) => s.sel)
  const swapFrom = useStore((s) => s.swapFrom)
  const dragging = useStore((s) => s.dragging)
  const dragOver = useStore((s) => s.dragOver)
  const select = useStore((s) => s.select)
  const setModule = useStore((s) => s.setModule)
  const armSwap = useStore((s) => s.armSwap)
  const beginDrag = useStore((s) => s.beginDrag)
  const setDragOver = useStore((s) => s.setDragOver)
  const canSwap = useStore((s) => s.canSwap)
  const swapSlots = useStore((s) => s.swapSlots)
  const designation = sectionDesignation(sec)

  return (
    <g>
      {/* корпус */}
      <rect x={0} y={0} width={SECTION_W} height={CORPUS_H} fill="#dedbd4" stroke="#7c7a74" strokeWidth={2} />
      {/* цоколь */}
      <rect
        x={0}
        y={CORPUS_H}
        width={SECTION_W}
        height={SECTION_H - CORPUS_H}
        fill="#3a3a3a"
        stroke="#2a2a2a"
        strokeWidth={2}
      />

      {/* шильд обозначения над проёмом */}
      <rect x={SECTION_W / 2 - 180} y={22} width={360} height={44} fill="#f4f3ef" stroke="#8d8a83" strokeWidth={0.8} />
      <text x={SECTION_W / 2} y={40} fontSize={12} textAnchor="middle" fill="#222">
        Секция автоматизации
      </text>
      <text x={SECTION_W / 2} y={59} fontSize={16} textAnchor="middle" fill="#111" fontWeight={700}>
        {designation}
      </text>

      {/* рамка проёма */}
      <rect
        x={OPENING_X - 12}
        y={OPENING_TOP - 12}
        width={OPENING_W + 24}
        height={OPENING_H + 24}
        fill="none"
        stroke="#2b2b2b"
        strokeWidth={6}
      />

      {/* модули */}
      {sec.slots.map((s) => {
        const y = slotTop(s.n)
        const h = slotHeight(s.n)
        const isSel = sel?.secUid === sec.uid && sel.slot === s.n
        const isSwapFrom = swapFrom?.secUid === sec.uid && swapFrom.slot === s.n
        const isDropTarget = dragOver?.secUid === sec.uid && dragOver.slot === s.n
        const here = { secUid: sec.uid, slot: s.n }
        // источник перетаскивания подсвечивается пунктиром, цель — зелёной рамкой
        const stroke = isDropTarget ? '#16a34a' : isSwapFrom ? '#d97706' : isSel ? '#0a58a6' : 'transparent'
        const dashed = isSwapFrom && !isDropTarget
        return (
          <g key={s.n} transform={`translate(${PANEL_X}, ${y})`}>
            <ModuleView code={s.moduleCode} labels={s.labels} showPositions={showPositions} slotNumber={s.n} />
            <rect
              x={0}
              y={0}
              width={PANEL_W}
              height={h}
              fill="transparent"
              stroke={stroke}
              strokeWidth={4}
              strokeDasharray={dashed ? '14 8' : undefined}
              style={{ cursor: dragging ? 'grabbing' : 'grab' }}
              onMouseDown={(e) => {
                if (e.button !== 0 || e.ctrlKey) return // Ctrl + левая — панорама полотна
                e.preventDefault() // не даём браузеру выделять текст при протяжке
                // обмен, начатый кнопкой «Поменять местами»: второй щелчок завершает
                if (swapFrom && !dragging) {
                  if (isSwapFrom) armSwap(null)
                  else swapSlots(swapFrom, here)
                  return
                }
                select(here)
                beginDrag(here)
              }}
              onMouseEnter={() => {
                if (!dragging || !swapFrom) return
                setDragOver(canSwap(swapFrom, here) ? here : null)
              }}
              onMouseLeave={() => {
                if (dragging && isDropTarget) setDragOver(null)
              }}
              onDragOver={(e) => {
                if (s.n !== 1) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                const code = e.dataTransfer.getData('text/module-code')
                if (code && s.n !== 1) {
                  setModule(sec.uid, s.n, code)
                  select({ secUid: sec.uid, slot: s.n })
                }
              }}
            />
            {/* номер слота слева от панели */}
            <text x={-16} y={h / 2 + 5} fontSize={13} textAnchor="middle" fill="#7c7a74">
              {s.n}
            </text>
          </g>
        )
      })}

      {/* идентификатор секции под цоколем */}
      <text x={SECTION_W / 2} y={SECTION_H + 40} fontSize={26} textAnchor="middle" fill="#111" fontWeight={700}>
        {displayId}
      </text>
    </g>
  )
}
