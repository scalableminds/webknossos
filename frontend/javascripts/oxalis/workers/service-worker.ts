// @ts-nocheck

declare const self: ServiceWorkerGlobalScope;
export {};

self.addEventListener("installation", function (event: PushEvent) {
  self.skipWaiting();
});
self.addEventListener("push", function (event: PushEvent) {
  const options = {
    body: event.data.text(),
    icon: "/path-to-icon.png", // Replace with the path to your notification icon
    badge: "/path-to-badge.png", // Replace with the path to your notification badge
  };

  event.waitUntil(self.registration.showNotification("Push Notification", options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  // You can customize what happens when the user clicks the notification.
  // For example, you can open a specific URL.
  event.waitUntil(clients.openWindow("/your-target-url"));
});
