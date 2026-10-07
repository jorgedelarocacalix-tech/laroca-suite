// Service Worker de CaliFon App — habilita instalación y notificaciones push
self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'CaliFon App', body: e.data ? e.data.text() : '' }; }

  var title = data.title || 'CaliFon App';
  var options = {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: data.url || './' }
  };
  if (data.image) options.image = data.image;

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientsArr) {
      for (var i = 0; i < clientsArr.length; i++) {
        if (clientsArr[i].url === url && 'focus' in clientsArr[i]) {
          return clientsArr[i].focus();
        }
      }
      // Si CaliFon ya está abierta (iPhone la deja en segundo plano), openWindow solo la
      // enfoca sin cambiar de página y el mensaje se pierde: navegar esa ventana al enlace.
      var abierta = clientsArr.find(function (c) { return 'navigate' in c; });
      if (abierta) {
        return abierta.navigate(url).then(function (c) { return (c || abierta).focus(); })
          .catch(function () { return self.clients.openWindow(url); });
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
