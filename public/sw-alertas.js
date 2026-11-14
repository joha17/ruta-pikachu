// Al tocar un aviso de precio, abre la app (o la trae al frente) en Compras.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL('./#/compras', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.navigate(url).then((w) => (w || c).focus()).catch(() => c.focus());
      return self.clients.openWindow(url);
    }),
  );
});
