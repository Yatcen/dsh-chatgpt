import { fetch as proxyFetch, ProxyAgent } from 'undici';

export function createTransport(proxySetting) {
  let proxy;
  let dispatcher;

  function currentProxy() {
    const value = proxySetting()?.trim();
    if (!value) return undefined;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
          url.pathname !== '/' || url.search || url.hash) throw new Error();
      return url.origin;
    } catch {
      throw Object.assign(new Error('Enter an HTTP or HTTPS proxy URL without credentials in the ChatGPT plugin settings.'), {
        code: 'chatgpt_invalid_proxy',
      });
    }
  }

  return {
    async fetch(url, options = {}) {
      const host = new URL(url).hostname;
      const proxyUrl = currentProxy();
      if (proxyUrl !== proxy) {
        if (dispatcher) void dispatcher.close().catch(() => {});
        dispatcher = proxyUrl ? new ProxyAgent({ uri: proxyUrl, allowH2: false }) : undefined;
        proxy = proxyUrl;
      }
      const request = { ...options, redirect: 'error' };
      try {
        return dispatcher ? await proxyFetch(url, { ...request, dispatcher }) : await globalThis.fetch(url, request);
      } catch (cause) {
        if (options.signal?.aborted) throw cause;
        throw Object.assign(new Error(
          `Could not connect to ${host}. Check whether the current proxy can reach this OpenAI endpoint.`,
          { cause },
        ), { code: 'TRANSPORT' });
      }
    },
    codexEnvironment() {
      const value = currentProxy();
      return value ? { HTTPS_PROXY: value, HTTP_PROXY: value, NO_PROXY: 'localhost,127.0.0.1,::1' } : {};
    },
    async close() {
      await dispatcher?.destroy();
    },
  };
}
