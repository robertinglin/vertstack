# VertStack

## Overview

VertStack is a lightweight framework for building modular, real-time web applications with a vertical architecture. It allows developers to create interconnected client-server modules that communicate seamlessly across different parts of the application. Think of it as a microservice architecture without having to manage servers.

## Features

- Modular architecture for easy scaling and maintenance
- Real-time communication between client and server
- Cross-module messaging system
- Automatic session management
- Easy-to-use API for both client and server-side code
- Cross-channel communication
- Local message handling for improved performance
- Private messaging for secure communication
- Static file serving for project directories
- Custom `index.html` support with module placement
- Automatic URL rewriting for relative paths
- Iframe-based module rendering with automatic resizing
- WebSocket connection with automatic reconnection

## Getting Started

### Prerequisites

- Node.js (version 20 or higher recommended)
- A modern web browser

### Installation

1. Clone the repository or copy the `VertStack` file into your project directory.
2. Create a directory for each module of your application.

### Project Structure

```
your-project/
├── VertStack
├── index.html (optional)
├── module1/
│   ├── client.js
│   ├── server.js
│   └── public/ or dist/ (optional)
│       ├── index.html
│       └── ... (other static files)
├── module2/
│   ├── client.js
│   ├── server.js
│   └── public/ or dist/ (optional)
└── ...
```

## Usage

### Starting the Server

Run the following command from your project root:

```bash
npx VertStack --port=3456 module1 module2 ...
```
Replace `module1`, `module2`, etc., with the names of your module directories.

### Local Installation and Usage

You can install VertStack locally in your project directory by using the `--install` flag. This process will:

1. Download the current version of VertStack
2. Create `watch`, `serve`, and `serve-down` scripts in your directory

To install:

```bash
npx VertStack --install [options] module1 module2 ...
```

Once installed, you can use the following scripts:

- `watch.cmd` (Windows) or `watch.sh` (Unix): Starts the server with auto-restart on file changes
- `serve.cmd` (Windows) or `serve.sh` (Unix): Runs the server in detached mode
- `serve-down.cmd` (Windows) or `serve-down.sh` (Unix): Stops the detached server

The `serve` script automatically runs in detached mode and redirects output to a `vertstack.logs` file in your project's root directory.

Example usage:

```bash
# Install VertStack locally with custom port and modules
npx VertStack --install --port=3456 module1 module2

# Start the server with auto-restart (development mode)
./watch.cmd  # or ./watch.sh on Unix systems

# Start the server in detached mode
./serve.cmd  # or ./serve.sh on Unix systems

# Stop the detached server
./serve-down.cmd  # or ./serve-down.sh on Unix systems
```

After installation, you don't need to specify the modules again when running the scripts. The installation process saves your configuration for future use.

### Writing Server-Side Code

In each module's `server.js` file:

```javascript
module.exports = function (bus, sessionId) {
  // Your server-side logic here
  bus("some.event", { data: "Hello from server!" });

  return function cleanup() {
    // Optional cleanup function
  };
};
```

### Writing Client-Side Code

In each module's `client.js` file:

```javascript
// The 'bus' function is globally available
bus("some.event", (payload) => {
  console.log(payload.data);
});

bus("client.event", { message: "Hello from client!" });
```

## API Reference

### `bus(key, data)` or `bus(key, callback)`

- `key` (string): The event key. Use dot notation for namespacing.
- `data` (any): The data to send with the event.
- `callback` (function): A function to handle incoming events.

#### Special Keys

- Use `!` prefix for private messages (e.g., `'!privateEvent'`)
- Use `*` for project-wide events (e.g., `'*.globalEvent'`)
- Use `#` prefix for cross-channel communication (e.g., `'#otherModule.event'`)
- Use `@` prefix for local messages (e.g., `'@localEvent'`)

### Server-Side Module Export

Export a function that takes `bus` and `sessionId` as parameters and optionally returns a cleanup function.

## Static File Serving

VSS automatically serves static files from the `public/` or `dist/` directory within each module. This is useful for serving HTML, CSS, JavaScript, and other assets specific to each module.

### Usage

1. Create a `public/` or `dist/` directory in your module folder.
2. Place your static files (e.g., `index.html`, CSS, JavaScript) in this directory.
3. These files will be automatically served when accessing your module's route.

