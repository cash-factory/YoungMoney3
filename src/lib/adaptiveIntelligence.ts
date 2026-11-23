/** Transparent task prioritisation. Recommendations never advise entering or increasing a trade. */
import type { DeskMode } from '@/components/AdaptiveTradingDesk';

export interface DeskSignals {
  hasAccounts: boolean;
  hasPlan: boolean;
  hasRiskSettings: boolean;
  pendingReviews: number;
  reviewed: number;
  sealedReviews: number;
  recentChanged: number;
  recentAssessed: number;
  activeExperiments: number;
  evidenceAvailable: boolean;
}
export interface DeskRecommendation {
  mode: DeskMode;
  reason: string;
  basis: string;
}
export function recommendDeskFocus(s: DeskSignals): DeskRecommendation {
  if (!s.hasAccounts) return {
    mode:'prepare', reason:'Set up a trading account to organize your workspace.',
    basis:'There is no configured journal account in this workspace.',
  };
  if (!s.hasPlan || !s.hasRiskSettings) return {
    mode:'prepare',reason:'Review your plan and protective limits before logging activity.',
    basis:'A trading plan or risk-policy record is missing. This does not prevent a deliberate pass.',
  };
  if (!s.evidenceAvailable) return {
    mode:'prepare',reason:'Review your workspace while decision evidence reconnects.',
    basis:'Decision reviews could not be verified, so the desk will not infer pending work or behavioral patterns.',
  };
  if (s.pendingReviews > 0) return {
    mode:'review', reason:s.pendingReviews+' '+(s.pendingReviews===1?'decision is':'decisions are')+' awaiting review.',
    basis:'Only unreviewed trade/position references in the selected account and origin are counted.',
  };
  if (s.recentAssessed >= 8 && s.recentChanged * 2 >= s.recentAssessed) return {
    mode:'review',reason:'Revisit your documented deviations from the plan.',
    basis:s.recentChanged+' of '+s.recentAssessed+' recent recorded judgements describe a changed course. These are self-reports, not diagnoses.',
  };
  if (s.activeExperiments > 0) return {
    mode:'analyze',reason:s.activeExperiments+' active '+(s.activeExperiments===1?'experiment':'experiments')+' to observe.',
    basis:'Only active improvement studies for the selected account or all-account scope are counted; outcomes remain unproven.',
  };
  if (s.reviewed >= 12 && s.sealedReviews >= 5) return {
    mode:'analyze',reason:'Review the evidence behind your documented decision patterns.',
    basis:s.reviewed+' reviews, including '+s.sealedReviews+' server-sealed pre-reveal judgements, are available for this account view.',
  };
  return {
    mode:'capture',reason:'Document an observation or deliberate pass at your own pace.',
    basis:'The journal has limited review evidence. This is not a recommendation to trade.',
  };
}
