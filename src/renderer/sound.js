const api = window.dockApi;
const $ = (id) => document.getElementById(id);
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"';
const ICON = {
  speaker: `<svg ${S}><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>`,
  speakerOff: `<svg ${S}><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/></svg>`,
  mic: `<svg ${S}><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`,
  micOff: `<svg ${S}><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"/></svg>`,
  check: `<svg ${S}><path d="m5 12 5 5 9-10"/></svg>`,
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let st = null;
let dragging = { vol: false, micVol: false };

function devices(el, list, empty) {
  el.innerHTML = list.length
    ? list.map((d) => `<button class="dev${d.def ? ' on' : ''}" data-id="${esc(d.id)}">${ICON.check}<span title="${esc(d.name)}">${esc(d.name)}</span></button>`).join('')
    : `<p class="empty">${empty}</p>`;
}

function render(next) {
  st = next;
  $('wait').hidden = true;
  $('body').hidden = false;
  if (!dragging.vol) $('vol').value = Math.round(st.vol * 100);
  if (!dragging.micVol) $('micVol').value = Math.round(st.micVol * 100);
  $('volOut').textContent = Math.round(st.vol * 100) + '%';
  $('micOut').textContent = Math.round(st.micVol * 100) + '%';
  $('mute').innerHTML = st.mute ? ICON.speakerOff : ICON.speaker;
  $('mute').classList.toggle('off', st.mute);
  $('mute').setAttribute('aria-label', st.mute ? 'Unmute' : 'Mute');
  $('micMute').innerHTML = st.micMute ? ICON.micOff : ICON.mic;
  $('micMute').classList.toggle('off', st.micMute);
  $('micMute').setAttribute('aria-label', st.micMute ? 'Unmute microphone' : 'Mute microphone');
  devices($('outs'), st.out, 'No speakers or headphones found');
  devices($('ins'), st.in, 'No microphones found');
  api.soundSize($('panel').getBoundingClientRect().height + 8);
}

function choose(e) {
  const b = e.target.closest('.dev');
  if (!b || b.classList.contains('on')) return;
  api.soundCmd('set ' + b.dataset.id);
  b.parentElement.querySelectorAll('.dev').forEach((x) => x.classList.toggle('on', x === b)); // show it right away
}
$('outs').addEventListener('click', choose);
$('ins').addEventListener('click', choose);

for (const [id, cmd, out] of [['vol', 'vol', 'volOut'], ['micVol', 'micvol', 'micOut']]) {
  const el = $(id);
  el.addEventListener('pointerdown', () => { dragging[id] = true; });
  el.addEventListener('pointerup', () => { dragging[id] = false; });
  el.addEventListener('input', () => {
    $(out).textContent = el.value + '%';
    api.soundCmd(`${cmd} ${(el.value / 100).toFixed(2)}`);
  });
}
$('mute').addEventListener('click', () => { if (st) api.soundCmd('mute ' + (st.mute ? 0 : 1)); });
$('micMute').addEventListener('click', () => { if (st) api.soundCmd('micmute ' + (st.micMute ? 0 : 1)); });
$('more').addEventListener('click', () => api.soundSettings());

api.onSound(render);
// Don't wait for the next update: show the devices straight away
api.getState().then((st) => { if (st && st.sound) render(st.sound); });
api.soundSize($('panel').getBoundingClientRect().height + 8);
