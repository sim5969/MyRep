import { parseTtf, type TtfFont } from './ttf'

/**
 * Сборка PDF без внешних библиотек.
 *
 * Единицы страницы — миллиметры, ось Y направлена вверх от левого нижнего угла:
 * в поток содержимого первым делом пишется преобразование мм → пункты, поэтому
 * все координаты и толщины линий задаются в миллиметрах.
 *
 * Кириллица выводится вложенным шрифтом TrueType (CIDFontType2, Identity-H):
 * в строке идут номера глифов, поэтому кодовая страница не участвует, а текст
 * остаётся выделяемым и находится поиском благодаря карте ToUnicode.
 */

const PT_PER_MM = 72 / 25.4

const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}

/** Строка PDF из номеров глифов */
function hex(codes: number[]): string {
  return codes.map((c) => c.toString(16).toUpperCase().padStart(4, '0')).join('')
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null // без сжатия файл больше, но корректен
  }
}

const latin1 = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

export type Align = 'left' | 'center' | 'right'

/** Один поток содержимого страницы */
interface Stream {
  ops: string[]
  lw: number
}

/** Страница: примитивы в миллиметрах, начало координат — левый нижний угол */
export class PdfPage {
  /** Оформление листа (рамка со штампом) и собственно чертёж — разные потоки */
  private readonly streams: Record<'frame' | 'body', Stream> = {
    frame: { ops: [], lw: -1 },
    body: { ops: [], lw: -1 },
  }
  private target: 'frame' | 'body' = 'body'

  constructor(
    private readonly doc: PdfDoc,
    readonly w: number,
    readonly h: number,
  ) {}

  private get ops(): string[] {
    return this.streams[this.target].ops
  }

  /**
   * Рисовать в потоке оформления листа. Разделение потоков позволяет проверке
   * отличать рамку, которая доходит до кромки листа, от чертежа, который должен
   * оставаться внутри рамки.
   */
  sheetFrame(draw: () => void) {
    this.target = 'frame'
    try {
      draw()
    } finally {
      this.target = 'body'
    }
  }

  private width(v: number) {
    const s = this.streams[this.target]
    if (v === s.lw) return
    s.ops.push(`${n(v)} w`)
    s.lw = v
  }

  line(x1: number, y1: number, x2: number, y2: number, lw: number) {
    this.width(lw)
    this.ops.push(`${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`)
  }

