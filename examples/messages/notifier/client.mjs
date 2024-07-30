// client.js
export const notify = (data) => {
  document.getElementById('notification').textContent = data;
};

document.getElementById('sendNotification').addEventListener('click', () => {
  bus('notifier.notify', 'Test notification');
});
