import fontUrl from '../../assets/isocpeur-italic.ttf?url'
import logoUrl from '../../assets/logo-nt.png?url'
import type { PdfAssets } from '../pdf'

/**
 * Файлы оформления листа.
 *
 * Шрифт — ISOCPEUR Italic (тип Б с наклоном по ГОСТ 2.304, тот же, которым
 * оформлены выгрузки EPLAN); вложение разрешено (fsType = 0). Логотип — растр
 * из шаблона AI-пакета ООО «НТ», приведённый скриптом gen-frame.mjs к RGB без
 * альфы, чтобы вкладываться в PDF без перекодирования.
 */
let cache: Promise<PdfAssets> | null = null

async function bytes(url: string, what: string): Promise<Uint8Array> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`не удалось загрузить ${what}: ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

export function loadPdfAssets(): Promise<PdfAssets> {
  cache ??= Promise.all([bytes(fontUrl, 'чертёжный шрифт'), bytes(logoUrl, 'логотип')]).then(([font, logo]) => ({
    font,
    logo,
  }))
  return cache
}
