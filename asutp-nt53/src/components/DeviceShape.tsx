import type { DeviceSpec, LampColor } from '../types'

const LAMP_FILL: Record<LampColor, string> = {
  green: '#35c04a',
  red: '#e03030',
  blue: '#3a86d8',
  yellow: '#efc41f',
  white: '#f2f2ef',
}

/** Схематичное изображение прибора на лицевой панели. Координаты в мм. */
export function DeviceShape({ d }: { d: DeviceSpec }) {
  const cx = d.x + d.w / 2
  const cy = d.y + d.h / 2
  const caption = d.caption ? (
    <text
      x={cx}
      y={d.y + d.h + 4.6}
      fontSize={2.4}
      textAnchor="middle"
      fill="#333"
      style={{ pointerEvents: 'none' }}
    >
      {d.caption}
    </text>
  ) : null

  switch (d.type) {
    case 'lamp': {
      const r = Math.min(d.w, d.h) / 2
      // подсветка внутри переключателя: полупрозрачная линза поверх рукоятки
      if (d.builtIn) {
        return (
          <g>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill={LAMP_FILL[d.color ?? 'white']}
              opacity={0.55}
              stroke="#3a3a3a"
              strokeWidth={0.5}
              style={{ pointerEvents: 'none' }}
            />
            {caption}
          </g>
        )
      }
      return (
        <g>
          <circle cx={cx} cy={cy} r={r} fill={LAMP_FILL[d.color ?? 'white']} stroke="#3a3a3a" strokeWidth={0.7} />
          <circle cx={cx} cy={cy} r={r * 0.62} fill="#ffffff" opacity={0.25} />
          {caption}
        </g>
      )
    }
    case 'switch': {
      const r = Math.min(d.w, d.h) / 2
      return (
        <g>
          <circle cx={cx} cy={cy} r={r} fill="#dcdcd8" stroke="#3a3a3a" strokeWidth={0.7} />
          <rect x={cx - 1.6} y={cy - r * 0.85} width={3.2} height={r * 1.35} rx={1.2} fill="#1d1d1d" />
          {caption}
        </g>
      )
    }
    case 'indicator': {
      const pad = Math.min(d.h * 0.16, 6)
      return (
        <g>
          <rect x={d.x} y={d.y} width={d.w} height={d.h} rx={1.5} fill="#2b2b2b" stroke="#111" strokeWidth={0.6} />
          <rect
            x={d.x + pad}
            y={d.y + pad}
            width={d.w - pad * 2}
            height={d.h - pad * 2}
            rx={1}
            fill="#151515"
            stroke="#000"
            strokeWidth={0.4}
          />
          <text
            x={cx}
            y={cy + (d.h - pad * 2) * 0.22}
            fontSize={(d.h - pad * 2) * 0.62}
            textAnchor="middle"
            fill="#ff3b30"
            fontFamily="'Courier New', monospace"
            style={{ pointerEvents: 'none' }}
          >
            88.8
          </text>
          {caption}
        </g>
      )
    }
    case 'opPanel': {
      const b = 5
      return (
        <g>
          <rect x={d.x} y={d.y} width={d.w} height={d.h} rx={2} fill="#232323" stroke="#111" strokeWidth={0.6} />
          <rect
            x={d.x + b}
            y={d.y + b}
            width={d.w - b * 2}
            height={d.h - b * 2}
            fill="#e8eef6"
            stroke="#7a8896"
            strokeWidth={0.4}
          />
          <line
            x1={d.x + b + 4}
            y1={d.y + b + 8}
            x2={d.x + d.w - b - 4}
            y2={d.y + b + 8}
            stroke="#9fb0c2"
            strokeWidth={0.8}
          />
          {caption}
        </g>
      )
    }
    case 'meter': {
      const r = Math.min(d.w, d.h) * 0.38
      return (
        <g>
          <rect x={d.x} y={d.y} width={d.w} height={d.h} rx={1.5} fill="#f4f4f0" stroke="#3a3a3a" strokeWidth={0.7} />
          <path
            d={`M ${cx - r} ${cy + r * 0.3} A ${r} ${r} 0 0 1 ${cx + r} ${cy + r * 0.3}`}
            fill="none"
            stroke="#555"
            strokeWidth={0.8}
          />
          <line x1={cx} y1={cy + r * 0.5} x2={cx + r * 0.6} y2={cy - r * 0.5} stroke="#c02020" strokeWidth={1} />
          {caption}
        </g>
      )
    }
    default: {
      const n = d.displays ?? 0
      const dispW = d.w - 12
      const dispH = Math.min(18, (d.h - 22) / Math.max(n, 1) - 6)
      return (
        <g>
          <rect x={d.x} y={d.y} width={d.w} height={d.h} rx={1.5} fill="#f6f6f3" stroke="#3a3a3a" strokeWidth={0.7} />
          {d.name ? (
            <text
              x={d.x + 5}
              y={d.y + 7}
              fontSize={4}
              textAnchor="start"
              fill="#2a4a80"
              fontWeight={700}
              style={{ pointerEvents: 'none' }}
            >
              {d.name}
            </text>
          ) : null}
          {Array.from({ length: n }, (_, i) => (
            <g key={i}>
              <rect
                x={d.x + 6}
                y={d.y + 12 + i * (dispH + 24)}
                width={dispW}
                height={dispH}
                fill={d.displayColor ?? '#7fd4ea'}
                stroke="#5a5a5a"
                strokeWidth={0.4}
              />
              <text
                x={cx}
                y={d.y + 12 + i * (dispH + 24) + dispH * 0.78}
                fontSize={dispH * 0.8}
                textAnchor="middle"
                fill="#0d5a20"
                fontFamily="'Courier New', monospace"
                style={{ pointerEvents: 'none' }}
              >
                0.00
              </text>
            </g>
          ))}
          {caption}
        </g>
      )
    }
  }
}
