const activeInstances = new Map();

export const joinChat = async ({ username }, bus, sessionId, pageId) => {
  console.log('User Joined:', username, 'Session:', sessionId, 'Instance:', pageId);
  
  const instanceKey = `${sessionId}_${pageId}`;
  activeInstances.set(instanceKey, username);
  bus('updateUserList', { users: Array.from(activeInstances.values()) }, '*');
  return { success: true, message: `Welcome, ${username}!` };
};

export const sendMessage = ({ message }, bus, sessionId, pageId) => {
  console.log('received send message request:', message, 'Session:', sessionId, 'Instance:', pageId);
  const instanceKey = `${sessionId}_${pageId}`;
  const username = activeInstances.get(instanceKey);
  if (!username) {
    return { success: false, message: 'You must join the chat first.' };
  }
  bus('receiveMessage', { username, message }, '*');
  return { success: true };
};

export const privateMessage = ({ to, message }, bus, sessionId, pageId) => {
  console.log('received private message request:', to, message, 'Session:', sessionId, 'Instance:', pageId);
  const instanceKey = `${sessionId}_${pageId}`;
  const username = activeInstances.get(instanceKey);
  if (!username) {
    return { success: false, message: 'You must join the chat first.' };
  }
  const toInstanceKey = Array.from(activeInstances.keys()).find(key => activeInstances.get(key) === to);
  const [toSessionId, toPageId] = toInstanceKey.split('_');
  bus('receiveMessage', { username, message, private: true }, toSessionId, toPageId);
  return { success: true };
};

// Cleanup function to remove user when they disconnect
export default function(bus, sessionId, pageId) {
  console.log('User instance connected:', 'Session:', sessionId, 'Instance:', pageId);
  return function cleanup() {
    console.log('User instance disconnected:', 'Session:', sessionId, 'Instance:', pageId);
    const instanceKey = `${sessionId}_${pageId}`;
    const username = activeInstances.get(instanceKey);
    if (username) {
      console.log('User instance disconnected:', username, 'Session:', sessionId, 'Instance:', pageId);
      activeInstances.delete(instanceKey);
      
      bus('userLeft', { username }, '*');
      bus('updateUserList', { users: Array.from(activeInstances.values()) }, '*');
    }
  };
}