import { create } from 'zustand'
import type { Project, ProjectFile, Section } from './types'
import {
  cloneSection,
  isAllowed,
  makeProject,
  makeSection,
  makeSlot,
  nameAfterFile,
  normalizeProject,
} from './lib/project'
import { SLOT1_CODE } from './geometry'

const STORAGE_KEY = 'asutp-configurator-project'
/** Имя файла, с которым работали в прошлый раз; дескриптор файла в хранилище не переживает перезагрузку */
const FILE_KEY = 'asutp-configurator-file'

/**
 * Масштаб хранится в пикселях на миллиметр.
 * 100 % — натуральная величина на экране 96 dpi.
 */
export const PX_PER_MM = 96 / 25.4
export const MIN_SCALE = 0.05
export const MAX_SCALE = PX_PER_MM * 4
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

export type ViewMode = 'complex' | 'section'

export interface Selection {
  secUid: string
  slot: number
}

interface State {
  project: Project
  /** Файл проекта на диске; null — проект ещё не сохранялся и не открывался из файла */
  file: ProjectFile | null
  sel: Selection | null
  mode: ViewMode
  scale: number
  /** Масштаб подбирается под размер окна, пока пользователь не задал его вручную */
  autoFit: boolean
  /** Источник обмена местами: перетаскиваемый слот либо выбранный кнопкой */
  swapFrom: Selection | null
  /** Идёт перетаскивание модуля */
  dragging: boolean
  /** Слот под курсором при перетаскивании, если обмен с ним допустим */
  dragOver: Selection | null
  past: Project[]
  future: Project[]

  select: (sel: Selection | null) => void
  setMode: (m: ViewMode) => void
  setScale: (s: number) => void
  /** Установить масштаб, не выключая автоподбор (вызывается при подгонке под окно) */
  applyFitScale: (s: number) => void
  /** Вернуться к подгонке под окно */
  fit: () => void

  setModule: (secUid: string, slot: number, code: string) => void
  /** Начать обмен местами кнопкой: запомнить первый слот. null — отменить */
  armSwap: (sel: Selection | null) => void
  /** Начать перетаскивание модуля из слота */
  beginDrag: (sel: Selection) => void
  /** Отметить слот под курсором как цель перетаскивания */
  setDragOver: (sel: Selection | null) => void
  /** Завершить перетаскивание без обмена */
  endDrag: () => void
  /** Допустим ли обмен этих двух слотов */
  canSwap: (a: Selection, b: Selection) => boolean
  /** Поменять местами два слота вместе с их надписями */
  swapSlots: (a: Selection, b: Selection) => void
  setLabelLine: (secUid: string, slot: number, labelId: string, line: number, value: string) => void
  setProjectMeta: (patch: Partial<Project['project']>) => void

  addSection: () => void
  duplicateSection: (secUid: string, withLabels: boolean) => void
  removeSection: (secUid: string) => void
  moveSection: (secUid: string, dir: -1 | 1) => void

  /** Открыть проект из разобранного JSON; file — откуда он взят */
  loadProject: (raw: unknown, file?: ProjectFile | null) => void
  /** Проект записан в файл: запомнить его и при необходимости взять имя файла в наименование */
  markSaved: (file: ProjectFile) => void
  resetProject: () => void
  undo: () => void
  redo: () => void
}

function clone(p: Project): Project {
  return JSON.parse(JSON.stringify(p))
}

function persist(p: Project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* хранилище недоступно — не критично */
  }
}

function persistFile(f: ProjectFile | null) {
  try {
    if (f) localStorage.setItem(FILE_KEY, f.name)
    else localStorage.removeItem(FILE_KEY)
  } catch {
    /* хранилище недоступно — не критично */
  }
}

function restore(): { project: Project; file: ProjectFile | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = normalizeProject(JSON.parse(raw))
      persist(p) // сохраняем уже приведённое состояние
      const name = localStorage.getItem(FILE_KEY)
      return { project: p, file: name ? { name, handle: null } : null }
    }
  } catch {
    /* повреждённое хранилище игнорируем */
  }
  return { project: makeProject(), file: null }
}

const restored = restore()

/** Найти секцию по uid */
function findSection(p: Project, uid: string): Section | undefined {
  for (const complex of p.complexes) {
    const sec = complex.sections.find((s) => s.uid === uid)
    if (sec) return sec
  }
  return undefined
}

