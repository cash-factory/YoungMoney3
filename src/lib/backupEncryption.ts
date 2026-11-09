const ARCHIVE_FORMAT = 'youngmoney3-encrypted-backup';
const ARCHIVE_VERSION = 1;
const ITERATIONS = 310000;

export interface EncryptedBackup {
  format: typeof ARCHIVE_FORMAT;
  version: typeof ARCHIVE_VERSION;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  cipher: 'AES-256-GCM';
  salt: string;
  iv: string;
  ciphertext: string;
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset=0;offset<bytes.length;offset+=32768) binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  return btoa(binary);
}
function decode(base64: string): Uint8Array {
  const chars=atob(base64);
  return Uint8Array.from(chars,c=>c.charCodeAt(0));
}
export function isEncryptedBackup(value: unknown): value is EncryptedBackup {
  if (!value || typeof value!=='object') return false;
  const archive=value as Partial<EncryptedBackup>;
  return archive.format===ARCHIVE_FORMAT && archive.version===ARCHIVE_VERSION
    && archive.kdf==='PBKDF2-SHA256' && archive.cipher==='AES-256-GCM'
    && archive.iterations===ITERATIONS && typeof archive.salt==='string'
    && typeof archive.iv==='string' && typeof archive.ciphertext==='string';
}
async function makeKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const master=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},
    master,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptBackup(text: string, password: string): Promise<EncryptedBackup> {
  if(password.length<12)throw new Error('Use a backup passphrase of at least 12 characters.');
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await makeKey(password,salt);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(text));
  return {format:ARCHIVE_FORMAT,version:ARCHIVE_VERSION,kdf:'PBKDF2-SHA256',iterations:ITERATIONS,
    cipher:'AES-256-GCM',salt:encode(salt),iv:encode(iv),ciphertext:encode(new Uint8Array(ciphertext))};
}
export async function decryptBackup(archive: EncryptedBackup, password: string): Promise<string> {
  if(!isEncryptedBackup(archive))throw new Error('Unsupported encrypted archive.');
  if(!password)throw new Error('Enter your backup passphrase.');
  try{
    const salt=decode(archive.salt),iv=decode(archive.iv),ciphertext=decode(archive.ciphertext);
    if(salt.length!==16||iv.length!==12||ciphertext.length<16)throw new Error('Corrupted encrypted archive.');
    const key=await makeKey(password,salt);
    return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ciphertext));
  }catch{throw new Error('Could not unlock the backup. Check its passphrase and integrity.');}
}
