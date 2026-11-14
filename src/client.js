window.__ModuleLoader__.load({
  id: 'dsh-chatgpt',
  factory(require) {
    const { createElement: h, useEffect, useState } = require('react');
    const methods = { status: [], begin: ['clientId'], cancel: [], activate: ['clientId'], signOut: ['clientId'] };
    const namespace = 'dshChatgpt';
    const pkg = 'dsh-chatgpt';
    const descriptorId = method => `${pkg}#${namespace}/${method}`;
    const descriptors = Object.entries(methods).map(([method, parameters]) => ({
      id: descriptorId(method), service: 'dshChatgptAccount', namespace, method,
      invocation: { kind: 'direct' },
      parameters: parameters.map(wire => ({
        name: wire, wire, source: 'json', acceptsUndefined: method === 'begin',
        codec: {
          mode: 'strict', typeSymbol: `${descriptorId(method)}:${wire}`,
          create: () => ({ parse: value => value }),
        },
      })),
      result: { mode: 'src-json' },
      sourceLocation: { file: 'src/index.js', line: 1, column: 1 },
    }));

    function AccountCard({ ctx, mounting }) {
      const [state, setState] = useState();
      const [error, setError] = useState();
      const [busy, setBusy] = useState(false);
      async function call(method, ...params) {
        await mounting;
        const remote = ctx.get(`remote.${namespace}`);
        const result = await remote[method](...params);
        if (!result.ok) throw new Error(result.error?.message ?? 'ChatGPT account operation failed.');
        return result.value;
      }

      useEffect(() => {
        let stopped = false;
        let timer;
        async function refresh() {
          try {
            const next = await call('status');
            if (stopped) return;
            setState(next);
            setError(undefined);
            if (next.pending) timer = setTimeout(refresh, 1200);
          } catch (failure) {
            if (!stopped) setError(previous => previous ?? failure.message);
          }
        }
        void refresh();
        return () => { stopped = true; clearTimeout(timer); };
      }, [state?.pending]);

      async function action(method, ...params) {
        setBusy(true);
        try {
          setState(await call(method, ...params));
          setError(undefined);
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      }

      const button = (label, method, ...params) => h('button', {
        type: 'button', disabled: busy, onClick: () => void action(method, ...params),
        ...(method === 'begin' ? { 'data-oai-siwc-button': '' } : {}),
      }, label);
      const group = { display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' };
      return h('div', { style: { display: 'grid', gap: '0.65rem' } },
        error || state?.error ? h('div', { role: 'alert' }, error ?? state.error) : null,
        ...(state?.accounts ?? []).map(account => h('div', { key: account.clientId, style: group },
          h('span', null, account.email || 'ChatGPT account', ' · ', account.clientId.slice(-8),
            account.authorized ? ' · Plan access' : ' · Authorization required',
            account.active ? ' · Active' : ''),
          account.active ? null : button('Use account', 'activate', account.clientId),
          account.authorized
            ? button('Sign out', 'signOut', account.clientId)
            : button('Continue with ChatGPT', 'begin', account.clientId))),
        state?.pending
          ? h('div', { style: group },
            h('a', { href: state.pending, target: '_blank', rel: 'noopener noreferrer', 'data-oai-siwc-button': '' }, 'Continue with ChatGPT'),
            button('Cancel', 'cancel'))
          : state ? button(state.accounts.length ? 'Add ChatGPT account or workspace' : 'Continue with ChatGPT', 'begin', null) : null,
        h('a', { href: 'https://chatgpt.com/settings/usage', target: '_blank', rel: 'noopener noreferrer' }, 'Manage ChatGPT usage'));
    }

    return {
      inject: ['slots', 'remote'],
      apply(ctx) {
        const mounting = ctx.remote.$mount({ package: pkg, descriptors });
        void mounting.catch(() => {});
        ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register(
          { name: 'settings.models.provider-card', key: pkg }, () => h(AccountCard, { ctx, mounting }),
        ));
      },
    };
  },
});
