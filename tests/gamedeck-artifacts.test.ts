import { it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
it('GameDeck requests only metadata, persistence and display permissions',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../public/manifest.json',import.meta.url),'utf8'));
  expect(manifest.manifest_version).toBe(3);expect(manifest.permissions).toEqual(['tabs','storage','system.display']);
  expect(manifest.host_permissions).toBeUndefined();expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.optional_permissions).toEqual(['nativeMessaging','scripting']);
  expect(manifest.optional_host_permissions).toEqual(['https://*.disneyplus.com/*','https://*.dazn.com/*','https://*.espn.com/*']);
  expect(Object.values(manifest.commands).filter((v:any)=>v.suggested_key)).toHaveLength(4);
});
it('GameDeck has no capture, iframe, cookie or remote-debugging implementation',async()=>{
  for(const file of await readdir(new URL('../src/',import.meta.url))){
    if(!/\.(tsx?|html)$/.test(file))continue;
    const code=await readFile(new URL(`../src/${file}`,import.meta.url),'utf8');
    expect(code,file).not.toMatch(/getDisplayMedia|captureVisibleTab|tabCapture|desktopCapture|chrome\.cookies|document\.cookie|<iframe|remote-debugging|chrome\.debugger/);
  }
});
