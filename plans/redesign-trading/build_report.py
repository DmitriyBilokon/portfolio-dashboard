# Сборка отчёта-артефакта: report.md (markdown) + findings.json → audit.html
import json, re, html, sys, os
S = os.path.dirname(os.path.abspath(__file__))
md_path, fj_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
meta = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}

def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])', r'<i>\1</i>', s)
    s = re.sub(r'\[([^\]]+)\]\((https?://[^)\s]+)\)', r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
    # file:line → моно
    s = re.sub(r'\b((?:app(?:-\d)?|telegram-notify|data|sw|styles|index|tests/[\w-]+|supabase-[\w-]+|plans/[\w-]+|SETUP|CLAUDE|home_spec)\.(?:js|css|html|md|sql)(?::\d+(?:[–-]\d+)?)?)', r'<code class="fl">\1</code>', s)
    return s

def md2html(md):
    out, i, lines = [], 0, md.splitlines()
    while i < len(lines):
        ln = lines[i]
        if not ln.strip(): i += 1; continue
        m = re.match(r'^(#{1,4})\s+(.*)', ln)
        if m and len(m.group(1)) == 1: i += 1; continue   # H1 уже в шапке страницы
        if m:
            lvl = len(m.group(1)); txt = m.group(2).strip()
            sid = re.sub(r'[^a-zA-Zа-яА-Я0-9]+', '-', txt).strip('-').lower()[:60]
            out.append(f'<h{lvl} id="{sid}">{inline(txt)}</h{lvl}>'); i += 1; continue
        if ln.strip().startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')]); i += 1
            if len(rows) >= 2 and all(re.match(r'^:?-{2,}:?$', c) for c in rows[1] if c):
                head, body = rows[0], rows[2:]
            else:
                head, body = None, rows
            t = ['<div class="wrap"><table>']
            if head: t.append('<thead><tr>' + ''.join(f'<th>{inline(c)}</th>' for c in head) + '</tr></thead>')
            t.append('<tbody>' + ''.join('<tr>' + ''.join(f'<td>{sevchip(inline(c))}</td>' for c in r) + '</tr>' for r in body) + '</tbody></table></div>')
            out.append(''.join(t)); continue
        if re.match(r'^\s*[-*•]\s+', ln) or re.match(r'^\s*\d+[.)]\s+', ln):
            ordered = bool(re.match(r'^\s*\d+[.)]\s+', ln)); items = []
            while i < len(lines) and (re.match(r'^\s*[-*•]\s+', lines[i]) or re.match(r'^\s*\d+[.)]\s+', lines[i]) or (lines[i].startswith('  ') and lines[i].strip())):
                if re.match(r'^\s*([-*•]|\d+[.)])\s+', lines[i]): items.append(re.sub(r'^\s*([-*•]|\d+[.)])\s+', '', lines[i]))
                else: items[-1] += ' ' + lines[i].strip()
                i += 1
            tag = 'ol' if ordered else 'ul'
            out.append(f'<{tag}>' + ''.join(f'<li>{sevchip(inline(x))}</li>' for x in items) + f'</{tag}>'); continue
        if ln.startswith('```'):
            i += 1; buf = []
            while i < len(lines) and not lines[i].startswith('```'): buf.append(lines[i]); i += 1
            i += 1; out.append('<pre><code>' + html.escape('\n'.join(buf)) + '</code></pre>'); continue
        if ln.startswith('---'): out.append('<hr>'); i += 1; continue
        para = [ln.strip()]; i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r'^(#{1,4}\s|\||\s*[-*•]\s|\s*\d+[.)]\s|```|---)', lines[i]): para.append(lines[i].strip()); i += 1
        out.append(f'<p>{sevchip(inline(" ".join(para)))}</p>')
    return '\n'.join(out)

SEV = {'critical': ('crit', 'критично'), 'high': ('high', 'высокая'), 'medium': ('med', 'средняя'), 'low': ('low', 'низкая')}
def sevchip(s):
    return re.sub(r'\b(critical|high|medium|low)\b', lambda m: f'<span class="sev {SEV[m.group(1)][0]}">{SEV[m.group(1)][1]}</span>', s)

