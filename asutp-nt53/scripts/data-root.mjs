/**
 * Корень бинарников проекта на Synology (DATA_ROOT): сборка dist/, книга «Модули НТ53.xlsx».
 * Фотографии панелей (папка «Модули») с 14.10.2026 ведутся в Git и берутся из корня
 * репозитория (MODULES_DIR). Модель хранилищ описана в AI/AI_COLLAB.md.
 *
 * Приоритет источника пути:
 *   1) переменная окружения NT_ASUTP_DATA;
 *   2) файл AI/scripts/local.config (ключ NT_ASUTP_DATA=…), в .gitignore;
 *   3) корень репозитория — когда «Модули» лежит рядом (например, на Synology P:).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function fromLocalConfig() {
  const file = join(ROOT, 'AI', 'scripts', 'local.config')
  if (!existsSync(file)) return null
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue
    const m = /^\s*NT_ASUTP_DATA\s*=\s*(.+?)\s*$/.exec(line)
    if (m) return m[1]
  }
  return null
}

export const DATA_ROOT = process.env.NT_ASUTP_DATA || fromLocalConfig() || ROOT

/** Папка фотографий панелей — в репозитории. Выгрузка EPLAN (DXF) кладётся в неё же
 *  подпапкой «Макросы …», но в Git не ведётся (см. .gitignore). */
export const MODULES_DIR = join(ROOT, 'Модули')
