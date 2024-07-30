// client.js
export const status = (data) => {
  document.getElementById('status').textContent = data;
};

// Send a private message to the server
document.getElementById('sendPrivate').addEventListener('click', () => {
  bus('_privateMessage', 'Hello from client!');
});

// Trigger a cross-channel notification
document.getElementById('triggerNotification').addEventListener('click', () => {
  bus('#notifier.notify', 'Notification from main module');
});


// Trigger a local cross-channel notification
document.getElementById('triggerLocalNotification').addEventListener('click', () => {
  bus('$notifier.notify', 'Local notification from main module');
});