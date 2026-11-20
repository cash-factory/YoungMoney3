import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const source=process.argv[2] || 'connector/dist/YoungMoney3-Connector.zip';
const bytes=readFileSync(source);
const sha256=createHash('sha256').update(bytes).digest('hex');
const parts=[];
mkdirSync('public/downloads',{recursive:true});
for(let offset=0,index=0;offset<bytes.length;offset+=12*1024*1024,index++){
  const path='/downloads/connector-'+sha256.slice(0,12)+'-'+index+'.part';
  writeFileSync('public'+path,bytes.subarray(offset,offset+12*1024*1024));
  parts.push(path);
}
writeFileSync('public/downloads/connector-manifest.json',JSON.stringify({filename:'YoungMoney3-Connector.zip',size:bytes.length,sha256,parts},null,2)+'\n');
console.log('Packaged connector '+sha256+' ('+bytes.length+' bytes in '+parts.length+' assets)');
