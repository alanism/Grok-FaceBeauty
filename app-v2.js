/* app-v2.js — v2 UI & charts (file picker fix + robust per_criterion parsing) */
(function(){
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // --- Elements
  const fileInputEl = document.getElementById('file-input');
  const thumbs = document.getElementById('photo-thumbs');
  const noPhotos = document.getElementById('no-photos');
  const btnUpload = document.getElementById('btn-upload');
  const btnClear = document.getElementById('btn-clear');

  const apiKeyEl = document.getElementById('api-key');
  const btnScore = document.getElementById('btn-score');
  const overlay = document.getElementById('overlay');

  const results = document.getElementById('results');
  const totalScoreEl = document.getElementById('total-score');
  const percentileEl = document.getElementById('percentile');
  const pctNoteEl = document.getElementById('pct-note');
  const perImageEl = document.getElementById('per-image');

  const errKeyMissing = document.getElementById('err-key-missing');
  const errKeyInvalid = document.getElementById('err-key-invalid');
  const errNoPhotos = document.getElementById('err-no-photos');
  const errNetwork = document.getElementById('err-network');
  const errModel = document.getElementById('err-model');

  const bellCanvas = document.getElementById('bell');
  const radarBucketsCanvas = document.getElementById('radar-buckets');
  const radarCanvases = {
    P: document.getElementById('radar-P'),
    D: document.getElementById('radar-D'),
    S: document.getElementById('radar-S'),
    Y: document.getElementById('radar-Y'),
    O: document.getElementById('radar-O')
  };

  const tableBody = document.getElementById('table-body');
  const btnCopyAll = document.getElementById('btn-copy-all');
  const btnExpandAll = document.getElementById('btn-expand-all');
  const btnCollapseAll = document.getElementById('btn-collapse-all');
  const btnCopyProtocol = document.getElementById('btn-copy-protocol');

  // --- State
  let files = [];
  let bellChart;
  const radarCharts = {};

  // --- Colors
  const COLORS = {
    P: { line: 'rgba(0,188,212,1)', fill: 'rgba(0,188,212,0.25)' },
    D: { line: 'rgba(245,124,0,1)', fill: 'rgba(245,124,0,0.25)' },
    S: { line: 'rgba(255,235,59,1)', fill: 'rgba(255,235,59,0.25)' },
    Y: { line: 'rgba(76,175,80,1)', fill: 'rgba(76,175,80,0.25)' },
    O: { line: 'rgba(0,188,212,0.8)', fill: 'rgba(0,188,212,0.18)' }
  };
  const ORANGE = '#f57c00';

  // --- Helpers
  function validateKey(k){
    if(!k) return false;
    const key = k.trim().replace(/^["']|["']$/g, '');
    if(/^https?:\/\//i.test(key) || /^file:\/\//i.test(key)) return false;
    return /^AIza[0-9A-Za-z_\-]{20,}$/.test(key);
  }
  function hideErrors(){ [errKeyMissing, errKeyInvalid, errNoPhotos, errNetwork, errModel].forEach(e => e.classList.remove('show')); }
  function b64(dataUrl){ const i = dataUrl.indexOf(','); return i>=0 ? dataUrl.slice(i+1) : dataUrl; }
  function sex(){ return document.getElementById('sex-m').checked ? 'male' : 'female'; }

  function unifiedRubric(){
    const C=(code,name)=>({code,name});
    return {
      criteria: [
        C('P1','Facial thirds balance'), C('P2','Facial fifths / width'), C('P3','Midface proportion'), C('P4','Feature spacing harmony'),
        C('D5','Jawline definition'), C('D6','Chin projection/width'), C('D7','Cheekbone prominence'), C('D8','Brow & supraorbital'),
        C('S10','Skin texture / pores'), C('S11','Pigmentation / tone even'), C('S12','Under-eye quality'), C('S9','Skin clarity (acne/redness)'),
        C('Y13','Gaze engagement'), C('Y14','Micro-expression control'), C('Y15','Head/neck posture line'), C('Y16','Smile harmony (tooth/lip)'),
        C('O17','Photographic framing'), C('O18','Lighting suitability'), C('O19','Grooming/styling fit'), C('O20','Overall facial harmony')
      ]
    };
  }
  const FRIENDLY_NAME = unifiedRubric().criteria.reduce((m,c)=> (m[c.code]=c.name,m),{});

  // --- Persist API key
  document.addEventListener('DOMContentLoaded',()=>{
    const k = localStorage.getItem('geminiApiKey');
    if(k) apiKeyEl.value = k;
  });
  apiKeyEl.addEventListener('input',()=> localStorage.setItem('geminiApiKey', apiKeyEl.value));

  // --- Photo handlers (reliable user-gesture click)
  btnUpload.addEventListener('click', () => {
    if (fileInputEl && !fileInputEl.disabled) fileInputEl.click();
  });
  btnClear.addEventListener('click', () => resetPhotos());
  fileInputEl.addEventListener('change', e => {
    const list = Array.from(e.target.files || []);
    // Clear thumbnails and state but keep the picker value until we're done reading
    resetPhotos(true);
    Array.from(list).slice(0,5).forEach((file, i)=>{
      const r = new FileReader();
      r.onload = ev => {
        files.push({ file, dataUrl: ev.target.result });
        noPhotos.classList.add('hidden');
        const wrap = document.createElement('div');
        const img = document.createElement('img');
        img.className = 'photo-thumbnail';
        img.src = ev.target.result;
        img.alt = `Photo ${i+1}`;
        wrap.appendChild(img);
        thumbs.appendChild(wrap);
      };
      r.readAsDataURL(file);
    });
    // Now that we've captured files, clear the input so re-selecting the same file re-triggers change
    if (fileInputEl) fileInputEl.value = '';
  });
  function resetPhotos(keepPickerValue=false){
    files = []; thumbs.innerHTML = ''; noPhotos.classList.remove('hidden');
    if (fileInputEl && !keepPickerValue) fileInputEl.value = '';
  }

  // --- Build request
  function buildContents(key, images, params){
    const imageParts = images.map(img => ({ inline_data: { mime_type: img.file.type || 'image/jpeg', data: b64(img.dataUrl) } }));
    const spec = { rubric: unifiedRubric() };
    const contents = window.buildScoringContents(params, spec, imageParts);
    contents.endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(key);
    return contents;
  }

  // --- Gemini call
  async function callGemini(key, contents){
    const payload = { contents, generationConfig: { responseMimeType: "application/json", temperature: 0.2 } };
    const res = await fetch(contents.endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if(!res.ok){ let txt=""; try{ txt = await res.text(); } catch{}; throw new Error("HTTP " + res.status + (txt?(": " + txt):"")); }
    const j = await res.json();
    const partsOut = j?.candidates?.[0]?.content?.parts || [];
    let text = partsOut.map(p => p.text || "").join("").trim();
    let data; try { data = JSON.parse(text); } catch { const s=text.indexOf("{"), e=text.lastIndexOf("}"); if(s!==-1&&e!==-1) data = JSON.parse(text.slice(s,e+1)); }
    if(!data) throw new Error("No JSON from model");
    return data;
  }

  // --- Charts
  function renderBell(userScore){
    const mean=60, sigma=10, xs=[], ys=[];
    for(let x=20;x<=100;x+=1){ xs.push(x); ys.push((1/(sigma*Math.sqrt(2*Math.PI)))*Math.exp(-0.5*Math.pow((x-mean)/sigma,2))); }
    const maxY = Math.max(...ys);
    const idx = xs.reduce((best,i,ix)=> Math.abs(i-userScore) < Math.abs(xs[best]-userScore) ? ix : best, 0);
    if(bellChart) bellChart.destroy();
    bellChart = new Chart(bellCanvas.getContext('2d'),{
      type:'line',
      data:{ labels: xs, datasets:[
        { label:'Distribution', data: ys, fill:false, tension:0.25, borderColor: COLORS.P.line },
        { type:'bar', label:'You', data: xs.map((_,i)=> i===idx ? maxY*1.15 : null), backgroundColor: ORANGE, borderWidth:0, barThickness: 2 }
      ]},
      options:{
        plugins:{ legend:{ display:false } },
        scales:{ x:{ ticks:{ color:'#e0e0e0' }, grid:{ color:'rgba(255,255,255,0.08)' } }, y:{ ticks:{ display:false }, grid:{ color:'rgba(255,255,255,0.08)' } } },
        elements:{ point:{ radius:0 } }
      }
    });
  }

  function radarChartFor(canvas, labels, dataArr, color){
    if(radarCharts[canvas.id]) radarCharts[canvas.id].destroy();
    radarCharts[canvas.id] = new Chart(canvas.getContext('2d'), {
      type:'radar',
      data:{ labels, datasets:[{ data: dataArr, fill:true, borderColor: color.line, backgroundColor: color.fill, pointRadius:2 }]},
      options:{
        plugins:{ legend:{ display:false } },
        scales:{ r:{ suggestedMin:1, suggestedMax:5, angleLines:{ color:'rgba(255,255,255,0.08)' }, grid:{ color:'rgba(255,255,255,0.08)' },
          pointLabels:{ color:'#e0e0e0', font:{ size:11 } }, ticks:{ color:'#e0e0e0', showLabelBackdrop:false } } }
      }
    });
  }

  function bucketAverages(perCriterion){
    const buckets = {P:[], D:[], S:[], Y:[], O:[]};
    for(const [code, obj] of Object.entries(perCriterion || {})){
      let s = (typeof obj==='number') ? obj : (typeof obj?.score==='number' ? obj.score : (typeof obj?.value==='number' ? obj.value : (typeof obj?.avg==='number' ? obj.avg : null)));
      const b = code[0]; if(buckets[b] && typeof s==='number') buckets[b].push(s);
    }
    const out = {}; for(const k of Object.keys(buckets)){ const arr = buckets[k]; out[k] = arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length) : 0; }
    return out;
  }

  // --- Table with tips
  function renderTable(perCriterion){
    tableBody.innerHTML = '';
    const order = {P:0, D:1, S:2, Y:3, O:4};
    const rows = Object.keys(perCriterion).sort((a,b)=> order[a[0]]-order[b[0]] || a.localeCompare(b));

    rows.forEach(code => {
      const raw = perCriterion[code];
      const name = (raw && typeof raw === 'object' && raw.name) ? raw.name : (FRIENDLY_NAME[code] || code);

      let scoreNum = null;
      if (typeof raw === 'number') scoreNum = raw;
      else if (raw && typeof raw.score === 'number') scoreNum = raw.score;
      else if (raw && typeof raw.value === 'number') scoreNum = raw.value;
      else if (raw && typeof raw.avg === 'number') scoreNum = raw.avg;
      const score = (typeof scoreNum === 'number') ? scoreNum.toFixed(2) : '—';

      const why = (raw && typeof raw === 'object') ? (raw.rationale_140 || raw.why || raw.rationale || '') : '';

      const tips = (raw && typeof raw === 'object' && raw.tips && typeof raw.tips === 'object') ? raw.tips : {};

      const tr = document.createElement('tr');
      tr.className = 'border-b border-white/10';
      tr.innerHTML = `
        <td class="py-2 pr-4"><span class="tag ${code[0]}">${code}</span></td>
        <td class="py-2 pr-4">${name}</td>
        <td class="py-2 pr-4 font-kpi">${score}</td>
        <td class="py-2 pr-4">${why}</td>
        <td class="py-2 pr-4"><button class="toggle-tips" data-code="${code}">Show</button></td>
      `;
      tableBody.appendChild(tr);

      const trTips = document.createElement('tr');
      trTips.className = 'tips-row hidden';
      trTips.dataset.code = code;
      trTips.innerHTML = `
        <td colspan="5" class="tips-cell py-2 px-2">
          <div class="grid md:grid-cols-2 gap-2">
            <div><span class="text-white/80 font-semibold">Plastic Surgeon:</span> ${tips.plastic_surgeon || '—'}</div>
            <div><span class="text-white/80 font-semibold">Makeup Artist:</span> ${tips.makeup_artist || '—'}</div>
            <div><span class="text-white/80 font-semibold">Health Coach:</span> ${tips.health_coach || '—'}</div>
            <div><span class="text-white/80 font-semibold">Exec & Dating Coach:</span> ${tips.exec_dating_coach || '—'}</div>
          </div>
        </td>
      `;
      tableBody.appendChild(trTips);
    });

    tableBody.addEventListener('click', (e)=>{
      const btn = e.target.closest('button.toggle-tips');
      if(!btn) return;
      const code = btn.dataset.code;
      const row = tableBody.querySelector(`tr.tips-row[data-code="${code}"]`);
      if(!row) return;
      const hidden = row.classList.contains('hidden');
      row.classList.toggle('hidden');
      btn.textContent = hidden ? 'Hide' : 'Show';
    });

    btnExpandAll.onclick = () => $$('#table-body tr.tips-row').forEach(r=> r.classList.remove('hidden'));
    btnCollapseAll.onclick = () => $$('#table-body tr.tips-row').forEach(r=> r.classList.add('hidden'));

    btnCopyAll.onclick = () => {
      const out = rows.map(code => {
        const raw = perCriterion[code];
        const name = (raw && typeof raw === 'object' && raw.name) ? raw.name : (FRIENDLY_NAME[code] || code);
        let scoreNum = null;
        if (typeof raw === 'number') scoreNum = raw;
        else if (raw && typeof raw.score === 'number') scoreNum = raw.score;
        else if (raw && typeof raw.value === 'number') scoreNum = raw.value;
        else if (raw && typeof raw.avg === 'number') scoreNum = raw.avg;
        const score = (typeof scoreNum === 'number') ? scoreNum.toFixed(2) : '—';
        const why = (raw && typeof raw === 'object') ? (raw.rationale_140 || raw.why || raw.rationale || '') : '';
        const t = (raw && typeof raw === 'object' && raw.tips && typeof raw.tips === 'object') ? raw.tips : {};
        return `${code} ${name}\nScore: ${score}\nWhy: ${why}\n- Plastic Surgeon: ${t.plastic_surgeon || '—'}\n- Makeup Artist: ${t.makeup_artist || '—'}\n- Health Coach: ${t.health_coach || '—'}\n- Exec & Dating Coach: ${t.exec_dating_coach || '—'}`;
      }).join('\n\n');
      navigator.clipboard.writeText(out).catch(()=>{});
    };
  }

  // --- Protocol utils
  function scale100(x){ if(typeof x!=='number' || isNaN(x)) return null; return (x<=5.0001) ? ((x-1)/4*100) : x; }
  function fillProtocol(sel, items){
    const ul = document.querySelector(sel); ul.innerHTML = '';
    (items||[]).forEach(s => { const li=document.createElement('li'); li.textContent = (typeof s==='string') ? s : JSON.stringify(s); ul.appendChild(li); });
  }

  // --- Render all
  function renderAll(data){
    results.classList.remove('hidden');

    const agg = data.aggregate || {};
    let total = (typeof agg.total_weighted==='number') ? agg.total_weighted : null;
    if(total===null && data.per_criterion){
      const vals = Object.values(data.per_criterion)
        .map(v => (typeof v==='number') ? v : (typeof v?.score==='number' ? v.score : (typeof v?.value==='number' ? v.value : (typeof v?.avg==='number' ? v.avg : null))))
        .filter(v => typeof v==='number');
      const avg = vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length) : 3.0;
      total = ((avg-1)/4*100);
    }
    totalScoreEl.textContent = total.toFixed(1);

    const pct = data?.percentile?.pct;
    percentileEl.textContent = (typeof pct==='number') ? (pct.toFixed(1)+'%') : '—';
    pctNoteEl.textContent = data?.percentile?.provisional ? 'provisional (priors missing)' : '';

    const perImg = Array.isArray(data.per_image) ? data.per_image : [];
    perImageEl.textContent = perImg.map(it => {
      const v = scale100(it.total_weighted ?? it.total ?? it.avg ?? 0);
      const pose = it.pose || 'unknown';
      return `${(v||0).toFixed(1)} (${pose})`;
    }).join(' · ') || '—';

    renderBell(total);

    const pc = data.aggregate?.per_criterion || data.per_criterion || {};
    const buckets = bucketAverages(pc);
    radarChartFor(radarBucketsCanvas, ['P','D','S','Y','O'], ['P','D','S','Y','O'].map(k=> buckets[k]||0), COLORS.P);

    ['P','D','S','Y','O'].forEach(letter => {
      const entries = Object.entries(pc).filter(([code]) => code.startsWith(letter));
      const labels = entries.map(([code, it]) => (it && typeof it === 'object' && it.name) ? it.name : (FRIENDLY_NAME[code] || code));
      const dataArr = entries.map(([code, it]) => (typeof it==='number') ? it : (typeof it?.score==='number' ? it.score : (typeof it?.value==='number' ? it.value : (typeof it?.avg==='number' ? it.avg : 0))));
      radarChartFor(radarCanvases[letter], labels, dataArr, COLORS[letter]);
    });

    renderTable(pc);

    fillProtocol('#w1', data?.protocol?.weeks_1_4);
    fillProtocol('#w2', data?.protocol?.weeks_5_8);
    fillProtocol('#w3', data?.protocol?.weeks_9_12);
    document.querySelector('#data-needed').textContent = Array.isArray(data?.data_needed) && data.data_needed.length
      ? 'We down‑weighted dynamics. Add a 5–10s neutral→smile clip to refine Y‑scores.' : '';
  }

  // --- Score flow
  btnScore.addEventListener('click', async () => {
    hideErrors();
    if(files.length===0){ errNoPhotos.classList.add('show'); return; }
    const key = apiKeyEl.value.trim();
    if(!key){ errKeyMissing.classList.add('show'); return; }
    if(!validateKey(key)){ errKeyInvalid.classList.add('show'); return; }

    const params = {
      sex: sex(),
      age: parseInt(document.getElementById('age').value || '30',10),
      ethnicity: (document.getElementById('ethnicity').value || '').trim(),
      region_standard: document.getElementById('region').value,
      goals: []
    };

    overlay.classList.remove('hidden');
    try {
      const contents = buildContents(key, files, params);
      const data = await callGemini(key, contents);
      renderAll(data);
    } catch(err){
      const msg = String(err);
      if(/API key not valid|API_KEY_INVALID/.test(msg)) errKeyInvalid.classList.add('show');
      else if(/HTTP/.test(msg)) errNetwork.classList.add('show');
      else errModel.classList.add('show');
      console.error(err);
    } finally {
      overlay.classList.add('hidden');
    }
  });

  console.log('[App v2] Ready.');
})();