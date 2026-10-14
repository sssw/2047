// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
let active = [], cleanup = 0;

export function stopCelebration(container) {
  clearTimeout(cleanup);
  for (const animation of active) animation.cancel();
  active = [];
  container.replaceChildren();
}

export function celebrate(container, reducedMotion = false) {
  stopCelebration(container);
  if (reducedMotion) return;
  const fragment = document.createDocumentFragment();
  const colors = ['#d4b65d', '#a6c763', '#4d8561', '#c47f5d'];
  for (let i = 0; i < 32; i++) {
    const piece = document.createElement('i');
    piece.style.left = `${3 + (i * 37) % 94}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.width = `${4 + i % 3}px`;
    piece.style.height = `${8 + i % 5}px`;
    fragment.append(piece);
  }
  container.append(fragment);
  active = [...container.children].map((piece, i) => {
    const drift = (i % 2 ? 1 : -1) * (24 + i * 3);
    return piece.animate([
      { transform: `translate3d(0,-20px,0) rotate(${i * 23}deg)`, opacity: 0 },
      { opacity: .95, offset: .1 },
      { transform: `translate3d(${drift}px,${Math.min(innerHeight * .8, 720)}px,0) rotate(${i * 23 + 420}deg)`, opacity: 0 }
    ], { duration: 1200 + (i % 5) * 100, delay: (i % 7) * 22, easing: 'cubic-bezier(.2,.45,.5,1)', fill: 'both' });
  });
  // Compositor transforms only: no frame loop, layout reads, or input interception.
  cleanup = setTimeout(() => stopCelebration(container), 1900);
}
