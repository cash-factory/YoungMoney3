#!/usr/bin/env node
/** Read-only audit: public legacy binary exposure (no deletion, no authentication changes). */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const REPO='cash-factory/YoungMoney3';
const ASSET='YoungMoney3.Connector.exe';

export function publicClassicAssets(releases) {
  if (!Array.isArray(releases)) throw new Error('GitHub releases response is not an array');
  return releases.flatMap(release => release && release.draft !== true &&
    Array.isArray(release.assets)
    ? release.assets.filter(asset => asset?.name === ASSET &&
        typeof asset.browser_download_url === 'string' &&
        asset.browser_download_url.startsWith(
          'https://github.com/'+REPO+'/releases/download/'))
      .map(asset => ({tag:release.tag_name,name:asset.name,url:asset.browser_download_url}))
    : []);
}

async function audit() {
  const assets=[];
  const all=[];
  let next='https://api.github.com/repos/'+REPO+'/releases?per_page=100';
  for(let page=0;next && page<10;page++){
    const headers={'Accept':'application/vnd.github+json','User-Agent':'YMFX-legacy-binary-audit'};
    if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;
    const response=await fetch(next,{headers});
    if(!response.ok)throw new Error('GitHub release inventory could not be checked (HTTP '+response.status+')');
    all.push(...await response.json());
    const links=response.headers.get('link')||'';
    next=(links.match(/<([^>]+)>;\s*rel="next"/)||[])[1]||'';
    if(next && !next.startsWith('https://api.github.com/repos/'+REPO+'/releases?'))
      throw new Error('Untrusted pagination URL');
    if(next && page===9)throw new Error('Release inventory exceeds safety page limit');
  }
  assets.push(...publicClassicAssets(all));
  const tags=[...new Set(assets.map(x=>x.tag))].sort();
  console.log(JSON.stringify({
    checked_release_count:all.length,
    public_classic_executables:assets.length,
    affected_release_tags:tags,
    public_binary_exposure_cleared:assets.length===0
  },null,2));
  // In strict mode, any public Classic EXE is an unresolved rollout blocker.
  if(process.argv.includes('--strict') && assets.length)process.exitCode=1;
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  audit().catch(error=>{console.error(String(error.message||error));process.exitCode=2;});
}
