/**
 * Системные диалоги открытия и сохранения файла проекта.
 *
 * В Chrome и Edge — File System Access API: окна «Открыть» и «Сохранить как», где пользователь
 * сам выбирает папку и имя файла. Где API нет (Firefox, а также http-адрес кроме localhost) —
 * вызывающий код показывает `<input type="file">` и отдаёт файл обычной загрузкой браузера.
 */

type StartIn = FileSystemHandle | 'desktop' | 'documents' | 'downloads'

interface PickerOptions {
  /** Ключ, под которым браузер запоминает последнюю папку диалога */
  id?: string
  /** Папка, в которой открывается диалог; для дескриптора файла — его папка */
  startIn?: StartIn
  types?: { description?: string; accept: Record<string, string[]> }[]
  excludeAcceptAllOption?: boolean
}

/** В lib.dom TypeScript этих методов нет — объявляем сами */
interface FsWindow {
  showOpenFilePicker?: (o?: PickerOptions & { multiple?: boolean }) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (o?: PickerOptions & { suggestedName?: string }) => Promise<FileSystemFileHandle>
}

const fs = () => window as unknown as FsWindow

const PICKER_ID = 'nt53-project'
const JSON_TYPES = [{ description: 'Проект конфигуратора НТ53', accept: { 'application/json': ['.json'] } }]

/** Доступны ли системные диалоги (Chrome, Edge; только https или localhost) */
export function hasFileDialogs(): boolean {
  return typeof fs().showSaveFilePicker === 'function' && typeof fs().showOpenFilePicker === 'function'
}

/** Пользователь закрыл диалог — это не ошибка */
function isCancel(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

/** Диалог открытия файла проекта; открывается в папке текущего файла. null — отменён */
export async function pickOpenFile(near: FileSystemFileHandle | null): Promise<FileSystemFileHandle | null> {
  try {
    const [handle] = await fs().showOpenFilePicker!({ id: PICKER_ID, startIn: near ?? undefined, types: JSON_TYPES })
    return handle ?? null
  } catch (e) {
    if (isCancel(e)) return null
    throw e
  }
}

/** Диалог «Сохранить как» с предложенным именем; открывается в папке текущего файла. null — отменён */
export async function pickSaveFile(
  suggestedName: string,
  near: FileSystemFileHandle | null,
): Promise<FileSystemFileHandle | null> {
  try {
    return await fs().showSaveFilePicker!({ id: PICKER_ID, suggestedName, startIn: near ?? undefined, types: JSON_TYPES })
  } catch (e) {
    if (isCancel(e)) return null
    throw e
  }
}

/** Записать текст в выбранный файл целиком */
export async function writeTextFile(handle: FileSystemFileHandle, text: string): Promise<void> {
  const w = await handle.createWritable()
  await w.write(text)
  await w.close()
}
