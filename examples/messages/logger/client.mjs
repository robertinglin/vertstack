// client.js
export const logs = (data) => {
  const logList = document.getElementById('logs');
  logList.innerHTML = data.map(log => `<li>${log}</li>`).join('');
};

document.getElementById('addLog').addEventListener('click', () => {
  bus('logger.log', 'Manual log entry');
});
