import { describe,it,expect,vi } from 'vitest';
import { createNativeManager } from '../src/native';

function fixture(){
  const calls:any[]=[];const messages:((data:any)=>void)[]=[];const disconnected:(()=>void)[]=[];
  const rect={left:0,top:0,width:1248,height:1032};let current={...rect};let rejectAction='';
  const port={onMessage:{addListener:(fn:any)=>messages.push(fn)},onDisconnect:{addListener:(fn:any)=>disconnected.push(fn)},postMessage:(message:any)=>{
    calls.push(message);queueMicrotask(()=>messages.forEach(fn=>fn({id:message.id,ok:message.action!==rejectAction,error:'Pair rejected',data:{}})));
  },disconnect:()=>{calls.push({action:'disconnect'});disconnected.forEach(fn=>fn());}};
  const api:any={permissions:{contains:async()=>true},runtime:{connectNative:()=>port},tabs:{get:async()=>({id:1,title:'Game One'})},windows:{get:async()=>({id:10,type:'popup',tabs:[{id:1}],...current}),update:async(_id:number,props:any)=>{calls.push({action:'chromeBounds',props});current={...current,...props};return {id:10,...current};}}};
  const onDisconnect=vi.fn();
  return {api,calls,onDisconnect,native:createNativeManager(api,onDisconnect),rect,monitor:{left:0,top:0,width:1920,height:1080},reject(action:string){rejectAction=action;}};
}
describe('optional native window bridge',()=>{
  it('requires optional permission before opening a native connection',async()=>{const f=fixture();f.api.permissions.contains=async()=>false;await expect(f.native.connect()).rejects.toThrow(/nativeMessaging/);expect(f.calls).toEqual([]);});
  it('pairs through an observed Chrome geometry challenge and restores probe bounds',async()=>{
    const f=fixture();await f.native.connect();await f.native.place('game',1,10,f.monitor,f.rect);
    expect(f.calls.map(c=>c.action)).toEqual(['hello','prepare','chromeBounds','pair','chromeBounds','place']);
    expect(f.calls[4].props).toEqual(f.rect);await f.native.stop();
  });
  it('restores probe geometry when pairing fails, without requesting native styles',async()=>{
    const f=fixture();f.reject('pair');await f.native.connect();await expect(f.native.place('game',1,10,f.monitor,f.rect)).rejects.toThrow('Pair rejected');
    expect(f.calls.filter(c=>c.action==='chromeBounds').at(-1).props).toEqual(f.rect);expect(f.calls.some(c=>c.action==='place')).toBe(false);await f.native.stop();
  });
  it('rejects normal or multi-tab browser windows before pairing',async()=>{
    const f=fixture();f.api.windows.get=async()=>({id:10,type:'normal',tabs:[{id:1},{id:2}],...f.rect});await f.native.connect();await expect(f.native.place('game',1,10,f.monitor,f.rect)).rejects.toThrow(/single-tab/);expect(f.calls.some(c=>c.action==='prepare')).toBe(false);await f.native.stop();
  });
  it('restores all paired windows before disconnecting and reuses validated pairs',async()=>{
    const f=fixture();await f.native.connect();await f.native.place('game',1,10,f.monitor,f.rect);await f.native.place('game',1,10,f.monitor,{...f.rect,width:960});
    expect(f.calls.filter(c=>c.action==='pair')).toHaveLength(1);await f.native.stop();expect(f.calls.slice(-2).map(c=>c.action)).toEqual(['restoreAll','disconnect']);expect(f.onDisconnect).toHaveBeenCalledTimes(1);
  });
});
