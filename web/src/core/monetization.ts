import { BALANCE } from '../config/balance';

/**
 * Monetization architecture. Real SDKs (AdMob / AppLovin / StoreKit / Play Billing) implement
 * these interfaces later; for now stub providers simulate them. Toggle with BALANCE.monetization.enabled.
 */
export type RewardedPlacement = 'double_income' | 'instant_repair' | 'double_offline';
export type ProductId = 'remove_ads' | 'starter_pack';

export interface AdsProvider {
  isRewardedReady(placement: RewardedPlacement): boolean;
  showRewarded(placement: RewardedPlacement): Promise<boolean>;
}

export interface IAPProvider {
  price(product: ProductId): string;
  purchase(product: ProductId): Promise<boolean>;
}

/** Stub: shows a fake "ad" overlay for a couple of seconds, then grants the reward. */
class StubAds implements AdsProvider {
  isRewardedReady() { return true; }
  showRewarded(placement: RewardedPlacement): Promise<boolean> {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'ad-stub';
      el.innerHTML = `<div class="ad-box"><div class="ad-title">Rewarded video</div><div class="ad-sub">(stub: ${placement})</div><div class="ad-bar"><i></i></div></div>`;
      document.body.appendChild(el);
      const bar = el.querySelector('i') as HTMLElement;
      const dur = BALANCE.monetization.adStubSeconds * 1000;
      const t0 = performance.now();
      const tick = () => {
        const k = Math.min(1, (performance.now() - t0) / dur);
        bar.style.width = `${k * 100}%`;
        if (k < 1) requestAnimationFrame(tick);
        else { el.remove(); resolve(true); }
      };
      tick();
    });
  }
}

class StubIAP implements IAPProvider {
  price(product: ProductId) { return product === 'remove_ads' ? '$2.99' : '$4.99'; }
  async purchase(_product: ProductId) { return window.confirm('Stub purchase — grant item?'); }
}

export class Monetization {
  ads: AdsProvider = new StubAds();
  iap: IAPProvider = new StubIAP();
  adsRemoved = false;
  starterPackBought = false;

  get enabled() { return BALANCE.monetization.enabled; }

  /** No ads during the first minutes of play. */
  canShowAds(playSeconds: number) {
    return this.enabled && playSeconds >= BALANCE.monetization.noAdsFirstSeconds;
  }

  /** Rewarded flow; "remove ads" owners get rewards instantly. */
  async rewarded(placement: RewardedPlacement): Promise<boolean> {
    if (!this.enabled) return false;
    if (this.adsRemoved) return true;
    if (!this.ads.isRewardedReady(placement)) return false;
    return this.ads.showRewarded(placement);
  }
}
