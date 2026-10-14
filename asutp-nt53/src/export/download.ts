/** Сохранение сформированного файла на диск пользователя */
export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Сохранение двоичного файла (PDF, XLSX) */
export function downloadBytes(filename: string, bytes: Uint8Array, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Имя файла без символов, запрещённых в Windows */
export function safeName(s: string): string {
  return (s || 'проект').replace(/[\\/:*?"<>|]/g, '_').trim()
}
