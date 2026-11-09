import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { reportDataError } from '@/lib/recovery';
import { DEFAULT_PROP_FIRM_RULE_VERSIONS, DEFAULT_PROVIDER_CATALOG, DEFAULT_PROVIDER_OFFERINGS } from '@/data/providerCatalog';
import type { ProviderCatalogEntry, ProviderOffering, PropFirmRuleVersion, ProviderChangeReview } from '@/lib/types';

export function useProviderCatalog() {
  const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
  const [offerings, setOfferings] = useState<ProviderOffering[]>([]);
  const [ruleVersions, setRuleVersions] = useState<PropFirmRuleVersion[]>([]);
  const [changeReviews, setChangeReviews] = useState<ProviderChangeReview[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    const [providerResult, offeringResult, rulesResult, reviewResult] = await Promise.all([
      supabase.from('provider_catalog').select('*').eq('is_active', true).order('name'),
      supabase.from('provider_offerings').select('*').eq('is_active', true).order('name'),
      supabase.from('prop_firm_rule_versions').select('*').order('verified_at', { ascending: false }),
      supabase.from('provider_change_reviews').select('*,provider_catalog(name),provider_source_watches(source_url)').eq('status', 'pending').order('detected_at', { ascending: false }).limit(50),
    ]);
    if (providerResult.error) { reportDataError('Failed to load provider directory:', providerResult.error); setProviders(DEFAULT_PROVIDER_CATALOG); }
    else setProviders(mergeCatalog(DEFAULT_PROVIDER_CATALOG, (providerResult.data || []) as ProviderCatalogEntry[]));
    if (offeringResult.error) { reportDataError('Failed to load provider offerings:', offeringResult.error); setOfferings(DEFAULT_PROVIDER_OFFERINGS); }
    else setOfferings(mergeCatalog(DEFAULT_PROVIDER_OFFERINGS, (offeringResult.data || []) as ProviderOffering[]));
    if (rulesResult.error) { reportDataError('Failed to load prop firm rules:', rulesResult.error); setRuleVersions(DEFAULT_PROP_FIRM_RULE_VERSIONS); }
    else setRuleVersions(mergeCatalog(DEFAULT_PROP_FIRM_RULE_VERSIONS, (rulesResult.data || []) as PropFirmRuleVersion[]));
    if (reviewResult.error) reportDataError('Failed to load provider review queue:', reviewResult.error);
    else setChangeReviews((reviewResult.data || []) as unknown as ProviderChangeReview[]);
    setLoading(false);
  }, []);
  useEffect(() => { fetchCatalog(); }, [fetchCatalog]);
  return { providers, offerings, ruleVersions, changeReviews, loading, fetchCatalog };
}

function mergeCatalog<T extends { id: string }>(defaults: T[], live: T[]): T[] {
  const merged = new Map(defaults.map(item => [item.id, item]));
  live.forEach(item => merged.set(item.id, { ...merged.get(item.id), ...item }));
  return [...merged.values()];
}
