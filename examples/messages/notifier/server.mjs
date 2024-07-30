// server.js
export default function(bus, sessionId, pageId) {
  return () => {
    console.log("[Notifier] Cleaning up...");
  };
};

export const notify = (message, bus) => {
  console.log(`[Notifier] Sending notification: ${message}`);
  return `Notification sent: ${message}`;
};
