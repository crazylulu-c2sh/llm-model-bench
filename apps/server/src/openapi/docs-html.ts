/**
 * 완전 자립형(오프라인·CDN 없음) API 레퍼런스 HTML.
 * `${prefix}/openapi.json`을 fetch해 태그별로 엔드포인트를 렌더한다. 외부 스크립트/폰트/CSS 없음 —
 * 에어갭·엄격 CSP 환경 안전(더 풍부한 Scalar/Swagger UI는 정적 asset을 vendor해 후속 교체 가능).
 */
export function renderDocsHtml(prefix: string): string {
  const specUrl = `${prefix}/openapi.json`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>llm-model-bench API</title>
<style>
  :root { color-scheme: light dark; --fg:#1a1a1a; --muted:#666; --bg:#fff; --card:#f6f7f9; --border:#e2e4e8; --get:#0a7d32; --post:#0b62d6; --delete:#c02626; }
  @media (prefers-color-scheme: dark){ :root{ --fg:#e6e6e6; --muted:#9aa0a6; --bg:#16181c; --card:#1e2127; --border:#2b2f36; } }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:var(--fg); background:var(--bg); }
  header { padding:20px 24px; border-bottom:1px solid var(--border); }
  h1 { margin:0 0 4px; font-size:18px; }
  .desc { color:var(--muted); white-space:pre-wrap; font-size:12.5px; max-width:900px; }
  main { padding:16px 24px; max-width:1000px; }
  .tag { margin:22px 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  .op { border:1px solid var(--border); border-radius:8px; margin:8px 0; background:var(--card); overflow:hidden; }
  .op summary { cursor:pointer; padding:10px 12px; display:flex; gap:10px; align-items:center; list-style:none; }
  .op summary::-webkit-details-marker { display:none; }
  .m { font-weight:700; font-size:11px; padding:2px 8px; border-radius:4px; color:#fff; min-width:52px; text-align:center; }
  .m.get{background:var(--get);} .m.post{background:var(--post);} .m.delete{background:var(--delete);}
  .path { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; }
  .sum { color:var(--muted); font-size:12.5px; margin-left:auto; text-align:right; }
  .body { padding:0 14px 12px; font-size:12.5px; }
  .body h4 { margin:12px 0 4px; font-size:11.5px; color:var(--muted); text-transform:uppercase; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; background:rgba(127,127,127,.14); padding:1px 5px; border-radius:4px; }
  a { color:var(--post); }
  .err { color:var(--delete); padding:24px; }
</style>
</head>
<body>
<header>
  <h1>llm-model-bench API <span style="font-weight:400;color:var(--muted)">v1</span></h1>
  <div class="desc" id="info"></div>
  <div style="margin-top:8px"><a href="${specUrl}">openapi.json</a></div>
</header>
<main id="main"><p style="color:var(--muted)">로딩 중…</p></main>
<script>
const SPEC_URL = ${JSON.stringify(specUrl)};
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
function paramRow(p){ return '<li><code>'+esc(p.name)+'</code> <span style="color:var(--muted)">('+esc(p.in)+(p.required?', required':'')+')</span>'+(p.description?' — '+esc(p.description):'')+'</li>'; }
function schemaRef(obj){
  if(!obj) return '';
  const s = obj.schema || obj;
  if(s && s.$ref) return '<code>'+esc(s.$ref.split('/').pop())+'</code>';
  if(s && s.type) return '<code>'+esc(s.type)+'</code>';
  return '';
}
function opBody(op){
  let h = '';
  if(op.parameters && op.parameters.length){ h += '<h4>Parameters</h4><ul>'+op.parameters.map(paramRow).join('')+'</ul>'; }
  if(op.requestBody){
    const c = op.requestBody.content || {};
    const mt = Object.keys(c)[0];
    h += '<h4>Request body</h4><div>'+esc(mt||'')+' '+schemaRef(c[mt])+'</div>';
  }
  h += '<h4>Responses</h4><ul>';
  for(const [code,r] of Object.entries(op.responses||{})){
    const c = r.content || {};
    const mt = Object.keys(c)[0];
    h += '<li><code>'+esc(code)+'</code> '+esc(r.description||'')+(mt?' — '+esc(mt)+' '+schemaRef(c[mt]):'')+'</li>';
  }
  h += '</ul>';
  return h;
}
fetch(SPEC_URL).then(r=>r.json()).then(spec=>{
  document.getElementById('info').textContent = (spec.info && spec.info.description) || '';
  const byTag = {};
  for(const [path,item] of Object.entries(spec.paths||{})){
    for(const [method,op] of Object.entries(item)){
      const tag = (op.tags && op.tags[0]) || 'other';
      (byTag[tag] = byTag[tag]||[]).push({path,method,op});
    }
  }
  const order = (spec.tags||[]).map(t=>t.name);
  const tags = Object.keys(byTag).sort((a,b)=> (order.indexOf(a)+1||99) - (order.indexOf(b)+1||99));
  let html = '';
  for(const tag of tags){
    html += '<div class="tag">'+esc(tag)+'</div>';
    for(const {path,method,op} of byTag[tag]){
      html += '<details class="op"><summary>'
        + '<span class="m '+esc(method)+'">'+esc(method.toUpperCase())+'</span>'
        + '<span class="path">'+esc(path)+'</span>'
        + '<span class="sum">'+esc(op.summary||'')+'</span>'
        + '</summary><div class="body">'+opBody(op)+'</div></details>';
    }
  }
  document.getElementById('main').innerHTML = html;
}).catch(e=>{ document.getElementById('main').innerHTML = '<p class="err">스펙 로드 실패: '+esc(e.message)+'</p>'; });
</script>
</body>
</html>`;
}