Example structure:
```
module1/
├── server.js
├── client.js
└── public/
    ├── index.html
    ├── styles.css
    └── script.js
```

## Custom Index.html

You can provide a custom `index.html` file in the root of your project to control the overall layout of your application.

### Usage

1. Create an `index.html` file in your project root.
2. Use the special comment syntax `<!-- @[MODULENAME] -->` to indicate where each module should be rendered.

Example `index.html`:
```html
<!DOCTYPE html>
<html>
<head>
    <title>My VSS Application</title>
</head>
<body>
    <header>Welcome to My App</header>
    <main>
        <section id="module1">
            <!-- @module1 -->
        </section>
        <section id="module2">
            <!-- @module2 -->
        </section>
    </main>
    <footer>© 2024 My VSS Application</footer>
</body>
</html>
```

## URL Rewriting

VSS automatically rewrites relative URLs within each module to ensure they work correctly when served as part of the larger application.

This feature works for:
- HTML `src` and `href` attributes
- CSS `url()` functions
- Dynamically added elements and styles

No additional configuration is needed; this happens automatically for all modules.

## Iframe Resizing

Modules are rendered within iframes, which are automatically resized to fit their content. This ensures that each module displays correctly regardless of its content size.

### How it works

1. Each module's content is wrapped in an iframe.
2. A script monitors the content size of each iframe.
3. The iframe's height is dynamically adjusted to match its content.

No additional configuration is required; this feature works automatically for all modules.


## Best Practices

1. Use meaningful namespaces for your events to avoid conflicts.
2. Keep modules small and focused on specific functionality.
3. Use private events (`!`) for sensitive operations.
4. Implement cleanup functions to handle resource disposal.
5. Use the `#` prefix for intentional cross-channel communication.
6. Use the `@` prefix for local messages that should not be sent over the network.
7. Utilize the `public/` or `dist/` directories for module-specific static files.
8. Take advantage of the custom `index.html` feature for complex layouts.

## Examples

### Chat Module with Cross-Channel Notification and Local Logic

server.js:

```javascript
module.exports = function (bus, sessionId) {
  bus("chat.connect", (payload) => {
    bus("chat.message", { user: sessionId, text: "A new user connected" }, "*");
    // Notify another module about the new connection
    bus("#userStats.newConnection", { sessionId });
    // Local server-side logic
    bus("@chat.logConnection", { sessionId, timestamp: Date.now() });
  });

  bus("chat.message", (payload) => {
    bus("chat.message", { user: sessionId, text: payload.data.text }, "*");
  });

  // Handle local server-side event
  bus("@chat.logConnection", (payload) => {
    console.log(`User ${payload.data.sessionId} connected at ${payload.data.timestamp}`);
  });
};
```

client.js:

```javascript
bus("chat.message", (payload) => {
  displayMessage(payload.data.user, payload.data.text);
});

document.getElementById("sendButton").onclick = () => {
  const text = document.getElementById("messageInput").value;
  bus("chat.message", { text });
  // Local client-side logic
  bus("@chat.updateUI", { text });
};

// Listen for events from another module
bus("#userStats.update", (payload) => {
  updateUserStatsDisplay(payload.data);
});

// Handle local client-side event
bus("@chat.updateUI", (payload) => {
  clearMessageInput();
  scrollChatToBottom();
});
```

## Cross-Channel Communication

The `#` prefix allows you to send messages to specific channels (modules) from any other module. This is useful for inter-module communication without broadcasting to all modules.

### Usage:

```javascript
// Send a message to the 'userStats' module
bus("#userStats.update", { activeUsers: 10 });

// Listen for messages from other modules
bus("#otherModule.event", (payload) => {
  // Handle the event
});
```

## Local Message Handling

The `@` prefix is used for local messages that should not be sent over the network. This is useful for optimizing performance and keeping certain logic contained within either the client or server side.

### Usage:

```javascript
// Send a local message (client-side or server-side)
bus("@localEvent", { someData: "value" });

// Listen for local messages
bus("@localEvent", (payload) => {
  // Handle the local event
});
```

## Private Message Handling

The `!` prefix is used for private messages that should only be received by the intended recipient. This is useful for sending sensitive information or implementing secure communication channels within your application.

### Usage:

```javascript
// Send a private message to a specific session
bus("!privateMessage", { sensitiveData: "value" }, targetSessionId);

// Listen for private messages
bus("!privateMessage", (payload) => {
  // Handle the private message
  console.log("Received private message:", payload.data);
});
```

