// server.js
let count = 0;

export default function(bus, sessionId, pageId) {
  // Initialize the client with the current count
  bus("counter.value", count);

  return () => {
    console.log("[Counter] Cleaning up...");
  };
};

export const increment = () => {
  count++;
  return count;
};

export const decrement = () => {
  count--;
  return count;
};

export const reset = () => {
  count = 0;
  return count;
};

// vertical event handler
export const _verticalReset = () => {
  count = 0;
  return count;
};
