import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPreference, savePreference } from './browserPreferences.ts';

test('browser appearance preferences tolerate unavailable storage',()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  try {
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('blocked')}});
    assert.equal(readPreference('journal-theme'),null);
    assert.doesNotThrow(()=>savePreference('journal-theme','light'));
    const data=new Map<string,string>();
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
      getItem(key:string){return data.get(key)??null;},
      setItem(key:string,value:string){data.set(key,value);},
    }});
    savePreference('journal-palette','obsidian');
    assert.equal(readPreference('journal-palette'),'obsidian');
  } finally {
    if(old)Object.defineProperty(globalThis,'localStorage',old);
    else Reflect.deleteProperty(globalThis,'localStorage');
  }
});
