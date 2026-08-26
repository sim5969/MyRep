import { PANEL_W } from '../geometry'
import { getModule } from '../library'
import type { ModuleSpec } from '../types'
import { DeviceShape } from './DeviceShape'

/** Доля высоты строки, занимаемая шрифтом; согласовано с scripts/gen-library.mjs */
const FONT_RATIO = 0.6
/** Средняя ширина знака относительно кегля */
const CHAR_W = 0.55

interface Props {
  /** Код модуля */
  code: string
  /** Значения редактируемых надписей */
  labels?: Record<string, string[]>
  /** Показывать позиционные обозначения устройств */
  showPositions?: boolean
  slotNumber?: number
}

/** Лицевая панель модуля. Локальные координаты: 0..540 × 0..высота панели. */
export function ModuleView({ code, labels, showPositions, slotNumber }: Props) {
  const spec: ModuleSpec | undefined = getModule(code)
  if (!spec) {
    return (
      <text x={PANEL_W / 2} y={40} fontSize={8} textAnchor="middle" fill="#b00">
        Модуль {code} не найден
      </text>
    )
  }

  return (
    <g>
      <rect
        x={0}
        y={0}
        width={PANEL_W}
        height={spec.slotHeight}
        fill="#eceae4"
        stroke="#9a978f"
        strokeWidth={0.8}
      />

      {spec.labels.map((l) => {
        const value = (l.editable ? labels?.[l.id] : undefined) ?? l.default
        // h может отсутствовать в рукописном JSON
        const boxH = Number.isFinite(l.h) && l.h > 0 ? l.h : (l.fontSize ?? 3.2) * l.lines * 1.9 + 3
        const lineH = boxH / l.lines
        const base = l.fontSize ?? lineH * FONT_RATIO
        // длинный текст поджимается по ширине шильда, чтобы не выходить за рамку
        const longest = Math.max(1, ...Array.from({ length: l.lines }, (_, i) => (value[i] ?? '').length))
        const fs = Math.max(1.4, Math.min(base, (l.w - 2) / (longest * CHAR_W)))
        const anchor = l.align === 'left' ? 'start' : 'middle'
        const x = l.align === 'left' ? l.x + 1.5 : l.x + l.w / 2
        return (
          <g key={l.id}>
            {l.box ? (
              <rect x={l.x} y={l.y} width={l.w} height={boxH} fill="#fbfbfa" stroke="#6f6d68" strokeWidth={0.35} />
            ) : null}
            {Array.from({ length: l.lines }, (_, i) => (
              <text
                key={i}
                x={x}
                y={l.y + lineH * i + lineH / 2 + fs * 0.36}
                fontSize={fs}
                textAnchor={anchor}
                fill="#1a1a1a"
                style={{ pointerEvents: 'none' }}
              >
                {value[i] ?? ''}
              </text>
            ))}
          </g>
        )
      })}

      {/* винты крепления панели по нижней кромке */}
      {[0.14, 0.5, 0.86].map((k) => (
        <circle
          key={k}
          cx={PANEL_W * k}
          cy={spec.slotHeight - 6}
          r={1.6}
          fill="#c9c7c1"
          stroke="#8a8781"
          strokeWidth={0.4}
        />
      ))}

      {spec.devices.map((d) => (
        <g key={d.id}>
          <DeviceShape d={d} />
          {showPositions ? (
            <text
              x={d.x + d.w / 2}
              y={d.y - 1}
              fontSize={2.6}
              textAnchor="middle"
              fill="#0a58a6"
              style={{ pointerEvents: 'none' }}
            >
              {slotNumber}.{d.id}
            </text>
          ) : null}
        </g>
      ))}
    </g>
  )
}
