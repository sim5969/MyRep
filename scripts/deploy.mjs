/**
 * Выкладка сборки на Synology: dist/ → <NT_ASUTP_DATA>/dist, рядом — «Запуск конфигуратора.bat»
 * (по умолчанию P:\Projects\Шкафы АСУТП НТ53). Папка dist назначения очищается, чтобы не копились
 * старые assets/*-хэш.js. Путь берётся из NT_ASUTP_DATA / AI/scripts/local.config (data-root.mjs).
 *
 *   npm run build && npm run deploy
 *
 * Копирование — вручную через copyFileSync: fs.cpSync в Node 24 на Windows аварийно завершает
 * процесс (0xC0000409) при копировании в уже существующую папку на сетевом диске P:.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_ROOT } from './data-root.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BAT = 'Запуск конфигуратора.bat'
const src = join(ROOT, 'dist')
const dst = join(DATA_ROOT, 'dist')

if (!existsSync(join(src, 'index.html'))) {
  console.error('Нет dist/index.html — сначала npm run build')
  process.exit(1)
}
if (DATA_ROOT === ROOT) {
  console.error('Не задан путь к Synology: NT_ASUTP_DATA или AI/scripts/local.config — некуда выкладывать')
  process.exit(1)
}
if (!existsSync(DATA_ROOT)) {
  console.error(`Папка недоступна: ${DATA_ROOT}`)
  process.exit(1)
}

let files = 0
let bytes = 0
function copyDir(from, to) {
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    const a = join(from, name)
    const b = join(to, name)
    if (statSync(a).isDirectory()) copyDir(a, b)
    else {
      copyFileSync(a, b)
      files += 1
      bytes += statSync(a).size
    }
  }
}

rmSync(dst, { recursive: true, force: true })
copyDir(src, dst)
// пакетный файл — с CRLF, как положено cmd
writeFileSync(join(DATA_ROOT, BAT), readFileSync(join(ROOT, 'scripts', BAT), 'utf8').replace(/\r?\n/g, '\r\n'))
console.log(`Выложено в ${dst}: ${files} файлов, ${Math.round(bytes / 1024)} КБ; рядом — «${BAT}»`)
