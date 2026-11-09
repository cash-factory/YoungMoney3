/** Stable public hook API. Domain hooks are implemented in focused modules under ./data. */
export { useTrades } from './useTrades';
export { useProviderCatalog } from './data/catalog';
export { useMarketInstruments, useInstrumentFavorites } from './data/instruments';
export { useTradingAccounts, useTradingAccountAdjustments } from './data/accounts';
export { useJournalEntries } from './data/journal';
export { useProfiles } from './data/profiles';
export { useStrategies, useStrategyEntryModels, useStrategyChecklist, useSetups } from './data/strategies';
export { useRiskSettings, useChecklist, useTradingPlans, useTradingRules } from './data/riskPlans';
export { useGoals, useGoalTemplates } from './data/goals';
export { useBacktests, useForwardTrades, useTestSessions, useTestTrades, useAllTestTrades } from './data/testing';
export { useMarketEvents, useResources, useNotes, useStudyMaterials, useBrokers, useChartingTools, useWeeklyReviews } from './data/knowledge';