### Key Features of Private Messages:

1. **Session-Specific:** Private messages are only delivered to the specified session. Other sessions, even within the same module, will not receive these messages.

2. **Secure Communication:** Use private messages for transmitting sensitive information like authentication tokens, personal data, or any content that should not be broadcast widely.

3. **Namespacing:** You can use namespacing with private messages (e.g., `'!module.privateEvent'`) to organize your private events within modules.

4. **Server-to-Client and Client-to-Server:** Private messages can be sent in both directions, allowing secure bidirectional communication.

5. **No Cross-Channel Leakage:** Private messages are contained within their intended channel and will not leak to other modules, even when using cross-channel communication.

### Example: Secure User Authentication

Here's an example of how to use private messages for a secure user authentication process:

server.js:

```javascript
module.exports = function (bus, sessionId) {
  const users = new Map();

  bus("auth.login", (payload) => {
    const { username, password } = payload.data;
    if (authenticateUser(username, password)) {
      const token = generateAuthToken(username);
      users.set(sessionId, { username, token });
      // Send private message with auth token
      bus("!auth.success", { token }, sessionId);
    } else {
      bus("!auth.failure", { message: "Invalid credentials" }, sessionId);
    }
  });

  bus("!auth.validateToken", (payload) => {
    const { token } = payload.data;
    const user = Array.from(users.entries()).find(
      ([_, u]) => u.token === token
    );
    if (user) {
      bus("!auth.valid", { username: user[1].username }, sessionId);
    } else {
      bus("!auth.invalid", {}, sessionId);
    }
  });

  // ... other server-side logic
};
```

client.js:

```javascript
let authToken = null;

function login(username, password) {
  bus("auth.login", { username, password });
}

bus("!auth.success", (payload) => {
  authToken = payload.data.token;
  console.log("Successfully authenticated");
  // Proceed with authenticated actions
});

bus("!auth.failure", (payload) => {
  console.error("Authentication failed:", payload.data.message);
  // Handle login failure (e.g., show error message to user)
});

function validateToken() {
  if (authToken) {
    bus("!auth.validateToken", { token: authToken });
  }
}

bus("!auth.valid", (payload) => {
  console.log("Token is valid for user:", payload.data.username);
  // Proceed with authenticated actions
});

bus("!auth.invalid", () => {
  console.log("Token is invalid or expired");
  authToken = null;
  // Handle invalid token (e.g., redirect to login page)
});
```

In this example, sensitive information like authentication tokens is only sent via private messages, ensuring that this data is not accidentally broadcast to other sessions or modules.

## Best Practices for Private Messages

1. **Always use for sensitive data:** Any data that should not be visible to other sessions or modules should be sent using private messages.

2. **Combine with encryption:** For highly sensitive data, consider encrypting the payload before sending it as a private message for an additional layer of security.

3. **Validate recipients:** On the server side, always validate that the intended recipient of a private message is authorized to receive it before sending.

4. **Handle errors gracefully:** If a private message fails to send (e.g., if the target session no longer exists), handle this gracefully to prevent security information leaks.

5. **Don't rely solely on privacy:** While private messages provide a level of security, they should be used in conjunction with other security measures like HTTPS, proper authentication, and authorization checks.

6. **Audit private message usage:** Regularly review your use of private messages to ensure they are being used appropriately and that no sensitive information is being inadvertently exposed.

By leveraging private messages effectively, you can create more secure and robust applications within the VertStack framework.
## Troubleshooting

- If modules aren't loading, ensure the directory names match the command-line arguments.
- Check the console for WebSocket connection errors if real-time updates aren't working.
- Verify that event keys are correctly namespaced to avoid conflicts between modules.
- When using cross-channel communication with `#`, make sure the target module exists and is listening for the event.
- If local events with `@` are not being handled, ensure you're listening for them on the correct side (client or server).
- For private messages with `!`, confirm that the target session exists and that the message is being sent to the correct sessionId.
- If static files are not being served, check that they are placed in the `public/` or `dist/` directory of the module.
- For custom layouts, ensure your root `index.html` file uses the correct `<!-- @[MODULENAME] -->` syntax for module placement.

## Contributing

Contributions are welcome! Please submit pull requests or open issues for any bugs or feature requests.

## License

This project is licensed under the MIT License.
