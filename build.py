# -*- coding: utf-8 -*-
"""Пересборка index.html: внедряет в _template.html актуальный catalog.json,
внешние виды ПЧ (pch_art.json, выгрузка из «Внешний вид ПЧ/build_pch.py») и
внешние виды автоматов и контакторов (ak_art.json из «Автоматы и контакторы/
build_ak.py»).
Запуск: python build.py   (из папки Компоновщик)
"""
import json, os, sys
sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
CAT  = os.path.join(HERE, '..', 'Панели с ПЧ', 'catalog.json')
ART  = os.path.join(HERE, '..', 'Панели с ПЧ', 'Внешний вид ПЧ', 'pch_art.json')
AK   = os.path.join(HERE, '..', 'Панели с ПЧ', 'Автоматы и контакторы', 'ak_art.json')
# Какие типоразмеры аппаратов уже отрисованы начисто и годятся в компоновку.
# D5…D7 (NXC-120…630) пока не включаем — их вид ещё в работе; без записи в этом
# списке компоновщик просто нарисует прежний цветной прямоугольник.
AK_FRAMES = ('C1', 'C2', 'C3', 'C4', 'C5', 'D1', 'D2', 'D3', 'D4')

cat = json.load(open(CAT, encoding='utf-8'))
art = json.load(open(ART, encoding='utf-8'))
ak  = json.load(open(AK, encoding='utf-8'))
ak  = {f: ak[f] for f in AK_FRAMES if f in ak}
tpl = open(os.path.join(HERE, '_template.html'), encoding='utf-8').read()
js  = json.dumps(cat, ensure_ascii=False, separators=(',', ':'))
ja  = json.dumps(art, ensure_ascii=False, separators=(',', ':'))
jk  = json.dumps(ak, ensure_ascii=False, separators=(',', ':'))
out = (tpl.replace('__CATALOG_JSON__', js).replace('__PCH_ART_JSON__', ja)
          .replace('__AK_ART_JSON__', jk))
for ph in ('__CATALOG_JSON__', '__PCH_ART_JSON__', '__AK_ART_JSON__'):
    assert ph not in out, 'плейсхолдер %s не найден в шаблоне' % ph

# ширина слота в каталоге должна совпадать с шириной нарисованного корпуса,
# иначе прибор встанет со смещением относительно раскладки
for fr, a in art.items():
    w = cat['mounting']['pch_width_by_frame'].get(fr)
    if w is not None and abs(w - a['w']) > 0.5:
        print('  ВНИМАНИЕ: %s — слот %s мм, внешний вид %s мм' % (fr, w, a['w']))

# то же для аппаратов: габарит из каталога — это место, которое компоновщик
# отводит под QF/KM, и рисунок должен в него укладываться
dims = {}
for s in cat['selection']:
    for key in ('breaker', 'contactor'):
        dims.setdefault(s[key]['frame'], s[key]['dim'])
for fr, a in ak.items():
    d = dims.get(fr)
    if d and (abs(d['w'] - a['w']) > 0.5 or abs(d['h'] - a['h']) > 0.5):
        print('  ВНИМАНИЕ: %s — каталог %s×%s мм, внешний вид %s×%s мм'
              % (fr, d['w'], d['h'], a['w'], a['h']))
miss = sorted(set(dims) - set(ak))
if miss:
    print('  без внешнего вида (прямоугольник): %s' % ', '.join(miss))

open(os.path.join(HERE, 'index.html'), 'w', encoding='utf-8').write(out)
print('index.html пересобран | каталог %d байт | внешние виды: ПЧ %d КБ (%d), '
      'аппараты %d КБ (%d) | позиций подбора %d'
      % (len(js), len(ja) // 1024, len(art), len(jk) // 1024, len(ak),
         len(cat['selection'])))
