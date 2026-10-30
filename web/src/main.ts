import { Game } from './game';

const app = document.getElementById('app')!;
const ui = document.getElementById('ui')!;

// Block iOS rubber-banding / double-tap zoom inside the game view.
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

const game = new Game(app, ui);
game.start();
