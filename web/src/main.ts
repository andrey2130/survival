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
