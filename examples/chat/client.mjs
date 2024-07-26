let myUsername = '';

const joinBtn = document.getElementById('join-btn');
const sendBtn = document.getElementById('send-btn');
const usernameInput = document.getElementById('username');
const messageInput = document.getElementById('message');
const messagesContainer = document.getElementById('messages');
const userList = document.getElementById('user-list');
const recipientSelect = document.getElementById('recipient-select');

// Initially disable message input and send button
messageInput.disabled = true;
sendBtn.disabled = true;

const joinChat = async ({ username }) => {
    myUsername = username;
    usernameInput.disabled = true;
    joinBtn.disabled = true;

    messageInput.disabled = false;
    sendBtn.disabled = false;

    const res = await bus('joinChat', { username });
    console.log(`Joined chat as ${username}`, res['#']);
    messagesContainer.innerHTML += `<p><em>${res.value.message}</em></p>`;
};

const sendMessage = ({ message, to }) => {
    if (myUsername && message) {
        if (to) {
            bus('privateMessage', { to, message });
            messagesContainer.innerHTML += `<p class="private-msg"><strong>You to ${to}:</strong> ${message}</p>`;
        } else {
            bus('sendMessage', { message });
        }
        messageInput.value = '';
    }
};

export const userJoined = ({ username }) => {
    messagesContainer.innerHTML += `<p><em>${username} has joined the chat.</em></p>`;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
};

export const userLeft = ({ username }) => {
    messagesContainer.innerHTML += `<p><em>${username} has left the chat.</em></p>`;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    // Remove user from recipient select
    const option = recipientSelect.querySelector(`option[value="${username}"]`);
    if (option) option.remove();
};

export const receiveMessage = ({ username, message, private: isPrivate }) => {
    const messageClass = isPrivate ? 'private-msg' : '';
    const prefix = isPrivate ? '(Private) ' : '';
    messagesContainer.innerHTML += `<p class="${messageClass}"><strong>${prefix}${username}:</strong> ${message}</p>`;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
};

export const updateUserList = ({ users }) => {
    userList.innerHTML = '<h3>Active Users</h3>' + users.map(user => `<li>${user}</li>`).join('');
    
    // Update recipient select
    const currentOptions = Array.from(recipientSelect.options).map(option => option.value);
    users.forEach(user => {
        if (user !== myUsername && !currentOptions.includes(user)) {
            const option = document.createElement('option');
            option.value = option.textContent = user;
            recipientSelect.appendChild(option);
        }
    });
};

joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username) {
        joinChat({ username });
    }
});

sendBtn.addEventListener('click', () => {
    const message = messageInput.value.trim();
    const to = recipientSelect.value;
    if (message) {
        sendMessage({ message, to });
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const message = messageInput.value.trim();
        const to = recipientSelect.value;
        if (message) {
            sendMessage({ message, to });
        }
    }
});