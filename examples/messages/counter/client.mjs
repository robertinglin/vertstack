// client.js
export const value = (data) => {
  document.getElementById('count').textContent = data;
};

document.getElementById('increment').addEventListener('click', () => {
  bus('counter.increment').then(value);
});

document.getElementById('decrement').addEventListener('click', () => {
  bus('counter.decrement').then(value);
});

document.getElementById('reset').addEventListener('click', () => {
  bus('counter.reset').then(value);
});

document.getElementById('verticalReset').addEventListener('click', () => {
  bus('_verticalReset').then(value);
});
