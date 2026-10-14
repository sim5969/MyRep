import { useRef, useState } from 'react'
import { buildDxf } from '../export/dxf'
import { download, downloadBytes, safeName } from '../export/download'
import { buildFacadePdf } from '../export/pdf'
import { loadPdfAssets } from '../export/pdf/assets'
import { collectLabels, labelsToCsv } from '../export/labels'
import { exportSpecXlsx } from '../export/spec'
import { sectionId } from '../lib/designation'
import { hasFileDialogs, pickOpenFile, pickSaveFile, writeTextFile } from '../lib/file-dialogs'
import { nameAfterFile } from '../lib/project'
import { PX_PER_MM, useStore } from '../store'
import type { Project, ProjectFile } from '../types'

interface Props {
  showPositions: boolean
  setShowPositions: (v: boolean) => void
}

export function Toolbar({ showPositions, setShowPositions }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const project = useStore((s) => s.project)
  const file = useStore((s) => s.file)
  const sel = useStore((s) => s.sel)
  const mode = useStore((s) => s.mode)
  const scale = useStore((s) => s.scale)
  const autoFit = useStore((s) => s.autoFit)
  const setMode = useStore((s) => s.setMode)
  const setScale = useStore((s) => s.setScale)
  const fit = useStore((s) => s.fit)
  const addSection = useStore((s) => s.addSection)
  const duplicateSection = useStore((s) => s.duplicateSection)
  const removeSection = useStore((s) => s.removeSection)
  const moveSection = useStore((s) => s.moveSection)
  const swapFrom = useStore((s) => s.swapFrom)
  const armSwap = useStore((s) => s.armSwap)
  const setProjectMeta = useStore((s) => s.setProjectMeta)
  const loadProject = useStore((s) => s.loadProject)
  const markSaved = useStore((s) => s.markSaved)
  const resetProject = useStore((s) => s.resetProject)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)

  const hasSel = sel !== null

  /** Текст файла проекта; наименование согласовано с именем файла, под которым он сохраняется */
  function projectJson(fileName: string): string {
    const name = nameAfterFile(project.project.name, fileName)
    return JSON.stringify({ ...project, project: { ...project.project, name } }, null, 2)
  }

  /**
   * Сохранить — всегда через окно «Сохранить как»: пользователь выбирает папку и имя.
   * Диалог открывается в папке текущего файла и предлагает его имя. Без File System Access API
   * (Firefox) файл уходит обычной загрузкой браузера.
   */
  async function save() {
    const suggested = file?.name ?? `${safeName(project.project.name)}.json`
    try {
      if (!hasFileDialogs()) {
        download(suggested, projectJson(suggested), 'application/json')
        markSaved({ name: suggested, handle: null })
        return
      }
      const handle = await pickSaveFile(suggested, file?.handle ?? null)
      if (!handle) return // отменено
      await writeTextFile(handle, projectJson(handle.name))
      markSaved({ name: handle.name, handle })
    } catch (e) {
      alert(`Не удалось сохранить файл: ${(e as Error).message}`)
    }
  }

  /** Секции, попадающие в выгрузку: в режиме «Секция» — только выбранная */
  function exportScope() {
    const complex = project.complexes[0]
    const picked = mode === 'section' && sel ? complex.sections.filter((s) => s.uid === sel.secUid) : complex.sections
    return { complex, secs: picked.length ? picked : complex.sections }
  }

  /** Имя выгрузки одной секции дополняется её обозначением: SEC2 */
  function scopeSuffix(complex: Project['complexes'][number], secs: Project['complexes'][number]['sections']) {
    return secs.length === 1 ? ` ${sectionId(complex.sections.indexOf(secs[0]))}` : ''
  }

  function exportDxf() {
    const { complex, secs } = exportScope()
    const suffix = scopeSuffix(complex, secs)
    download(`${safeName(project.project.name)} фасад${suffix}.dxf`, buildDxf(complex, secs), 'application/dxf')
  }

  function exportLabels() {
    const { complex, secs } = exportScope()
    download(
      `${safeName(project.project.name)} надписи.csv`,
      labelsToCsv(project, collectLabels(complex, secs)),
      'text/csv',
    )
  }

  /** Альбом А3 в фирменной рамке с большим штампом */
  async function exportPdf() {
    const { complex, secs } = exportScope()
    setBusy(true)
    try {
      const bytes = await buildFacadePdf(project, complex, secs, await loadPdfAssets())
      downloadBytes(
        `${safeName(project.project.name)} фасад${scopeSuffix(complex, secs)}.pdf`,
        bytes,
        'application/pdf',
      )
    } catch (e) {
      alert(`Не удалось собрать PDF: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function exportSpec() {
    const { complex, secs } = exportScope()
    await exportSpecXlsx(project, complex, secs, `${safeName(project.project.name)} спецификация.xlsx`)
  }

  async function open(f: File, source: ProjectFile) {
    try {
      loadProject(JSON.parse(await f.text()), source)
    } catch (e) {
      alert(`Не удалось открыть файл: ${(e as Error).message}`)
    }
  }

  /** Открыть — системный диалог; где его нет, скрытый <input type="file"> */
  async function openDialog() {
    if (!hasFileDialogs()) {
      fileRef.current?.click()
      return
    }
    try {
      const handle = await pickOpenFile(file?.handle ?? null)
      if (handle) await open(await handle.getFile(), { name: handle.name, handle })
    } catch (e) {
      alert(`Не удалось открыть файл: ${(e as Error).message}`)
    }
  }

  return (
    <header className="toolbar">
      <div className="brand">
        Конфигуратор секций АСУ ТП <span className="mono">НТ53</span>
      </div>

      <input
        className="project-name"
        value={project.project.name}
        onChange={(e) => setProjectMeta({ name: e.target.value })}
        title="Наименование проекта — графа штампа «Наименование объекта». Пока не задано, берётся из имени файла"
      />
      <span
        className="file mono"
        title={file ? `Файл проекта: ${file.name}` : 'Проект ещё не сохранён в файл — нажмите «Сохранить»'}
      >
        {file ? file.name : 'файл не сохранён'}
      </span>

      <div className="group">
        <button onClick={addSection}>+ Секция</button>
        <button disabled={!hasSel} onClick={() => sel && duplicateSection(sel.secUid, true)}>
          Копия
        </button>
        <button
          disabled={!hasSel}
          onClick={() => sel && duplicateSection(sel.secUid, false)}
          title="Копия секции без надписей"
        >
          Копия без надписей
        </button>
        <button disabled={!hasSel} onClick={() => sel && moveSection(sel.secUid, -1)}>
          ←
        </button>
        <button disabled={!hasSel} onClick={() => sel && moveSection(sel.secUid, 1)}>
          →
        </button>
        <button disabled={!hasSel} onClick={() => sel && removeSection(sel.secUid)}>
          Удалить
        </button>
      </div>

      <div className="group">
        <button
          className={swapFrom ? 'on' : ''}
          disabled={!hasSel && !swapFrom}
          onClick={() => armSwap(swapFrom ? null : sel)}
          title="Поменять модули местами вместе с надписями: выбрать слот, нажать кнопку, щёлкнуть второй слот. То же перетаскиванием модуля мышью"
        >
          {swapFrom ? `Обмен: слот ${swapFrom.slot} → выберите второй` : 'Поменять местами'}
        </button>
      </div>

      <div className="group">
        <button disabled={!canUndo} onClick={undo}>
          Отменить
        </button>
        <button disabled={!canRedo} onClick={redo}>
          Повторить
        </button>
      </div>

      <div className="group">
        <button
          className={mode === 'complex' ? 'on' : ''}
          onClick={() => setMode('complex')}
          title="Комплекс секций управления целиком"
        >
          КСУ
        </button>
        <button className={mode === 'section' ? 'on' : ''} onClick={() => setMode('section')} disabled={!hasSel}>
          Секция
        </button>
        <button onClick={() => setScale(scale / 1.25)} title="Уменьшить (−)">
          −
        </button>
        <span className="zoom" title="100 % — натуральная величина">
          {Math.round((scale / PX_PER_MM) * 100)} %
        </span>
        <button onClick={() => setScale(scale * 1.25)} title="Увеличить (+)">
          +
        </button>
        <button className={autoFit ? 'on' : ''} onClick={fit} title="Вписать в окно (0)">
          Вписать
        </button>
        <button onClick={() => setScale(PX_PER_MM)} title="Натуральная величина (1)">
          1:1
        </button>
        <label className="check">
          <input type="checkbox" checked={showPositions} onChange={(e) => setShowPositions(e.target.checked)} />
          Позиции
        </label>
      </div>

      <div className="group">
        <button
          disabled={busy}
          onClick={exportPdf}
          title="Альбом А3: лист комплекса и листы на каждую секцию, фирменная рамка ООО «НТ» с большим штампом"
        >
          {busy ? 'PDF…' : 'PDF А3'}
        </button>
        <button onClick={exportDxf} title="Вид на фасад в DXF, размеры в миллиметрах">
          DXF
        </button>
        <button onClick={exportLabels} title="Таблица надписей для печати шильдов, CSV для Excel">
          Надписи
        </button>
        <button onClick={exportSpec} title="Спецификация XLSX: состав по секциям, сводная, приборы, надписи">
          Спецификация
        </button>
      </div>

      <div className="group right">
        <button onClick={openDialog} title="Открыть файл проекта (.json)">
          Открыть
        </button>
        <button onClick={save} title="Сохранить проект в файл: откроется окно выбора папки и имени">
          Сохранить
        </button>
        <button
          onClick={() => {
            if (confirm('Создать новый проект? Текущий будет потерян, если он не сохранён.')) resetProject()
          }}
        >
          Новый
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void open(f, { name: f.name, handle: null })
            e.target.value = ''
          }}
        />
      </div>
    </header>
  )
}
