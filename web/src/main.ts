import { Game } from './game';

const app = document.getElementById('app')!;
const ui = document.getElementById('ui')!;

// Block iOS rubber-banding / pinch zoom on the game view only. Menus (anything marked .scroll-ok)
// must keep native touch scrolling, so their touches are left alone.
const scrollable = (t: EventTarget | null) => t instanceof Element && !!t.closest('.modal, .dbg, .scroll-ok, textarea');
document.addEventListener('touchmove', (e) => { if (!scrollable(e.target)) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

const game = new Game(app, ui);
game.start();

// Offline cache + reliable updates for the home-screen web app (each build has a new cache name).
// Not used inside the iOS app (the page is a local file there).
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller; // false on the very first visit
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // a new version took over: reload once so the player runs it (progress is autosaved)
    if (reloaded || !hadController) return;
    reloaded = true;
    game.saver.save();
    location.reload();
  });
}