md = open(md_path, encoding='utf-8').read()
F = json.load(open(fj_path, encoding='utf-8')) if os.path.exists(fj_path) else []
counts = {k: sum(1 for f in F if f.get('severity') == k) for k in SEV}
body = md2html(md)
# Приложение: карточки находок
def fcard(f):
    ev = ''.join(f'<li><code class="fl">{html.escape(e["file"])}:{e["line"]}</code> {inline(e.get("note",""))}</li>' for e in f.get('evidence', [])[:8])
    return f'''<details class="f {SEV.get(f["severity"],("low",))[0]}" id="{f["id"]}"><summary><span class="sev {SEV.get(f["severity"],("low",))[0]}">{SEV.get(f["severity"],("","?"))[1]}</span><span class="fid">{f["id"]}</span><span class="ft">{inline(f["title"])}</span><span class="eff">{f.get("effort","")}</span></summary>
<div class="fb"><p>{inline(f["claim"])}</p><p class="lbl">Влияние</p><p>{inline(f.get("impact",""))}</p><p class="lbl">Рекомендация</p><p>{inline(f.get("recommendation",""))}</p><p class="lbl">Доказательства</p><ul class="ev">{ev}</ul>{('<p class="vn">'+inline(f["verify"])+'</p>') if f.get("verify") else ''}</div></details>'''
cards = ''.join(fcard(f) for f in F)
toc = ''.join(f'<a href="#{re.sub(r"[^a-zA-Zа-яА-Я0-9]+","-",t).strip("-").lower()[:60]}">{html.escape(t)}</a>' for t in re.findall(r'^##\s+(.*)', md, re.M))
page = f'''<title>{html.escape(meta.get("title","Аудит portfolio-dashboard"))}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap">
<style>
:root{{--page:#f4f6f8;--panel:#fff;--raised:#eef1f5;--line:rgba(20,26,33,.10);--line2:rgba(20,26,33,.2);--ink:#141a21;--ink2:#4d5966;--muted:#7a8592;--accent:#2f6fdc;--crit:#d5473f;--high:#c2410c;--med:#b7791f;--low:#6a7887;--crit-s:rgba(213,71,63,.12);--high-s:rgba(194,65,12,.12);--med-s:rgba(183,121,31,.14);--low-s:rgba(106,120,135,.14);--font:'Golos Text',system-ui,-apple-system,'Segoe UI',sans-serif;--mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--page:#0c1017;--panel:#121821;--raised:#182130;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.18);--ink:#e8edf2;--ink2:#a9b4c0;--muted:#6f7b89;--accent:#9cc2ff;--crit:#ff6b6b;--high:#f59e6b;--med:#e6b450;--low:#8fa3b8;--crit-s:rgba(255,107,107,.14);--high-s:rgba(245,158,107,.14);--med-s:rgba(230,180,80,.14);--low-s:rgba(143,163,184,.14)}}}}
:root[data-theme="dark"]{{--page:#0c1017;--panel:#121821;--raised:#182130;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.18);--ink:#e8edf2;--ink2:#a9b4c0;--muted:#6f7b89;--accent:#9cc2ff;--crit:#ff6b6b;--high:#f59e6b;--med:#e6b450;--low:#8fa3b8;--crit-s:rgba(255,107,107,.14);--high-s:rgba(245,158,107,.14);--med-s:rgba(230,180,80,.14);--low-s:rgba(143,163,184,.14)}}
*{{box-sizing:border-box}}html,body{{margin:0;background:var(--page);color:var(--ink);font:15px/1.55 var(--font)}}a{{color:var(--accent);text-decoration:none}}a:hover{{text-decoration:underline}}
.doc{{display:grid;grid-template-columns:220px minmax(0,1fr);gap:40px;max-width:1240px;margin:0 auto;padding:32px 28px 80px}}
.toc{{position:sticky;top:24px;align-self:start;display:flex;flex-direction:column;gap:4px;font-size:13px}}.toc a{{color:var(--ink2);padding:5px 10px;border-radius:8px;border-left:2px solid transparent}}.toc a:hover{{background:var(--raised);color:var(--ink)}}
.hd{{border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:22px}}.hd h1{{font-size:28px;letter-spacing:-.02em;margin:0 0 6px;text-wrap:balance}}.hd .sub{{color:var(--muted);font-size:14px}}
.kpis{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0 6px}}.kpi{{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}}.kpi .l{{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}}.kpi .v{{font-size:26px;font-weight:600;letter-spacing:-.02em;font-family:var(--mono)}}
.kpi.crit .v{{color:var(--crit)}}.kpi.high .v{{color:var(--high)}}.kpi.med .v{{color:var(--med)}}.kpi.low .v{{color:var(--low)}}
.body h2{{font-size:20px;letter-spacing:-.015em;margin:40px 0 12px;padding-top:14px;border-top:1px solid var(--line)}}.body h3{{font-size:16px;margin:24px 0 8px}}.body h4{{font-size:14px;margin:18px 0 6px;color:var(--ink2)}}
.body p{{margin:0 0 10px;max-width:78ch}}.body ul,.body ol{{padding-left:22px;margin:0 0 12px;max-width:80ch}}.body li{{margin:3px 0}}
.body code{{font-family:var(--mono);font-size:.88em;background:var(--raised);padding:1px 5px;border-radius:4px}}code.fl{{color:var(--ink2)}}
.body pre{{background:var(--raised);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow:auto;font-size:12.5px}}
.wrap{{overflow-x:auto;margin:0 0 14px}}table{{border-collapse:collapse;width:100%;font-size:13px;background:var(--panel);border:1px solid var(--line);border-radius:10px}}th{{text-align:left;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap}}td{{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}}tr:last-child td{{border-bottom:0}}
.sev{{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}}.sev.crit{{background:var(--crit-s);color:var(--crit)}}.sev.high{{background:var(--high-s);color:var(--high)}}.sev.med{{background:var(--med-s);color:var(--med)}}.sev.low{{background:var(--low-s);color:var(--low)}}
details.f{{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--low);border-radius:10px;margin:8px 0}}details.f.crit{{border-left-color:var(--crit)}}details.f.high{{border-left-color:var(--high)}}details.f.med{{border-left-color:var(--med)}}
details.f summary{{display:flex;gap:10px;align-items:center;padding:10px 14px;cursor:pointer;list-style:none}}details.f summary::-webkit-details-marker{{display:none}}.fid{{font-family:var(--mono);font-size:12px;color:var(--muted)}}.ft{{font-weight:600;flex:1;min-width:0}}.eff{{font-family:var(--mono);font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 6px}}
.fb{{padding:4px 16px 14px;border-top:1px solid var(--line);font-size:14px}}.fb .lbl{{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:10px 0 2px}}.ev{{font-size:13px}}.vn{{font-size:12px;color:var(--muted);border-top:1px dashed var(--line);padding-top:8px;margin-top:8px}}
.note{{font-size:13px;color:var(--muted)}}
@media (max-width:900px){{.doc{{grid-template-columns:1fr;padding:18px 14px 60px}}.toc{{position:static;flex-direction:row;flex-wrap:wrap}}.kpis{{grid-template-columns:repeat(2,1fr)}}}}
</style>
<div class="doc"><nav class="toc">{toc}<a href="#findings">Приложение: находки</a></nav>
<article>
<div class="hd"><h1>{html.escape(meta.get("title","Аудит portfolio-dashboard"))}</h1><div class="sub">{html.escape(meta.get("sub",""))}</div>
<div class="kpis"><div class="kpi crit"><div class="l">Критично</div><div class="v">{counts["critical"]}</div></div><div class="kpi high"><div class="l">Высокая</div><div class="v">{counts["high"]}</div></div><div class="kpi med"><div class="l">Средняя</div><div class="v">{counts["medium"]}</div></div><div class="kpi low"><div class="l">Низкая</div><div class="v">{counts["low"]}</div></div></div>
<p class="note">{html.escape(meta.get("note",""))}</p></div>
<div class="body">{body}</div>
<h2 id="findings">Приложение: все находки ({len(F)})</h2><p class="note">Раскройте строку — утверждение, влияние, рекомендация и доказательства с файлом и строкой.</p>{cards}
</article></div>'''
open(out_path, 'w', encoding='utf-8').write(page)
print('written', out_path, len(page)//1024, 'KB; findings', len(F), counts)
