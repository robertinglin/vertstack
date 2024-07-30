// server.js
let logs = [];

export default function(bus, sessionId, pageId) {
  // Initialize the client with current logs
  bus("logger.logs", logs);

  bus("*", (payload) => {
    log(`Server received event: ${payload.key}`);
    bus("logger.logs", logs);

  })

  return () => {
    console.log("[Logger] Cleaning up...");
  };
};

const log = (message) => {
  const logEntry = `[${new Date().toISOString()}] ${message}`;
  logs.push(logEntry);
  console.log(`[Logger] ${logEntry}`);
  return logs;
};
