const activeUsers = new Map();

export const joinChat = ({ username }, sessionId, bus) => {
  console.log('User Joined:', username);
  activeUsers.set(sessionId, username);
  bus('userJoined', { username }, '*');
  bus('updateUserList', { users: Array.from(activeUsers.values()) }, '*');
  return { success: true, message: `Welcome, ${username}!` };
};

export const sendMessage = ({ message }, sessionId, bus) => {
  const username = activeUsers.get(sessionId);
  if (!username) {
    return { success: false, message: 'You must join the chat first.' };
  }
  bus('receiveMessage', { username, message }, '*');
  return { success: true };
};

// Cleanup function to remove user when they disconnect
export default function(bus, sessionId) {
  return function cleanup() {
    const username = activeUsers.get(sessionId);
    if (username) {
      console.log('User disconnected:', username);
      activeUsers.delete(sessionId);
      bus('updateUserList', { users: Array.from(activeUsers.values()) }, '*');
    }
  };
};