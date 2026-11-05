// Draws the "window shrinking into its dock icon" animation (and the reverse).
const api = window.dockApi;
const lerp = (a, b, t) => a + (b - a) * t;
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

api.onGhost(({ dir, from, to, icon, title }) => {
  const win = dir === 'min' ? from : to;   // the window's own rectangle
  const dockIcon = dir === 'min' ? to : from;
  const el = document.createElement('div');
  el.className = 'ghost';
  el.style.width = win.width + 'px';
  el.style.height = win.height + 'px';
  el.innerHTML = `<div class="bar">${esc(title)}</div><div class="body">${icon ? `<img src="${icon}" alt="">` : ''}</div>`;
  document.body.append(el);

  // Three poses: the window, a narrowed "neck" halfway down, and the icon. Gives a genie-like swoop.
  const A = { x: win.x, y: win.y, w: win.width, h: win.height };
  const C = { x: dockIcon.x, y: dockIcon.y, w: dockIcon.width, h: dockIcon.height };
  const B = { w: lerp(A.w, C.w, 0.8), h: lerp(A.h, C.h, 0.4) };
  B.x = lerp(A.x + A.w / 2, C.x + C.w / 2, 0.55) - B.w / 2;
  B.y = lerp(A.y + A.h, C.y + C.h, 0.55) - B.h;
  const pose = (p, opacity, offset) => ({
    transform: `translate(${p.x}px, ${p.y}px) scale(${p.w / A.w}, ${p.h / A.h})`, opacity, ...(offset != null ? { offset } : {}),
  });
  let frames = [pose(A, 1), pose(B, 0.95, 0.5), pose(C, 0.35)];
  if (dir !== 'min') frames = [pose(C, 0.35), pose(B, 0.95, 0.5), pose(A, 1)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const anim = el.animate(frames, {
    duration: reduce ? 1 : dir === 'min' ? 400 : 300,
    easing: dir === 'min' ? 'cubic-bezier(.55,.05,.7,.4)' : 'cubic-bezier(.2,.65,.3,1)',
    fill: 'forwards',
  });
  anim.onfinish = () => { el.remove(); api.ghostDone(); };
});