  rect(x: number, y: number, w: number, h: number, lw: number) {
    this.width(lw)
    this.ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re S`)
  }

  /** Окружность четырьмя кубическими кривыми */
  circle(cx: number, cy: number, r: number, lw: number) {
    if (r <= 0) return
    this.width(lw)
    const k = r * 0.5523
    const o = this.ops
    o.push(`${n(cx + r)} ${n(cy)} m`)
    o.push(`${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c`)
    o.push(`${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} c`)
    o.push(`${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c`)
    o.push(`${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} c S`)
  }

  /** Ширина строки при заданной высоте прописной буквы, мм */
  textWidth(s: string, cap: number): number {
    const f = this.doc.font
    const size = cap / f.capRatio
    let sum = 0
    for (const ch of s) sum += f.advance(f.gid(ch.codePointAt(0)!))
    return (sum / 1000) * size
  }

  /**
   * Надпись. cap — высота прописной буквы (размер шрифта по ГОСТ 2.304),
   * y — базовая линия, align — выключка относительно x, rot — поворот в градусах.
   */
  text(x: number, y: number, cap: number, s: string, align: Align = 'left', rot = 0) {
    if (!s) return
    const f = this.doc.font
    const size = cap / f.capRatio
    const codes: number[] = []
    for (const ch of s) {
      const cp = ch.codePointAt(0)!
      // отсутствующий глиф заменяем пробелом, чтобы не рисовать «квадрат»
      const g = f.gid(cp) || f.gid(32)
      codes.push(g)
      this.doc.useGlyph(g, cp)
    }
    const w = align === 'left' ? 0 : this.textWidth(s, cap)
    const dx = align === 'left' ? 0 : align === 'center' ? -w / 2 : -w
    if (!rot) {
      this.ops.push(`BT /F1 ${n(size)} Tf ${n(x + dx)} ${n(y)} Td <${hex(codes)}> Tj ET`)
      return
    }
    const a = (rot * Math.PI) / 180
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    this.ops.push(
      `BT /F1 ${n(size)} Tf ${n(cos)} ${n(sin)} ${n(-sin)} ${n(cos)} ${n(x + dx * cos)} ${n(y + dx * sin)} Tm` +
        ` <${hex(codes)}> Tj ET`,
    )
  }

  /** Надпись, отцентрованная по высоте относительно y */
  textMid(x: number, y: number, cap: number, s: string, align: Align = 'left', rot = 0) {
    this.text(x, y - cap / 2, cap, s, align, rot)
  }

  /** Растр по имени, объявленному в документе: прямоугольник по левому нижнему углу */
  image(name: string, x: number, y: number, w: number, h: number) {
    this.doc.useImage(name)
    this.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(y)} cm /${name} Do Q`)
  }

  /** Строка, обрезанная по ширине с многоточием */
  fit(s: string, cap: number, w: number): string {
    if (this.textWidth(s, cap) <= w) return s
    let out = s
    while (out.length > 1 && this.textWidth(`${out}…`, cap) > w) out = out.slice(0, -1)
    return `${out}…`
  }

  /**
   * Потоки содержимого: сначала оформление листа, затем чертёж.
   * Потоки страницы работают в общем графическом состоянии, поэтому каждый
   * замыкается в q…Q — иначе преобразование мм → пункты применилось бы дважды.
   */
  contents(): string[] {
    const head = `q ${n(PT_PER_MM)} 0 0 ${n(PT_PER_MM)} 0 0 cm`
    return [this.streams.frame, this.streams.body]
      .filter((s) => s.ops.length)
      .map((s) => [head, '1 J 1 j', ...s.ops, 'Q'].join('\n'))
  }
}

export interface PdfInfo {
  title: string
  author: string
  /** Дата в формате ГГГГ-ММ-ДД */
  date: string
}

/** Растр страницы: данные PNG проходят в PDF без перекодирования */
interface PdfImage {
  w: number
  h: number
  /** Склеенные блоки IDAT: поток Flate с предсказателем PNG */
  data: Uint8Array
  /** Число цветовых составляющих: 3 — RGB, 1 — серый */
  colors: number
}

/** Разбор PNG: размеры и поток пикселей без распаковки */
function readPng(png: Uint8Array): PdfImage {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength)
  if (dv.getUint32(0) !== 0x89504e47) throw new Error('логотип не в формате PNG')
  let at = 8
  let head: { w: number; h: number; depth: number; color: number; interlace: number } | null = null
  const parts: Uint8Array[] = []
  while (at + 8 <= png.length) {
    const len = dv.getUint32(at)
    const type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7])
    const body = png.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      head = {
        w: dv.getUint32(at + 8),
        h: dv.getUint32(at + 12),
        depth: png[at + 16],
        color: png[at + 17],
        interlace: png[at + 20],
      }
    } else if (type === 'IDAT') parts.push(body)
    else if (type === 'IEND') break
    at += 12 + len
  }
  if (!head) throw new Error('в PNG нет заголовка IHDR')
  if (head.depth !== 8 || head.interlace !== 0 || (head.color !== 2 && head.color !== 0)) {
    throw new Error('в PDF вкладывается только PNG 8 бит RGB или серый без интерлейса')
  }
  const size = parts.reduce((s, p) => s + p.length, 0)
  const data = new Uint8Array(size)
  let off = 0
  for (const p of parts) {
    data.set(p, off)
    off += p.length
  }
  return { w: head.w, h: head.h, data, colors: head.color === 2 ? 3 : 1 }
}

export class PdfDoc {
  readonly font: TtfFont
  private pages: PdfPage[] = []
  private glyphs = new Map<number, number>()
  private images = new Map<string, PdfImage>()
  private usedImages = new Set<string>()

  constructor(fontData: Uint8Array) {
    this.font = parseTtf(fontData)
  }

  /** Запомнить глиф: попадёт в массив ширин и в карту ToUnicode */
  useGlyph(gid: number, cp: number) {
    if (!this.glyphs.has(gid)) this.glyphs.set(gid, cp)
  }

  /** Объявить растр под именем ресурса (например Im0) */
  addImage(name: string, png: Uint8Array) {
    this.images.set(name, readPng(png))
  }

  useImage(name: string) {
    if (!this.images.has(name)) throw new Error(`растр ${name} не объявлен в документе`)
    this.usedImages.add(name)
  }

  addPage(w: number, h: number): PdfPage {
    const p = new PdfPage(this, w, h)
    this.pages.push(p)
    return p
  }

  get pageCount(): number {
    return this.pages.length
  }

