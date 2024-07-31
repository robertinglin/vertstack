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

## API Reference

### `bus(key, data)` or `bus(key, callback)`

- `key` (string): The event key. Use dot notation for namespacing.
- `data` (any): The data to send with the event.
- `callback` (function): A function to handle incoming events.

#### Special Keys

- Use `_` prefix for private messages (e.g., `'_privateEvent'`)
- Use `*` for project-wide events (e.g., `'*.globalEvent'`)
- Use `#` prefix for cross-channel communication (e.g., `'#otherModule.event'`)
- Use `$` prefix for local messages (e.g., `'$localEvent'`)

### Server-Side Module Export

Export a function that takes `bus` and `sessionId` as parameters and optionally returns a cleanup function.

## Static File Serving

VertStack automatically serves static files from the `public/` or `dist/` directory within each module. This is useful for serving HTML, CSS, JavaScript, and other assets specific to each module.

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
    <title>My VertStack Application</title>
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
    <footer>© 2024 My VertStack Application</footer>
</body>
</html>
```

## URL Rewriting

VertStack automatically rewrites relative URLs within each module to ensure they work correctly when served as part of the larger application.

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

## Examples

Examples can be found under the examples folder in Github.

## Cross-Channel Communication

The `#` prefix allows you to send messages to specific channels (modules) from any other module. This is useful for inter-module communication without broadcasting to all modules. By default exported functions will subscribe to private and global scope.

### Usage:

```javascript
// Send a message to the 'userStats' module
bus("#userStats.update", { activeUsers: 10 });


// userStats exports a handler
export const update = (payload) => {
  // handle the event
}
```

## Local Message Handling

The `$` prefix is used for local messages that should not be sent over the network. This is useful for optimizing performance and keeping certain logic contained within either the client or server side.

### Usage:

```javascript
// Send a local message (client-side or server-side)
bus("$localEvent", { someData: "value" });

export const $localEvent = (payload) => {
    // Handle the local event
};
```

## Vertical Message Handling

The `_` prefix is used for server to client messages in a single module. If prefixed with _ only the server or client module will receive the message.

### Usage:

```javascript
// Send a vertical message
bus("_verticalMessage", { sensitiveData: "value" }, targetSessionId);

// Listen for vertical messages
export const _verticalMessage = (payload) => {
  // Handle the private message
  console.log("Received private message:", payload.data);
};
```

## Server side Session subscription

As a server can handle multiple clients it is configured slightly different. It expects a default export that can handle new sessions.

```javascript
export default (bus, sessionId, pageId) => {
  console.log('new user', sessionId, pageId)
  return () => {
    console.log('called when user leaves');
  }
}
```

## Listening to all messages

In the event that you want to subscribe to all public messages for the session you can use the wildcard `*` prefix directly on the bus.  

```javascript
export default (bus, sessionId, pageId) => {
  bus('*', (payload) => {
    console.log('Received message', payload);
  });

  bus('*.targetedMessage', (payload) => {
    console.log('Received message with .targetedMessage as subkek and the payload', payload);
  });
}
```

## Proxy Support

VertStack supports proxying requests to specific ports for each module. This feature is useful when you need to integrate existing services or APIs with your VertStack application.

### Usage

When starting the server, you can specify a proxy port for each module:

```bash
npx VertStack module1=8080 module2=8081
```

This will set up module1 to proxy requests to port 8080 and module2 to port 8081.

### How it works

- Requests to `/{moduleName}/p/{path}` will be proxied to the specified port.
- The proxy will forward all headers and the request body.
- This allows you to seamlessly integrate existing services with your VertStack application.

Example:
If you have an existing API running on port 8080, you can integrate it with your VertStack module like this:

```javascript
// In your client.js
async function fetchData() {
  const response = await fetch('/module1/p/api/data');
  const data = await response.json();
  // Process the data
}
```

This request will be proxied to `http://localhost:8080/api/data`.

## Using pageId

The concept of `pageId` can be used to manage multiple instances of the same module across different pages or components of a user session.

The `pageId` is automatically generated and managed by VertStack. In your module code, you can access and use it as follows:

1. In server-side code:

```javascript
module.exports = function (bus, sessionId, pageId) {
  bus('someEvent', (payload) => {
    console.log(`Received event for page: ${pageId}`);
    // Handle the event
  });

  // Send a message to a specific page instance
  bus('specificPageEvent', data, sessionId, pageId);
};
```

2. In client-side code:

```javascript
// The pageId is automatically handled in the background
bus('someEvent', (payload) => {
  // This will only be called for events sent to this specific page instance
  console.log('Received event:', payload);
});
```

## Troubleshooting

- If modules aren't loading, ensure the directory names match the command-line arguments.
- Check the console for WebSocket connection errors if real-time updates aren't working.
- Verify that event keys are correctly namespaced to avoid conflicts between modules.
- If static files are not being served, check that they are placed in the `public/` or `dist/` directory of the module.
- For custom layouts, ensure your root `index.html` file uses the correct `<!-- @[MODULENAME] -->` syntax for module placement.

## Contributing

Contributions are welcome! Please submit pull requests or open issues for any bugs or feature requests.

## License

This project is licensed under the MIT License.
