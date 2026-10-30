import * as THREE from 'three';

export type BubbleKind = 'wood' | 'food' | 'cold' | 'happy' | 'angry' | 'zzz';

const GLYPH: Record<BubbleKind, string> = { wood: '🪵', food: '🍖', cold: '❄️', happy: '😊', angry: '😠', zzz: '💤' };
const mats = new Map<BubbleKind, THREE.SpriteMaterial>();

function material(kind: BubbleKind) {
  let m = mats.get(kind);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.arc(48, 44, 38, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(38, 76); g.lineTo(58, 76); g.lineTo(48, 92); g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(40,60,90,0.35)';
  g.lineWidth = 4;
  g.beginPath(); g.arc(48, 44, 38, 0, Math.PI * 2); g.stroke();
  g.font = '44px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(GLYPH[kind], 48, 46);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false });
  mats.set(kind, m);
  return m;
}

/** Small speech bubble above an NPC's head. */
export class Bubble {
  readonly sprite: THREE.Sprite;
  private kind: BubbleKind | null = null;
  constructor(parent: THREE.Object3D, y = 2.75) {
    this.sprite = new THREE.Sprite(material('wood'));
    this.sprite.scale.set(0.9, 0.9, 1);
    this.sprite.position.y = y;
    this.sprite.visible = false;
    this.sprite.renderOrder = 10;
    parent.add(this.sprite);
  }
  set(kind: BubbleKind | null) {
    if (kind === this.kind) return;
    this.kind = kind;
    this.sprite.visible = !!kind;
    if (kind) this.sprite.material = material(kind);
  }
}
