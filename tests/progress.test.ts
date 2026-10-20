import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventSchema, projectProgress, snapshotSchema, type ProgressEvent, type Operation } from '../src/lib/cloud/model.ts';
import { Journal } from '../src/lib/cloud/journal.ts';
import { startSync } from '../src/lib/cloud/sync.ts';
import { useProgress } from '../src/lib/storage/progress.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
let n = 0;
const event = (operation: Operation, at = '2026-10-20T10:00:00.000Z'): ProgressEvent => ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`, at, operation });
class MemoryStorage implements Storage {
  values = new Map<string,string>();
  get length() { return this.values.size; }
  key(i: number) { return [...this.values.keys()][i] ?? null; }
  getItem(k: string) { return this.values.get(k) ?? null; }
  setItem(k: string, v: string) { this.values.set(k, v); }
  removeItem(k: string) { this.values.delete(k); }
  clear() { this.values.clear(); }
}
test('concurrent devices keep every completed unit and the best score', () => {
  const a = event({ type: 'score', unitId: 'greetings', score: .9 });
  const b = event({ type: 'score', unitId: 'greetings', score: .3 });
  const c = event({ type: 'score', unitId: 'numbers', score: 1 });
  const s = projectProgress([c, b, a]);
  assert.equal(s.unitProgress.greetings.bestScore, .9);
  assert.equal(s.unitProgress.greetings.status, 'completed');
  assert.equal(s.unitProgress.numbers.status, 'completed');
  assert.deepEqual(s, projectProgress([a,c,b]));
});
test('retrying the same events never doubles XP, minutes, or exam attempts', () => {
  const events = [event({type:'minutes',minutes:12}), event({type:'xp',skill:'speaking',amount:8}), event({type:'exam',examId:'a1',result:{autoPoints:40,autoMax:50,selfPoints:null,total:null,passed:null}})];
  const s = projectProgress([...events,...events]);
  assert.equal(s.totalStudyMinutes,12); assert.equal(s.skillXp.speaking,8); assert.equal(s.examResults.a1.attempts,1);
});
test('vocabulary deletion survives stale-device replay; a later add is deliberate', () => {
  const add = event({type:'add',key:'bonjour'},'2026-10-18T10:00:00.000Z');
  const remove = event({type:'remove',key:'bonjour'},'2026-10-19T10:00:00.000Z');
  assert.equal(projectProgress([remove,add,add]).vocab.bonjour, undefined);
  assert.ok(projectProgress([remove,add,event({type:'add',key:'bonjour'})]).vocab.bonjour);
});
test('review due dates use study time, not the later synchronization time', () => {
  const s=projectProgress([event({type:'review',key:'bonjour',rating:'good'},'2026-10-01T10:00:00.000Z')]);
  assert.equal(s.vocab.bonjour.lastISO,'2026-10-01'); assert.equal(s.vocab.bonjour.dueISO,'2026-10-02');
});
test('study streak combines days across devices, deduplicates days and handles gaps', () => {
  const a=event({type:'study'},'2026-10-18T10:00:00.000Z'); const b=event({type:'study'},'2026-10-19T10:00:00.000Z');
  assert.equal(projectProgress([b,a,b]).streakDays,2);
  assert.equal(projectProgress([a,event({type:'study'},'2026-10-20T10:00:00.000Z')]).streakDays,1);
});
test('journal survives reloads, separates accounts/projects, and preserves corrupt data', () => {
  const storage=new MemoryStorage(); const a=new Journal(storage,'project','userA'); const e=event({type:'study'}); a.put(e);
  assert.deepEqual(new Journal(storage,'project','userA').read(),[e]);
  assert.equal(new Journal(storage,'project','userB').read().length,0);
  assert.equal(new Journal(storage,'different','userA').read().length,0);
  storage.setItem(a.prefix+'broken','not-json');
  assert.throws(()=>a.read()); assert.equal(storage.getItem(a.prefix+'broken'),'not-json');
});
test('two tabs writing distinct activities never overwrite one another',()=>{
  const storage=new MemoryStorage();const a=new Journal(storage,'p','u'),b=new Journal(storage,'p','u');
  a.put(event({type:'minutes',minutes:10})); b.put(event({type:'minutes',minutes:20}));
  assert.equal(projectProgress(a.read()).totalStudyMinutes,30);
});
test('invalid imports and future schema versions are rejected',()=>{
  assert.equal(snapshotSchema.safeParse({totalStudyMinutes:-1}).success,false);
  assert.equal(snapshotSchema.safeParse({version:2}).success,false);
  assert.equal(eventSchema.safeParse({...event({type:'study'}),at:'yesterday'}).success,false);
});
test('reset and import retain later study events in deterministic order',()=>{
  const imported=snapshotSchema.parse({totalStudyMinutes:50});
  const events=[event({type:'minutes',minutes:10},'2026-10-17T10:00:00.000Z'),event({type:'reset'},'2026-10-18T10:00:00.000Z'),event({type:'import',snapshot:imported},'2026-10-19T10:00:00.000Z'),event({type:'minutes',minutes:5})];
  assert.equal(projectProgress(events.reverse()).totalStudyMinutes,55);
});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('offline phone + online laptop converge; reload, restore and logout are safe',async()=>{
  const remote=new Map<string,{user_id:string,id:string,event:ProgressEvent}>();
  let online=false;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{get onLine(){return online;}}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
  Object.defineProperty(globalThis,'document',{configurable:true,value:Object.assign(new EventTarget(),{visibilityState:'visible'})});
  const phone=new MemoryStorage(),laptop=new MemoryStorage();
  const client={from:()=>({
    upsert:async(rows:Array<{user_id:string,id:string,event:ProgressEvent}>)=>{rows.forEach(r=>{const k=r.user_id+r.id;if(!remote.has(k))remote.set(k,r);});return{error:null};},
    select:()=>({eq:(_key:string,user:string)=>({order:()=>({range:async(start:number,end:number)=>({data:[...remote.values()].filter(r=>r.user_id===user).sort((a,b)=>a.id.localeCompare(b.id)).slice(start,end+1),error:null})})})}),
  })} as unknown as SupabaseClient;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:phone});
  let c=startSync(client,'p','a',()=>{});
  try {useProgress.getState().recordScore('greetings',1);useProgress.getState().addStudyMinutes(10);assert.equal(remote.size,0);} finally {c.stop();}
  assert.throws(()=>useProgress.getState().addStudyMinutes(1));
  online=true;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:laptop});
  c=startSync(client,'p','a',()=>{});
  try{await tick();useProgress.getState().recordScore('numbers',1);useProgress.getState().addStudyMinutes(20);await c.retry();}finally{c.stop();}
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:phone});
  c=startSync(client,'p','a',()=>{});
  let backup: string;
  try{await tick();await c.retry();assert.equal(useProgress.getState().totalStudyMinutes,30);assert.equal(useProgress.getState().unitProgress.numbers.status,'completed');backup=c.exportBackup();await c.retry();assert.equal(useProgress.getState().totalStudyMinutes,30);}finally{c.stop();}
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:new MemoryStorage()});
  c=startSync(client,'p','a',()=>{});
  try{await tick();assert.equal(useProgress.getState().totalStudyMinutes,30);c.restoreBackup(backup);await c.retry();assert.equal(useProgress.getState().totalStudyMinutes,30);}finally{c.stop();}
  c=startSync(client,'p','b',()=>{});
  try{await tick();assert.equal(useProgress.getState().totalStudyMinutes,0);assert.equal(Object.keys(useProgress.getState().unitProgress).length,0);}finally{c.stop();}
});
