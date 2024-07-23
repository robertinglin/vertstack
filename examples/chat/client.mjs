let myUsername = '';

const joinBtn = document.getElementById('join-btn');
const sendBtn = document.getElementById('send-btn');
const usernameInput = document.getElementById('username');
const messageInput = document.getElementById('message');
// Initially disable message input and send button
messageInput.disabled = true;
sendBtn.disabled = true;


const joinChat = ({ username }) => {
    myUsername = username;
    usernameInput.disabled = true;
    joinBtn.disabled = true;

    messageInput.disabled = false;
    sendBtn.disabled = false;

    bus('joinChat', { username });
    console.log(`Joined chat as ${username}`);
};

const sendMessage = ({ message }) => {
    if (myUsername && message) {
        bus('sendMessage', { message });
        document.getElementById('message').value = '';
    }
};

export const userJoined = ({ username }) => {
    const messages = document.getElementById('messages');
    messages.innerHTML += `<p><em>${username} has joined the chat.</em></p>`;
    messages.scrollTop = messages.scrollHeight;
};

export const receiveMessage = ({ username, message }) => {
    const messages = document.getElementById('messages');
    messages.innerHTML += `<p><strong>${username}:</strong> ${message}</p>`;
    messages.scrollTop = messages.scrollHeight;
};

export const updateUserList = ({ users }) => {
    const userList = document.getElementById('users');
    userList.innerHTML = users.map(user => `<li>${user}</li>`).join('');
};



joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username) {
        joinChat({ username });
    }
});

sendBtn.addEventListener('click', () => {
    const message = messageInput.value.trim();
    if (message) {
        sendMessage({ message });
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const message = messageInput.value.trim();
        if (message) {
            sendMessage({ message });
        }
    }
});
