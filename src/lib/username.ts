/** Public, presentation-only handle rules. Server unique constraints remain authoritative. */
export const normalizeUsername = (value:string) => value.trim().toLowerCase();
export const validUsername = (value:string) => /^[a-z0-9_]{3,32}$/.test(normalizeUsername(value));
export const usernameSuggestions = (candidate:string):string[] => {
  const base=normalizeUsername(candidate).replace(/[^a-z0-9_]/g,'').slice(0,21) || 'trader';
  const names=[base+'_fx',base+'_trades',base+'_journal',base+'_'+new Date().getUTCFullYear()];
  return [...new Set(names.filter(x=>x.length>=3&&x.length<=32&&x!==normalizeUsername(candidate)))].slice(0,4);
};
