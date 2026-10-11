// Clicking the toolbar icon opens Coin Jar in a tab (or focuses the one already open).
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('index.html');
  try {
    const [existing] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
    if (existing && existing.tabId >= 0) {
      await chrome.tabs.update(existing.tabId, { active: true });
      if (existing.windowId >= 0) await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
  } catch (e) { /* getContexts needs Chrome 116+; fall through */ }
  chrome.tabs.create({ url });
});
