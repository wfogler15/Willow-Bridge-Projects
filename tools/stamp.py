"""Stamp every local CSS/JS reference in the v2 site with one build version so a release never mixes cached old files with new ones.
Run right before publishing."""
import re, glob, time, os
V = time.strftime('%Y%m%d%H%M')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'v2')
for f in glob.glob(ROOT + '/**/*.html', recursive=True):
    s = open(f, encoding='utf-8').read()
    s2 = re.sub(r'((?:href|src)=")((?!https?:|//|data:)[^"?]+\.(?:css|js))(\?v=[^"]*)?"', lambda m: f'{m.group(1)}{m.group(2)}?v={V}"', s)
    s2 = re.sub(r"window\.WB_BUILD = '[^']*'", f"window.WB_BUILD = '{V}'", s2)
    if s2 != s: open(f, 'w', encoding='utf-8').write(s2)
# wb.js passes its own version on to the shared chrome stylesheet
p = ROOT + '/shared/wb.js'; s = open(p).read()
s = re.sub(r"add\(ROOT \+ 'shared/wb-chrome\.css(\?v=[^']*)?'\)", f"add(ROOT + 'shared/wb-chrome.css?v={V}')", s)
s = s.replace("scriptSrc.replace(/shared\\/wb\\.js.*$/, '')", "scriptSrc.replace(/shared\\/wb\\.js.*$/, '')")
open(p, 'w').write(s)
print('stamped', V)