  async build(info: PdfInfo): Promise<Uint8Array> {
    const objs: (string | Uint8Array)[][] = []
    /** Зарезервировать номер объекта */
    const reserve = () => {
      objs.push([])
      return objs.length
    }
    const put = (id: number, ...parts: (string | Uint8Array)[]) => {
      objs[id - 1] = parts
    }

    const catalog = reserve()
    const pagesId = reserve()
    const fontId = reserve()
    const cidId = reserve()
    const descId = reserve()
    const fileId = reserve()
    const toUniId = reserve()
    const infoId = reserve()
    const pageIds = this.pages.map(() => reserve())
    const contentIds = this.pages.map((p) => p.contents().map(() => reserve()))
    const imageIds = new Map([...this.usedImages].map((name) => [name, reserve()]))

    /** Поток: сжимается, если сжатие доступно в среде исполнения */
    const stream = async (body: Uint8Array, dict: string[]) => {
      const packed = await deflate(body)
      const data = packed ?? body
      const d = [...dict, `/Length ${data.length}`]
      if (packed) d.push('/Filter /FlateDecode')
      return [`<< ${d.join(' ')} >>\nstream\n`, data, '\nendstream']
    }

    const xobjects = [...imageIds].map(([name, id]) => `/${name} ${id} 0 R`).join(' ')
    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i]
      const streams = p.contents()
      put(
        pageIds[i],
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(p.w * PT_PER_MM)} ${n(p.h * PT_PER_MM)}]` +
          ` /Resources << /Font << /F1 ${fontId} 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >>` +
          ` /Contents [${contentIds[i].map((id) => `${id} 0 R`).join(' ')}] >>`,
      )
      for (let k = 0; k < streams.length; k++) {
        put(contentIds[i][k], ...(await stream(latin1(streams[k]), [])))
      }
    }

    for (const [name, id] of imageIds) {
      const img = this.images.get(name)!
      const space = img.colors === 3 ? '/DeviceRGB' : '/DeviceGray'
      put(
        id,
        `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace ${space}` +
          ' /BitsPerComponent 8 /Filter /FlateDecode' +
          ` /DecodeParms << /Predictor 15 /Colors ${img.colors} /BitsPerComponent 8 /Columns ${img.w} >>` +
          ` /Length ${img.data.length} >>\nstream\n`,
        img.data,
        '\nendstream',
      )
    }

    put(catalog, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
    put(pagesId, `<< /Type /Pages /Count ${this.pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`)

    // --- шрифт ---------------------------------------------------------------
    const f = this.font
    const name = f.postScriptName
    const used = [...this.glyphs.keys()].sort((a, b) => a - b)
    put(
      fontId,
      `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H` +
        ` /DescendantFonts [${cidId} 0 R] /ToUnicode ${toUniId} 0 R >>`,
    )
    put(
      cidId,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name}` +
        ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>' +
        ` /FontDescriptor ${descId} 0 R /DW 1000 /W [${used.map((g) => `${g} [${f.advance(g)}]`).join(' ')}]` +
        ' /CIDToGIDMap /Identity >>',
    )
    put(
      descId,
      `<< /Type /FontDescriptor /FontName /${name} /Flags ${f.italicAngle ? 68 : 4}` +
        ` /FontBBox [${f.bbox.join(' ')}] /ItalicAngle ${f.italicAngle} /Ascent ${f.ascent}` +
        ` /Descent ${f.descent} /CapHeight ${f.capHeight} /StemV 80 /FontFile2 ${fileId} 0 R >>`,
    )
    put(fileId, ...(await stream(f.data, [`/Length1 ${f.data.length}`])))

    const bf = used.map((g) => `<${hex([g])}> <${hex([this.glyphs.get(g)!])}>`)
    const blocks: string[] = []
    // в одном блоке beginbfchar допускается не более 100 записей
    for (let i = 0; i < bf.length; i += 100) {
      const part = bf.slice(i, i + 100)
      blocks.push(`${part.length} beginbfchar\n${part.join('\n')}\nendbfchar`)
    }
    const cmap =
      '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
      '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
      `${blocks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`
    put(toUniId, ...(await stream(latin1(cmap), [])))

    // --- сведения о документе -----------------------------------------------
    /** Текстовая строка PDF в UTF-16BE с маркером порядка байтов */
    const str = (s: string) => {
      const codes = [0xfe, 0xff]
      for (const ch of s) {
        const c = ch.codePointAt(0)!
        codes.push(c >> 8, c & 0xff)
      }
      return `<${codes.map((c) => c.toString(16).padStart(2, '0')).join('')}>`
    }
    const d = /^\d{4}-\d{2}-\d{2}$/.test(info.date) ? info.date.replace(/-/g, '') : '19700101'
    put(
      infoId,
      `<< /Title ${str(info.title)} /Author ${str(info.author)}` +
        ` /Creator ${str('Конфигуратор секций АСУ ТП НТ53')} /Producer ${str('asutp-section-configurator')}` +
        ` /CreationDate (D:${d}000000) >>`,
    )

    // --- сборка файла с таблицей ссылок -------------------------------------
    const chunks: Uint8Array[] = []
    let size = 0
    const write = (part: string | Uint8Array) => {
      const b = typeof part === 'string' ? latin1(part) : part
      chunks.push(b)
      size += b.length
    }

    write('%PDF-1.4\n')
    write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])) // признак двоичного файла
    const offsets: number[] = []
    for (let i = 0; i < objs.length; i++) {
      offsets.push(size)
      write(`${i + 1} 0 obj\n`)
      for (const part of objs[i]) write(part)
      write('\nendobj\n')
    }
    const xref = size
    let table = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    for (const o of offsets) table += `${String(o).padStart(10, '0')} 00000 n \n`
    table +=
      `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${infoId} 0 R >>\n` +
      `startxref\n${xref}\n%%EOF\n`
    write(table)

    const out = new Uint8Array(size)
    let at = 0
    for (const c of chunks) {
      out.set(c, at)
      at += c.length
    }
    return out
  }
}
