// server.js
let status = "Idle";

export default function(bus, sessionId, pageId) {
  // Initialize the client with the current status
  bus("main.status", status);

  // Cleanup function
  return () => {
    console.log("[Main] Cleaning up...");
  };
};

// Handle global events
export const event = (payload) => {
  console.log(`[Main] Received global event: ${payload.key}`);
  status = `Received global event: ${payload.key}`;
  return status;
};

// Handle private messages
export const _privateMessage = (data) => {
  console.log(`[Main] Received private message: ${data}`);
  status = `Received private message: ${data}`;
  return status;
};

// Handle cross-channel communication
export const $notifierNotify = (data) => {
  console.log(`[Main] Received notification: ${data}`);
  status = `Received notification: ${data}`;
  return status;
};
