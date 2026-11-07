import { createController } from './engine.js';
const controller = createController(chrome);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  controller.request({ ...message, controllerWindowId: sender.tab?.windowId }).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(id => controller.closed(id).catch(console.error));
chrome.windows.onFocusChanged.addListener(id => controller.focus(id).catch(console.error));
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  controller.focus(windowId).catch(console.error);
});
chrome.commands.onCommand.addListener(command => controller.request({ type: command === 'next-game' ? 'NEXT' : 'LISTEN', id: null }).catch(console.error));
chrome.action.onClicked.addListener(async tab => {
  if (tab?.id != null) await controller.rememberSource(tab.id);
  const url = chrome.runtime.getURL('dashboard.html');
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(t => t.url?.startsWith(url));
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else await chrome.windows.create({ url, type: 'popup', width: 1360, height: 900 });
});