export const useStore = create<State>((set, get) => {
  /** Мутация проекта с записью в историю */
  const commit = (fn: (p: Project) => void) => {
    const { project, past } = get()
    const next = clone(project)
    fn(next)
    persist(next)
    set({ project: next, past: [...past, project].slice(-50), future: [] })
  }

  return {
    project: restored.project,
    file: restored.file,
    sel: null,
    mode: 'complex',
    scale: 0.28,
    autoFit: true,
    swapFrom: null,
    dragging: false,
    dragOver: null,
    past: [],
    future: [],

    select: (sel) => set({ sel }),
    setMode: (mode) => set({ mode, autoFit: true }),
    setScale: (scale) => set({ scale: clampScale(scale), autoFit: false }),
    applyFitScale: (scale) => set({ scale: clampScale(scale) }),
    fit: () => set({ autoFit: true }),

    setModule: (secUid, slot, code) => {
      if (slot === 1) return // слот 1 неизменяем
      if (!isAllowed(code, slot)) return
      commit((p) => {
        const sec = findSection(p, secUid)
        if (!sec) return
        const i = sec.slots.findIndex((s) => s.n === slot)
        if (i >= 0) sec.slots[i] = makeSlot(slot, code)
      })
    },

    armSwap: (sel) => set({ swapFrom: sel, dragging: false, dragOver: null }),
    beginDrag: (sel) => set({ swapFrom: sel, dragging: true, dragOver: null }),
    setDragOver: (sel) => set({ dragOver: sel }),
    endDrag: () => set({ swapFrom: null, dragging: false, dragOver: null }),

    /**
     * Обмен допустим, если каждый модуль разрешён в слоте, куда переезжает.
     * Панель слота 1 меняется только с панелью слота 1 другой секции: она
     * высотой 400 мм и в слоты 2…5 не встаёт.
     */
    canSwap: (a, b) => {
      if (a.secUid === b.secUid && a.slot === b.slot) return false
      const { project } = get()
      const sa = findSection(project, a.secUid)?.slots.find((s) => s.n === a.slot)
      const sb = findSection(project, b.secUid)?.slots.find((s) => s.n === b.slot)
      if (!sa || !sb) return false
      return isAllowed(sa.moduleCode, b.slot) && isAllowed(sb.moduleCode, a.slot)
    },

    /**
     * Обмен местами двух модулей. Переезжают и код модуля, и введённые надписи:
     * надписи принадлежат модулю, а не месту в секции.
     */
    swapSlots: (a, b) => {
      if (!get().canSwap(a, b)) return
      commit((p) => {
        const pa = findSection(p, a.secUid)?.slots.find((s) => s.n === a.slot)
        const pb = findSection(p, b.secUid)?.slots.find((s) => s.n === b.slot)
        if (!pa || !pb) return
        const code = pa.moduleCode
        const labels = pa.labels
        pa.moduleCode = pb.moduleCode
        pa.labels = pb.labels
        pb.moduleCode = code
        pb.labels = labels
      })
      set({ swapFrom: null, dragging: false, dragOver: null, sel: b })
    },

    setLabelLine: (secUid, slot, labelId, line, value) => {
      commit((p) => {
        const sec = findSection(p, secUid)
        const s = sec?.slots.find((s) => s.n === slot)
        if (!s) return
        const arr = s.labels[labelId] ? [...s.labels[labelId]] : []
        while (arr.length <= line) arr.push('')
        arr[line] = value
        s.labels[labelId] = arr
      })
    },

    setProjectMeta: (patch) => commit((p) => Object.assign(p.project, patch)),

    addSection: () =>
      commit((p) => {
        p.complexes[0].sections.push(makeSection())
      }),

    duplicateSection: (secUid, withLabels) =>
      commit((p) => {
        for (const complex of p.complexes) {
          const i = complex.sections.findIndex((s) => s.uid === secUid)
          if (i >= 0) {
            complex.sections.splice(i + 1, 0, cloneSection(complex.sections[i], withLabels))
            return
          }
        }
      }),

    removeSection: (secUid) => {
      const { sel } = get()
      commit((p) => {
        for (const complex of p.complexes) {
          const i = complex.sections.findIndex((s) => s.uid === secUid)
          if (i >= 0 && complex.sections.length > 1) complex.sections.splice(i, 1)
        }
      })
      if (sel?.secUid === secUid) set({ sel: null })
      if (get().swapFrom?.secUid === secUid) set({ swapFrom: null, dragging: false, dragOver: null })
    },

    moveSection: (secUid, dir) =>
      commit((p) => {
        for (const complex of p.complexes) {
          const i = complex.sections.findIndex((s) => s.uid === secUid)
          const j = i + dir
          if (i >= 0 && j >= 0 && j < complex.sections.length) {
            const [sec] = complex.sections.splice(i, 1)
            complex.sections.splice(j, 0, sec)
          }
        }
      }),

    loadProject: (raw, file = null) => {
      const p = normalizeProject(raw)
      if (file) p.project.name = nameAfterFile(p.project.name, file.name)
      persist(p)
      persistFile(file)
      set({ project: p, file, sel: null, swapFrom: null, dragging: false, dragOver: null, past: [], future: [] })
    },

    markSaved: (file) => {
      const { project } = get()
      const name = nameAfterFile(project.project.name, file.name)
      if (name !== project.project.name) {
        commit((p) => {
          p.project.name = name
        })
      }
      persistFile(file)
      set({ file })
    },

    resetProject: () => {
      const p = makeProject()
      persist(p)
      persistFile(null)
      set({ project: p, file: null, sel: null, swapFrom: null, dragging: false, dragOver: null, past: [], future: [] })
    },

    undo: () => {
      const { past, project, future } = get()
      if (!past.length) return
      const prev = past[past.length - 1]
      persist(prev)
      set({ project: prev, past: past.slice(0, -1), future: [project, ...future].slice(0, 50) })
    },

    redo: () => {
      const { past, project, future } = get()
      if (!future.length) return
      const next = future[0]
      persist(next)
      set({ project: next, past: [...past, project], future: future.slice(1) })
    },
  }
})

export { SLOT1_CODE }
