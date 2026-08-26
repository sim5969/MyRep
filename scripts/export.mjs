/**
 * Выгрузка документов по проекту конфигуратора без браузера.
 *
 * Те же модули выгрузки, что и в приложении, поэтому файлы получаются
 * такими же, как по кнопкам «PDF А3», «DXF», «Надписи», «Спецификация».
 *
 * Запуск:
 *   node scripts/export.mjs "проект.json" --all --out="C:/Users/.../Downloads"
 *   node scripts/export.mjs "проект.json" --pdf --dxf
 *
 * Флаги: --pdf, --dxf, --csv (таблица надписей), --xlsx (спецификация), --all.
 * Имена файлов — как в приложении: «<наименование проекта> фасад.pdf» и т. д.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { arg, flag, ROOT, withApp } from './app-modules.mjs'

const src = process.argv[2]
if (!src || src.startsWith('--')) {
  console.error('Укажите файл проекта: node scripts/export.mjs "проект.json" --all [--out=папка]')
  process.exit(2)
}

const all = flag('all')
const want = {
  pdf: all || flag('pdf'),
  dxf: all || flag('dxf'),
  csv: all || flag('csv'),
  xlsx: all || flag('xlsx'),
}
if (!Object.values(want).some(Boolean)) {
  console.error('Нечего выгружать: укажите --all либо --pdf, --dxf, --csv, --xlsx')
  process.exit(2)
}

const outDir = arg('out', dirname(src))

await withApp(async (load) => {
  const { normalizeProject } = await load('/src/lib/project.ts')
  const { sectionId, sectionDesignation } = await load('/src/lib/designation.ts')
  const { safeName } = await load('/src/export/download.ts')

  const project = normalizeProject(JSON.parse(readFileSync(src, 'utf8')))
  const complex = project.complexes[0]
  const base = safeName(project.project.name)
  const kb = (n) => `${(n / 1024).toFixed(1)} КБ`

  console.log(`Проект: ${project.project.name}`)
  console.log(
    `Комплекс ${complex.id}, секций ${complex.sections.length}: ` +
      complex.sections.map((s, i) => `${sectionId(i)} ${sectionDesignation(s)}`).join(', '),
  )

  if (want.pdf) {
    const { buildFacadePdf } = await load('/src/export/pdf.ts')
    const font = new Uint8Array(readFileSync(join(ROOT, 'src/assets/isocpeur-italic.ttf')))
    const logo = new Uint8Array(readFileSync(join(ROOT, 'src/assets/logo-nt.png')))
    const bytes = await buildFacadePdf(project, complex, complex.sections, { font, logo })
    const p = join(outDir, `${base} фасад.pdf`)
    writeFileSync(p, Buffer.from(bytes))
    console.log(`PDF:  ${p} (${kb(bytes.length)})`)
  }

  if (want.dxf) {
    const { buildDxf } = await load('/src/export/dxf.ts')
    const dxf = buildDxf(complex, complex.sections)
    const p = join(outDir, `${base} фасад.dxf`)
    writeFileSync(p, dxf, 'utf8')
    console.log(`DXF:  ${p} (${kb(Buffer.byteLength(dxf))})`)
  }

  if (want.csv) {
    const { collectLabels, labelsToCsv } = await load('/src/export/labels.ts')
    const rows = collectLabels(complex, complex.sections)
    const csv = labelsToCsv(project, rows)
    const p = join(outDir, `${base} надписи.csv`)
    writeFileSync(p, csv, 'utf8')
    console.log(`CSV:  ${p} (${kb(Buffer.byteLength(csv))}, шильдов ${rows.length})`)
  }

  if (want.xlsx) {
    const { buildSpecWorkbook } = await load('/src/export/spec.ts')
    const wb = await buildSpecWorkbook(project, complex, complex.sections)
    const buf = await wb.xlsx.writeBuffer()
    const p = join(outDir, `${base} спецификация.xlsx`)
    writeFileSync(p, Buffer.from(buf))
    console.log(`XLSX: ${p} (${kb(buf.byteLength)}, листов ${wb.worksheets.length})`)
  }
})
