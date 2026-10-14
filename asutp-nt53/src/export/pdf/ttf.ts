/**
 * Минимальный разбор шрифта TrueType: то, что нужно для вложения шрифта в PDF
 * как CIDFontType2 с кодировкой Identity-H.
 *
 * Из файла берутся только метрики и таблица символов; сам файл вкладывается в
 * PDF целиком, поэтому нумерация глифов остаётся исходной (CIDToGIDMap Identity).
 */

interface Table {
  off: number
  len: number
}

export interface TtfFont {
  /** Файл шрифта как есть — уходит в поток FontFile2 */
  data: Uint8Array
  postScriptName: string
  unitsPerEm: number
  /** Габарит шрифта в тысячных долях кегля */
  bbox: [number, number, number, number]
  italicAngle: number
  ascent: number
  descent: number
  capHeight: number
  /** Высота прописной буквы в долях кегля: по ней считается кегль из высоты по ГОСТ */
  capRatio: number
  numGlyphs: number
  /** Номер глифа для символа Unicode. 0 — глифа нет */
  gid(cp: number): number
  /** Ширина глифа в тысячных долях кегля */
  advance(gid: number): number
}

export function parseTtf(data: Uint8Array): TtfFont {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const u8 = (o: number) => dv.getUint8(o)
  const u16 = (o: number) => dv.getUint16(o)
  const i16 = (o: number) => dv.getInt16(o)
  const u32 = (o: number) => dv.getUint32(o)

  const tag = u32(0)
  // 0x00010000 — TrueType, 'true'/'ttcf' и OpenType с CFF здесь не поддерживаются
  if (tag !== 0x00010000 && tag !== 0x74727565) {
    throw new Error('Поддерживается только TrueType с таблицей glyf')
  }
  const tables: Record<string, Table> = {}
  const numTables = u16(4)
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16
    const name = String.fromCharCode(u8(o), u8(o + 1), u8(o + 2), u8(o + 3))
    tables[name] = { off: u32(o + 8), len: u32(o + 12) }
  }
  const need = (n: string) => {
    const t = tables[n]
    if (!t) throw new Error(`В шрифте нет таблицы ${n}`)
    return t.off
  }

  const head = need('head')
  const unitsPerEm = u16(head + 18) || 1000
  const k = 1000 / unitsPerEm
  const bbox: [number, number, number, number] = [
    Math.round(i16(head + 36) * k),
    Math.round(i16(head + 38) * k),
    Math.round(i16(head + 40) * k),
    Math.round(i16(head + 42) * k),
  ]

  const numGlyphs = u16(need('maxp') + 4)
  const longLoca = u16(head + 50) === 1
  const post = tables.post ? u32(tables.post.off + 4) / 65536 : 0
  const italicAngle = Math.round(post * 100) / 100

  const os2 = tables['OS/2']?.off
  const ver = os2 !== undefined ? u16(os2) : 0
  const ascent = os2 !== undefined ? Math.round(i16(os2 + 68) * k) : 800
  const descent = os2 !== undefined ? Math.round(i16(os2 + 70) * k) : -200

  // --- имя PostScript (nameID 6) -------------------------------------------
  let postScriptName = 'Embedded'
  if (tables.name) {
    const nm = tables.name.off
    const count = u16(nm + 2)
    const strings = nm + u16(nm + 4)
    for (let i = 0; i < count; i++) {
      const r = nm + 6 + i * 12
      if (u16(r + 6) !== 6) continue
      const plat = u16(r)
      const len = u16(r + 8)
      const off = strings + u16(r + 10)
      let s = ''
      if (plat === 3 || plat === 0) {
        for (let j = 0; j < len; j += 2) s += String.fromCharCode(u16(off + j))
      } else {
        for (let j = 0; j < len; j++) s += String.fromCharCode(u8(off + j))
      }
      // в имени PostScript допустимы только печатные ASCII без разделителей
      s = s.replace(/[^\x21-\x7e]|[[\]{}()<>/%#]/g, '')
      if (s) {
        postScriptName = s
        break
      }
    }
  }

  /** Верх контура глифа в единицах шрифта */
  const glyphTop = (g: number): number | null => {
    const loca = tables.loca?.off
    const glyf = tables.glyf?.off
    if (loca === undefined || glyf === undefined || g <= 0 || g >= numGlyphs) return null
    const from = longLoca ? u32(loca + g * 4) : u16(loca + g * 2) * 2
    const to = longLoca ? u32(loca + (g + 1) * 4) : u16(loca + (g + 1) * 2) * 2
    return to > from ? i16(glyf + from + 8) : null // yMax в заголовке глифа
  }

  // --- ширины глифов (hmtx) -------------------------------------------------
  const numHMetrics = u16(need('hhea') + 34)
  const hmtx = need('hmtx')
  const advance = (gid: number) => {
    const i = Math.min(Math.max(gid, 0), Math.max(numHMetrics - 1, 0))
    return Math.round(u16(hmtx + i * 4) * k)
  }

  // --- таблица символов (cmap) ---------------------------------------------
  const cmap = need('cmap')
  const subs: { plat: number; enc: number; off: number; fmt: number }[] = []
  for (let i = 0, n = u16(cmap + 2); i < n; i++) {
    const r = cmap + 4 + i * 8
    const off = cmap + u32(r + 4)
    subs.push({ plat: u16(r), enc: u16(r + 2), off, fmt: u16(off) })
  }
  const pick =
    subs.find((s) => s.plat === 3 && s.enc === 10 && s.fmt === 12) ??
    subs.find((s) => s.plat === 3 && s.enc === 1 && s.fmt === 4) ??
    subs.find((s) => s.plat === 0 && (s.fmt === 4 || s.fmt === 12)) ??
    subs.find((s) => s.fmt === 4 || s.fmt === 12)
  if (!pick) throw new Error('В шрифте нет подтаблицы cmap формата 4 или 12')

  const cache = new Map<number, number>()
  const lookup4 = (cp: number): number => {
    if (cp > 0xffff) return 0
    const o = pick.off
    const segX2 = u16(o + 6)
    const endO = o + 14
    const startO = endO + segX2 + 2
    const deltaO = startO + segX2
    const rangeO = deltaO + segX2
    for (let i = 0; i < segX2 / 2; i++) {
      if (cp > u16(endO + i * 2)) continue
      const start = u16(startO + i * 2)
      if (cp < start) return 0
      const ro = u16(rangeO + i * 2)
      if (ro === 0) return (cp + i16(deltaO + i * 2)) & 0xffff
      const g = u16(rangeO + i * 2 + ro + (cp - start) * 2)
      return g === 0 ? 0 : (g + i16(deltaO + i * 2)) & 0xffff
    }
    return 0
  }
  const lookup12 = (cp: number): number => {
    const o = pick.off
    const groups = u32(o + 12)
    let lo = 0
    let hi = groups - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const g = o + 16 + mid * 12
      const first = u32(g)
      const last = u32(g + 4)
      if (cp < first) hi = mid - 1
      else if (cp > last) lo = mid + 1
      else return u32(g + 8) + (cp - first)
    }
    return 0
  }

  const gid = (cp: number): number => {
    const hit = cache.get(cp)
    if (hit !== undefined) return hit
    const g = pick.fmt === 12 ? lookup12(cp) : lookup4(cp)
    const val = g < numGlyphs ? g : 0
    cache.set(cp, val)
    return val
  }

  /**
   * Высота прописной буквы. В OS/2 версии ниже 2 графы sCapHeight нет (так у
   * ISOCPEUR Italic), поэтому берём верх контура «H»: от этой величины зависит
   * соответствие кегля размеру шрифта по ГОСТ 2.304.
   */
  const capRaw = os2 !== undefined && ver >= 2 ? i16(os2 + 88) : 0
  const capHeight = Math.round((capRaw || glyphTop(gid(0x48)) || glyphTop(gid(0x41d)) || (ascent / k) * 0.7) * k)

  return {
    data,
    postScriptName,
    unitsPerEm,
    bbox,
    italicAngle,
    ascent,
    descent,
    capHeight,
    capRatio: capHeight / 1000,
    numGlyphs,
    gid,
    advance,
  }
}
