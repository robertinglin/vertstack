const http = require('http');
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const url = require("url");
const { spawn } = require('child_process');
const EventEmitter = require('events');

const isSandboxed = process.argv.includes("--sandboxed");

const fullCode = fs.readFileSync(__filename, "utf8");
function extractCode(tag) {
  const tagRegex = new RegExp(`// <${tag}>([\\s\\S]*?)// <\\/${tag}>`);
  const match = fullCode.match(tagRegex);
  return match ? match[1].trim() : "";
}

let vertstackTimeout = 1000;
if (process.argv.includes("--timeout=")) {
  vertstackTimeout = parseInt(process.argv.find((arg) => arg.startsWith("--timeout=")).split("=")[1]);
}

// <getVertstackTimeout>
function getVertstackTimeout() {
  return vertstackTimeout;
}
// </getVertstackTimeout>

// <parsekey>
function extractProjectKey(key) {
  if (key.startsWith("_") || key.startsWith("$") || key.startsWith("#")) {
    key = key.slice(1);
  }
  const keyParts = key.split(".");
  return keyParts.length > 1 ? keyParts[0] : key;
}

function parseKey(key, projectKey) {
  let normalizedKey = key;
  let isPrivate = false;
  let isLocal = false;
  let isCrossChannel = false;

  if (key.startsWith("_")) {
    normalizedKey = key.slice(1);
    isPrivate = true;
  } else if (key.startsWith("$")) {
    normalizedKey = key.slice(1);
    isLocal = true;
  } else if (key.startsWith("#")) {
    normalizedKey = key.slice(1);
    isCrossChannel = true;
  }

  if (
    !isCrossChannel &&
    projectKey &&
    !normalizedKey.startsWith(projectKey + ".") &&
    normalizedKey !== projectKey &&
    !normalizedKey.startsWith("*")
  ) {
    normalizedKey = `${projectKey}.${normalizedKey}`;
  }

  if (projectKey) {
    if (isPrivate) {
      normalizedKey = "_" + normalizedKey;
    } else if (isLocal) {
      normalizedKey = "$" + normalizedKey;
    }
  }

  return {
    normalizedKey: normalizedKey,
    projectKey,
    isPrivate,
    isLocal,
    isCrossChannel,
  };
}
// </parsekey>

// <watchresize>
function watchResizeScript () {
  function getIframeUrl(iframe) {
    try {
      let subdir = iframe.contentWindow.location.href;
      if (subdir) {
        subdir = subdir.split('/').slice(3).join('/');
      }
      return subdir;
    } catch (e) {
      let subdir = iframe.src;
      if (subdir.startsWith('/')) {
        subdir = subdir.slice(1);
      }
      return subdir;
    }
  }

  window.addEventListener(
    "message",
    function (event) {
      if (typeof event.data.projectKey === "string" && typeof event.data.height === "number") {
        const iframes = document.getElementsByTagName("iframe");
        const projectKey = event.data.projectKey;

        for (let i = 0; i < iframes.length; i++) {
          const url = getIframeUrl(iframes[i]);
          if (url && url.startsWith(projectKey)) {
            const nextChar = url.charAt(projectKey.length);
            if (nextChar === "" || nextChar === "/" || nextChar === "?" || nextChar === "#") {
              iframes[i].style.height = event.data.height + "px";
              break;
            }
          }
        }
        if (typeof sendHeight !== "undefined") {
          sendHeight();
        }
      }
    },
    false
  );
}
// </watchresize>

// <colors>
const colors = [
  '\x1b[32m', '\x1b[33m', '\x1b[34m', '\x1b[35m', '\x1b[36m', '\x1b[37m',
  '\x1b[91m', '\x1b[92m', '\x1b[93m', '\x1b[94m', '\x1b[95m', '\x1b[96m', '\x1b[97m'
];
const resetColor = '\x1b[0m';

function getColorForModule(moduleName, modules) {
  const sortedModules = [...modules].sort();
  const index = sortedModules.indexOf(moduleName);
  return colors[index % colors.length];
}

function createColoredPrefix(moduleName, modules) {
  const color = getColorForModule(moduleName, modules);
  return `${color}[${moduleName}]${resetColor}`;
}

// </colors>

// <bus>
function createBus(projectKey, handleRemoteDispatch) {
  const subscribers = new Map();
  const responsePromises = new Map();
  let closed = false;

  function closeBus() {
    subscribers.clear();
    responsePromises.clear();
  }

  function handleSubscription(key, callback) {
    const { normalizedKey } = parseKey(key, projectKey);

    if (!subscribers.has(normalizedKey)) {
      subscribers.set(normalizedKey, new Set());
    }
    subscribers.get(normalizedKey).add(callback);

    return () => {
      subscribers.get(normalizedKey).delete(callback);
      if (subscribers.get(normalizedKey).size === 0) {
        subscribers.delete(normalizedKey);
      }
    };
  }

  function alwaysDispatchFromBus(key, data, target, pageId) {
    const requestId = Math.random().toString(36).substring(2) + Date.now().toString(36);
    return new Promise(async (resolve, reject) => {
      let { normalizedKey } = parseKey(key, projectKey);
      handleRemoteDispatch({
        key: normalizedKey,
        data,
        requestId,
        target,
        pageId,
      });
      responsePromises.set(requestId, resolve);
      setTimeout(() => {
        if (responsePromises.has(requestId)) {
          responsePromises.delete(requestId);
          console.error("Request timed out: " + requestId + " for key: " + key, data, target);
        }
        resolve([]);
      }, getVertstackTimeout());
    }).then((response) => {
      if (closed) {
        return;
      }
      let { normalizedKey } = parseKey(key, projectKey);
      if (normalizedKey.startsWith("_") || normalizedKey.startsWith("$")) {
        normalizedKey = normalizedKey.slice(1);
      }
      let defaultValue = response.find((r) => r.key === normalizedKey)?.data;
      let proxy;
      const primitiveHandler = {
        get(target, prop) {
          if (prop === "value") {
            return defaultValue;
          }
          if (prop === "#") {
            return response;
          }
          if (prop === Symbol.toPrimitive) {
            return function (hint) {
              return target.valueOf();
            };
          }
          if (prop.startsWith("#")) {
            prop = prop.slice(1);
            message = response.find((r) => r.key === prop);
            return message;
          }
          return target[prop];
        },
      };

      switch (typeof defaultValue) {
        case "number":
          proxy = new Proxy(new Number(defaultValue), primitiveHandler);
          break;
        case "string":
          proxy = new Proxy(new String(defaultValue), primitiveHandler);
          break;
        case "boolean":
          proxy = new Proxy(new Boolean(defaultValue), primitiveHandler);
          break;
        case "undefined":
        default:
          proxy = new Proxy(
            {},
            {
              get: (_, prop) => {
                if (prop === "value") {
                  return defaultValue;
                }
                if (prop === "#") {
                  return response;
                }
                let message;
                if (prop.startsWith("#")) {
                  prop = prop.slice(1);
                  message = response.find((r) => r.key === prop);
                  return message?.data;
                }

                message = response.find((r) => r.key === normalizedKey);

                return message?.data[prop];
              },
            }
          );
          break;
      }
      return proxy;
    });
  }

  function handleFromServerDispatch(key, data, targetOrLocal) {
    const messagePromise = new Promise(async (resolve, reject) => {
      const { normalizedKey } = parseKey(key);
      const responses = handleLocalDispatch(normalizedKey, data);
      resolve(responses);
    });

    return messagePromise;
  }

  function handleLocalDispatch(key, data) {
    const responses = [];
    responses.push(notifySubscribers("*", { key, data }));
    responses.push(notifySubscribers(key, { key, data }));

    const keyParts = key.split(".");
    for (let i = 1; i <= keyParts.length; i++) {
      const partialKey = keyParts.slice(0, i).join(".");
      if (partialKey !== key) {
        responses.push(notifySubscribers(partialKey, { key, data }));
      }

      const wildcardKey = `*.${keyParts.slice(1, i).join(".")}`;
      responses.push(notifySubscribers(wildcardKey, { key, data }));
    }

    return Promise.all(responses).then((responses) => responses.flat());
  }

  async function notifySubscribers(key, payload) {
    let responses = [];
    if (subscribers.has(key)) {
      await Promise.all(Array.from(subscribers.get(key)).map(async (callback) => {
        try {
          const response = await callback(payload);
          if (response !== undefined) {
            if (!key.startsWith(projectKey)) {
              key = projectKey + "." + key;
            }
            responses.push({
              key,
              data: response,
            });
          }
        } catch (error) {
          console.error(`Error in subscriber callback for ${key}:`, error);
        }
      }));
    }
    return responses;
  }

  const bus = function bus(keyOrCallback, data, target, pageId) {
    if (typeof keyOrCallback === "function") {
      return handleSubscription(projectKey, keyOrCallback);
    } else if (typeof data === "function") {
      return handleSubscription(keyOrCallback, data);
    } else {
      return alwaysDispatchFromBus(keyOrCallback, data, target, pageId);
    }
  };

  const processResponse = (responseId, data) => {
    if (responsePromises.has(responseId)) {
      const response = responsePromises.get(responseId);
      response(data);
      responsePromises.delete(responseId);
    }
  };
  const processExternalMessage = (message) => {
    if (message.responseId) {
      processResponse(message.responseId, message.data);
    } else {
      return handleFromServerDispatch(
        message.key,
        message.data,
        message.target ?? true
      );
    }
  };

  return [bus, processExternalMessage, closeBus];
}
// </bus>

// <interbus>
function InterBus(sendExternalMessage) {
  const channels = new Map();
  const projectRequestPromises = new Map();

  this.receiveExternalMessage = async (message, sendResponse = true) => {
    if (message.requestId) {
      const channelResponsesByPage = new Map();

      const projectKey = extractProjectKey(message.key);
      const parsedKey = parseKey(message.key, projectKey);

      for (const [channelKey, clientChannels] of channels) {
        if (!parsedKey.isPrivate || channelKey === projectKey) {
          for (const [pageId, channel] of clientChannels) {
            if (pageId !== message.pageId && message.pageId !== "*") {
              continue;
            }
            if (!channelResponsesByPage.has(pageId)) {
              channelResponsesByPage.set(pageId, []);
            }
            const channelResponses = channelResponsesByPage.get(pageId);

            const responseKey = `${channelKey}_${pageId}_${message.requestId}`;

            if (!projectRequestPromises.has(responseKey)) {
              projectRequestPromises.set(responseKey, []);
              channelResponses.push(
                new Promise((resolve) => {
                  projectRequestPromises.set(responseKey, [resolve]);
                  // channel(message);
                  channel({ ...message, pageId: pageId });
                })
              );
            }
          }
        }
      }

      const responsesByPage = (await Promise.all(Array.from(channelResponsesByPage.keys()).map(async (pageId) => {
        const channelResponses = channelResponsesByPage.get(pageId);
        if (channelResponses.length > 0) {
          const timeout = new Promise((resolve) => {
            setTimeout(() => {
              resolve([]);
            }, getVertstackTimeout());
          });
          const response = await Promise.race([
            Promise.all(channelResponses),
            timeout,
          ]);
          return [pageId, await response.flat()];
        }
        return [pageId, []];
      }))).reduce((acc, [pageId, response]) => {
        acc[pageId] = response;
        return acc;
      }, {})

      sendExternalMessage({
        responseId: message.requestId,
        data: responsesByPage,
      });
    } else if (message.responseId) {
      const requestId = "external_" + message.responseId;
      const resolve = projectRequestPromises.get(requestId);
      if (resolve) {
        projectRequestPromises.delete(requestId);
        resolve(message.data);
      }
    }
  };

  this.receiveInternalMessage = async (projectKey, message) => {
    if (message.requestId) {
      const channelResponsesByPage = new Map();
      const parsedKey = parseKey(message.key, projectKey);

      for (const [channelKey, clientChannels] of channels) {
        if (!parsedKey.isPrivate && channelKey !== projectKey) {
          for (const [pageId, channel] of clientChannels) {
            if (pageId !== message.pageId && message.pageId !== "*") {
              continue;
            }
            if (!channelResponsesByPage.has(pageId)) {
              channelResponsesByPage.set(pageId, []);
            }
            const channelResponses = channelResponsesByPage.get(pageId);

            const responseKey = `${channelKey}_${pageId}_${message.requestId}`;
            if (!projectRequestPromises.has(responseKey)) {
              projectRequestPromises.set(responseKey, []);
              channelResponses.push(
                new Promise((resolve) => {
                  projectRequestPromises.set(responseKey, [resolve]);
                  channel({ ...message, pageId: pageId });
                })
              );
            }
          }
        }
      }

      let externalPromise;
      if (!parsedKey.isLocal) {
        externalPromise = new Promise((resolve) => {
          projectRequestPromises.set("external_" + message.requestId, (data) => {
            resolve(data)
          });
        });
        sendExternalMessage(message);
      } else {
        externalPromise = Promise.resolve([]);
      }

      const internalResponsesByPage = (await Promise.all(Array.from(channelResponsesByPage.keys()).map(async (pageId) => {
        const channelResponses = channelResponsesByPage.get(pageId);

        const timeout = new Promise((resolve) => {
          setTimeout(() => {
            resolve([]);
          }, getVertstackTimeout());
        });
        const response = await Promise.race([
          Promise.all(channelResponses),
          timeout,
        ]);
        return [pageId, response.flat()];
      }))).reduce((acc, [pageId, response]) => {
        acc[pageId] = response;
        return acc;
      }, {})
      const externalResponse = await externalPromise;
      const internalResponses = Object.entries(internalResponsesByPage).map(([pageId, response]) => {
        return response.map((response) => {
          return {
            pageId,
            ...response,
            local: true,
          }
        });
      }).flat();
      const externalResponses = Object.entries(externalResponse).map(([pageId, responses]) => {
        return responses.map((response) => {
          return {
            pageId,
            ...response,
            local: false,
          }
        });
      }).flat();

      const responses = [...internalResponses, ...externalResponses];

      const channel = channels.get(projectKey);

      if (message.pageId !== '*') {
        const channelPage = channel.get(message.pageId);
        if (channelPage) {
          channelPage({
            responseId: message.requestId,
            data: responses,
            pageId: message.originPageId ?? message.pageId,
          });
        }
      } else {
        channel.forEach((channelPage) => {
          channelPage({
            responseId: message.requestId,
            data: responses,
            pageId: message.pageId,
          });
        });
      }
    } else if (message.responseId) {
      const responseKey = `${projectKey}_${message.pageId}_${message.responseId}`;

      const resolve = projectRequestPromises.get(responseKey)?.shift();
      if (resolve) {
        resolve(message.data);
        if (projectRequestPromises.get(responseKey).length === 0) {
          projectRequestPromises.delete(responseKey);
        }
      } else {
        console.error(
          "No resolve function found for",
          responseKey,
          message
        );
      }
    }
  };

  this.registerChannel = (key, bus, pageId) => {
    if (!channels.has(key)) {
      channels.set(key, new Map());
    }
    channels.get(key).set(pageId, bus);
  };

  this.unregisterChannel = (key, pageId) => {
    if (channels.has(key)) {
      channels.get(key).delete(pageId);
      if (channels.get(key).size === 0) {
        channels.delete(key);
      }
    }
  };

  return this;
}
// </interbus>

// <server>
const sessions = new Map();
const serverModules = new Map();
const projectKeys = new Map();
// <websocket>
class WebSocket extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.readyState = WebSocket.CONNECTING;
    this.frameBuffer = Buffer.alloc(0);
    this.fragments = [];
    this.lastPingTime = Date.now();
    this.setupSocket();
  }

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  setupSocket() {
    this.socket.on('data', (data) => this.handleData(data));
    this.socket.on('close', (hadError) => this.handleClose(hadError));
    this.socket.on('error', (error) => this.handleError(error));
    // Add a listener for the 'end' event
    this.socket.on('end', () => this.handleEnd());
  }

  handleUpgrade(request, head) {
    if (request.headers['sec-websocket-version'] !== '13') {
      this.close(1002, 'Invalid WebSocket version');
      return;
    }

    const key = request.headers['sec-websocket-key'];
    const acceptKey = this.generateAcceptKey(key);

    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
      ''
    ].join('\r\n');

    this.socket.write(responseHeaders);
    this.readyState = WebSocket.OPEN;
    this.emit('open');
    this.startPingInterval();
  }

  generateAcceptKey(clientKey) {
    const sha1 = crypto.createHash('sha1');
    sha1.update(clientKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
    return sha1.digest('base64');
  }

  handleData(data) {
    this.frameBuffer = Buffer.concat([this.frameBuffer, data]);

    while (this.frameBuffer.length > 2) {
      const frame = this.decodeFrame();
      if (!frame) break;

      switch (frame.opcode) {
        case 0x1: // Text frame
        case 0x2: // Binary frame
          if (frame.fin) {
            this.emit('message', frame.payload);
          } else {
            this.fragments.push(frame.payload);
          }
          break;
        case 0x0: // Continuation frame
          this.fragments.push(frame.payload);
          if (frame.fin) {
            const fullMessage = Buffer.concat(this.fragments);
            this.emit('message', fullMessage);
            this.fragments = [];
          }
          break;
        case 0x8: // Close frame
          this.close(1000);
          break;
        case 0x9: // Ping frame
          this.sendPong(frame.payload);
          break;
        case 0xA: // Pong frame
          this.lastPingTime = Date.now();
          break;
      }
    }
  }

  decodeFrame() {
    if (this.frameBuffer.length < 2) return null;

    const fin = (this.frameBuffer[0] & 0x80) !== 0;
    const opcode = this.frameBuffer[0] & 0x0F;
    const masked = (this.frameBuffer[1] & 0x80) !== 0;
    let payloadLength = this.frameBuffer[1] & 0x7F;
    let maskStart = 2;

    if (payloadLength === 126) {
      if (this.frameBuffer.length < 4) return null;
      payloadLength = this.frameBuffer.readUInt16BE(2);
      maskStart = 4;
    } else if (payloadLength === 127) {
      if (this.frameBuffer.length < 10) return null;
      payloadLength = Number(this.frameBuffer.readBigUInt64BE(2));
      maskStart = 10;
    }

    const totalLength = maskStart + (masked ? 4 : 0) + payloadLength;
    if (this.frameBuffer.length < totalLength) return null;

    let payload = this.frameBuffer.slice(maskStart + (masked ? 4 : 0), totalLength);

    if (masked) {
      const mask = this.frameBuffer.slice(maskStart, maskStart + 4);
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4];
      }
    }

    this.frameBuffer = this.frameBuffer.slice(totalLength);

    return { fin, opcode, payload };
  }
  send(data, options = { opcode: null }) {
    if (this.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket is not open'));
    }

    const isBinary = options.binary || Buffer.isBuffer(data);
    const opcode = options?.opcode ?? (isBinary ? 0x2 : 0x1);
    const payload = isBinary ? data : Buffer.from(data);
    const frameBuffer = this.createFrame(opcode, payload);

    return new Promise((resolve, reject) => {
      this.socket.write(frameBuffer, (error) => {
        if (error) {
          this.handleError(error);
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  createFrame(opcode, payload) {
    const fin = 1;
    const mask = 0; // Server doesn't need to mask frames
    let payloadLength = payload.length;

    let headerLength = 2;
    if (payloadLength > 65535) {
      headerLength += 8;
    } else if (payloadLength > 125) {
      headerLength += 2;
    }

    const frame = Buffer.alloc(headerLength + payloadLength);

    frame[0] = (fin << 7) | opcode;

    if (payloadLength > 65535) {
      frame[1] = (mask << 7) | 127;
      frame.writeBigUInt64BE(BigInt(payloadLength), 2);
    } else if (payloadLength > 125) {
      frame[1] = (mask << 7) | 126;
      frame.writeUInt16BE(payloadLength, 2);
    } else {
      frame[1] = (mask << 7) | payloadLength;
    }

    payload.copy(frame, headerLength);

    return frame;
  }

  close(code = 1000, reason = '') {
    if (this.readyState === WebSocket.CLOSED) return;

    const buffer = Buffer.alloc(2 + reason.length);
    buffer.writeUInt16BE(code, 0);
    buffer.write(reason, 2);

    this.send(buffer, { binary: true })
      .then(() => {
        this.readyState = WebSocket.CLOSING;
        this.socket.end();
      })
      .catch((error) => {
        console.error('Error closing WebSocket:', error);
        this.forceClose();
      });
  }

  forceClose() {
    this.readyState = WebSocket.CLOSED;
    this.stopPingInterval();
    this.socket.destroy();
    this.emit('close', 1006, 'Connection closed abnormally');
  }

  handleClose(hadError) {
    if (this.readyState !== WebSocket.CLOSED) {
      this.readyState = WebSocket.CLOSED;
      this.stopPingInterval();
      this.emit('close', hadError ? 1006 : 1000, hadError ? 'Connection closed abnormally' : 'Normal closure');
    }
  }

  handleError(error) {
    this.emit('error', error);
    if (error.code === 'ECONNRESET') {
      this.forceClose();
    }
  }

  handleEnd() {
    if (this.readyState === WebSocket.OPEN) {
      this.close(1000, 'Connection ended by the other party');
    }
  }

  startPingInterval() {
    this.pingInterval = setInterval(() => {
      if (Date.now() - this.lastPingTime > 30000) {
        this.close(1001, 'Ping timeout');
      } else {
        this.send(Buffer.alloc(0), { opcode: 0x9 })
          .catch(() => this.close(1001, 'Ping failed'));
      }
    }, 1000);
  }

  stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
  }

  sendPong(payload) {
    const pongFrame = this.createFrame(0xA, payload);
    this.socket.write(pongFrame);
  }
}

class WebSocketServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.server = options.server || http.createServer();
    this.setupServerListeners();
  }

  setupServerListeners() {
    this.server.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    });
  }

  handleUpgrade(request, socket, head) {
    const ws = new WebSocket(socket);
    ws.handleUpgrade(request, head);
    this.emit('connection', ws, request);
  }

  listen(port, callback) {
    this.server.listen(port, callback);
  }
}
// </websocket>

// <session>

function initModule(projectKey, session, pageId) {
  const sessionId = session.sessionId;
  // Initialize the server module for this session
  if (serverModules.has(projectKey)) {
    const child = serverModules.get(projectKey);
    session.interBus.registerChannel(projectKey, (message) => {
      if (!message.target) {
        message.target = sessionId;
      }
      child.send(message);
    }, pageId);
    child.send({ key: projectKey, data: "connect", target: sessionId, pageId });
  }
};

function closeSessionForModule(session) {
  const sessionId = session.sessionId;
  for (let [key, child] of serverModules) {
    child.send({ key, data: "disconnect", target: sessionId });
  }
}

function createSession() {
  const sessionId = crypto.randomBytes(16).toString("hex");
  const sessionInterBus = new InterBus((message) => {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify(message));
    }
  });

  const session = {
    interBus: sessionInterBus,
    sessionId,
  };
  sessions.set(sessionId, session);
  return sessionId;
}

function setupServer(options, proxyPorts) {
  const server = createHttpServer(proxyPorts);
  const wss = new WebSocketServer({ server });

  setupWebSocketServer(wss);
  startServer(server, options);
}

function getMainClientCode(modules) {
  const parseKey = extractCode("parsekey");
  const interBus = extractCode("interbus");
  const mainClientCode = extractCode("mainclient");
  const getVertstackTimeoutCode = extractCode("getVertstackTimeout");

  return `
    ${parseKey}
    const vertstackTimeout = ${getVertstackTimeout()};
    ${getVertstackTimeoutCode}
    ${interBus}
    const projectKeys = ${JSON.stringify(modules)};
    (${mainClientCode})(projectKeys);
`;
}

function getSharedWorkerCode() {
  const parseKey = extractCode("parsekey");
  const interBus = extractCode("interbus");
  const sharedWorkerCode = extractCode("webworker");
  const getVertstackTimeoutCode = extractCode("getVertstackTimeout");

  return `
    ${parseKey}
    const vertstackTimeout = ${getVertstackTimeout()};
    ${getVertstackTimeoutCode}
    ${interBus}
    (${sharedWorkerCode})()
`;
}
const htmlRegex = /^\/[a-zA-Z0-9][^\/]+\.html(?:[?#].*)?$/;
function createHttpServer(proxyPorts) {
  return http.createServer((req, res) => {
    const urlParts = req.url.split("/");
    const projectKey = urlParts[1].split("?")[0];

    if (req.url === "/" || htmlRegex.test(req.url)) {
      serveRoot(res, req.url);
    } else if (req.url === "/websocket-worker.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(getSharedWorkerCode());

    } else if (projectKeys.has(projectKey)) {
      if (req.url.startsWith(`/${projectKey}/api`) || req.url.startsWith(`/${projectKey}/p/`)) {
        serveApiRequest(req, res, projectKey, proxyPorts);
      } else {
        serveProjectPage(req, res, projectKey);
      }
    } else {
      serveNotFound(res);
    }
  });
}
function serveRoot(res, url) {
  let file;
  if (url === "/") {
    file = "index.html";
  } else {
    file = url.split("/").pop().split("?")[0].split("#")[0];
  }
  const sessionId = createSession();
  res.writeHead(200, {
    "Content-Type": "text/html",
    "Set-Cookie": `sessionId=${sessionId}; HttpOnly; Path=/`,
  });

  let htmlContent;
  let usingCustomIndex = false;
  try {
    htmlContent = fs.readFileSync(file, "utf8");
    usingCustomIndex = true;
  } catch (error) {
    if (file !== "index.html") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    usingCustomIndex = false;
  }

  const currentTime = Date.now();
  let modules = Array.from(projectKeys.keys());

  if (usingCustomIndex) {
    [htmlContent, modules] = processHtml(htmlContent);
  } else {
    const projectIframes = Array.from(projectKeys.entries())
      .map(
        ([key], index) => `
    <iframe
      src="/${key}?t=${currentTime}"
      style="border: none; background-color: transparent; width: 100%;"
      allowTransparency="true"
      frameBorder="0"
      scrolling="no">
    </iframe>
  `
      )
      .join("");

    htmlContent = `
    <html>
      <head>
        <style>
          body {
            display: flex;
            flex-direction: column;
            vertical-align: top;
          }
        </style>
      </head>
      <body>
        ${projectIframes}
      </body>
    </html>
    `;
  }
  const headScript = `
  <script>
  (${extractCode("watchresize")})()
  </script>
  `;
  const mainClientCode = getMainClientCode(modules);

  const bodyScript = `
    <script>
      ${mainClientCode}
    </script>
  `;

  // Function to inject scripts robustly
  function injectScripts(content) {
    if (!content.includes("<head>")) {
      content = "<head></head>" + content;
    }
    if (!content.includes("<body>")) {
      content = content.replace("</head>", "</head><body>");
    }
    if (!content.includes("</body>")) {
      content += "</body>";
    }
    if (!content.includes("<html>")) {
      content = "<html>" + content + "</html>";
    }

    content = content.replace("</head>", headScript + "</head>");
    content = content.replace("</body>", bodyScript + "</body>");

    return content;
  }

  // Inject scripts
  htmlContent = injectScripts(htmlContent);

  res.end(htmlContent);
}
async function serveProjectPage(req, res, projectKey) {
  try {
    const projectPath = projectKeys.get(projectKey);

    const { publicDir, indexHtmlPath } = await findProjectStructure(
      projectPath
    );

    let clientJsPath = '';
    const jsPath = path.join(projectPath, "client.js");
    const mjsPath = path.join(projectPath, "client.mjs");

    if (fs.existsSync(jsPath)) {
      clientJsPath = `/${projectKey}/client.js`;
    } else if (fs.existsSync(mjsPath)) {
      clientJsPath = `/${projectKey}/client.mjs`;
    } else {
      console.log(`No client found for project ${projectKey}`);
    }


    if (req.url.split('/').pop().includes('.')) {
      const filePath = path.join(projectPath, req.url.split('/').pop());
      if (fs.existsSync(filePath)) {
        const fileStream = fs.createReadStream(filePath);
        res.writeHead('200', { 'Content-Type': getContentType(filePath) });
        fileStream.pipe(res);
        return;
      }
    } else if (publicDir) {
      await serveFromPublicDirectory(
        req,
        res,
        publicDir,
        projectKey,
        clientJsPath
      );
    } else if (indexHtmlPath) {
      await serveHtmlFile(
        res,
        indexHtmlPath,
        projectKey,
        clientJsPath,
      );
    } else {
      serveDefaultProjectPage(
        res,
        projectKey,
        projectPath,
        clientJsPath
      );
    }
  } catch (error) {
    console.error("Error in serveProjectPage:", error);
    serveNotFound(res);
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      const name = parts[0].trim();
      const value = parts[1].trim();
      cookies[name] = value;
    });
  }
  return cookies;
}

async function serveApiRequest(req, res, projectKey, proxyPorts) {
  const cookies = parseCookies(req.headers.cookie);
  const session = cookies.sessionId;
  if (!session) {
    res.writeHead(401);
    res.end("Unauthorized");
    return;
  }

  // Check if this is a proxy request
  if (req.url.startsWith(`/${projectKey}/p/`)) {
    const proxyPort = proxyPorts.get(projectKey);
    if (proxyPort) {
      return proxyRequest(req, res, proxyPort);
    } else {
      res.writeHead(404);
      res.end("Proxy not configured for this module");
      return;
    }
  }

  // Parse query parameters
  const queryParams = url.parse(req.url, true).query;

  // Parse body data
  let bodyData = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    bodyData = await new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          resolve({});
        }
      });
    });
  }

  const requestKey = req.url.substring(1).split('?')[0].replaceAll("/", ".");

  const message = {
    key: "_" + requestKey,
    data: {
      method: req.method,
      query: queryParams,
      body: bodyData
    },
    requestId: Math.random().toString(36).substring(2) + Date.now().toString(36),
    target: session.sessionId,
  };


  try {
    const responses = await session.interBus.receiveExternalMessage(
      message,
      false
    );

    const response = responses?.find(
      (r) => r.key === requestKey
    );

    if (!responses?.length) {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response ?? responses?.[0]?.data ?? {}));
  } catch (error) {
    console.error("Error processing API request:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal Server Error" }));
  }
}

function proxyRequest(req, res, targetPort) {
  const options = {
    hostname: '0.0.0.0',
    port: targetPort,
    path: '/' + req.url.split('/p/')[1],
    method: req.method,
    headers: { ...req.headers }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  req.pipe(proxyReq, { end: true });

  proxyReq.on('error', (error) => {
    console.error('Proxy request error:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Proxy request failed');
  });
}

function processHtml(htmlContent, projectKey = null) {
  const currentTime = Date.now();
  const modules = new Set();

  function rewriteUrls(content) {
    if (projectKey) {
      return content.replace(
        /(<[^>]+\s)(src|href)=(["'])\/(?!\/)/gi,
        `$1$2=$3/${projectKey}/`
      );
    }
    return content;
  }

  // Split the HTML content into parts: outside iframes and inside iframes
  const parts = htmlContent.split(/(<iframe[\s\S]*?<\/iframe>)/gi);
  const processedParts = parts.map((part, index) => {
    // If it's an odd index, it's iframe content, so we don't modify it
    if (index % 2 !== 0) {
      return part;
    }
    // For non-iframe content, apply the URL rewriting and iframe generation
    let processedPart = rewriteUrls(part);

    processedPart = processedPart.replace(
      /<!-- @(\w+)(?:\s+height="(\d+)")?\s*-->/g,
      (match, moduleName, height) => {
        if (projectKeys.has(moduleName)) {
          modules.add(moduleName);
          const heightAttr = height ? ` height="${height}"` : '';
          return `
          <iframe
            src="/${moduleName}?t=${currentTime}"
            style="border: none; background-color: transparent; width: 100%"
            allowTransparency="true"
            frameBorder="0"
            scrolling="no"${heightAttr}>
          </iframe>
          `;
        }
        return match;
      }
    );

    return processedPart;
  });

  return [processedParts.join(''), Array.from(modules)];
}

function serveDefaultProjectPage(
  res,
  projectKey,
  projectPath,
  clientJsPath
) {
  res.writeHead(200, { "Content-Type": "text/html" });
  let htmlContent = `
    <html>
      <head>
      </head>
      <body>
        <h1>Project: ${path.basename(projectPath)}</h1>
        <p>Project Key: ${projectKey}</p>
      </body>
    </html>
  `;

  htmlContent = injectClientBusCode(
    htmlContent,
    clientJsPath,
    projectKey
  );
  htmlContent = injectResizeScript(htmlContent, projectKey);

  res.end(htmlContent);
}

async function findProjectStructure(projectPath) {
  const publicDir = findDirectory(projectPath, ["dist", "public"]);
  let indexHtmlPath = null;

  if (publicDir) {
    indexHtmlPath = path.join(publicDir, "index.html");
    if (!fileExists(indexHtmlPath)) {
      indexHtmlPath = null;
    }
  }

  if (!indexHtmlPath) {
    indexHtmlPath = path.join(projectPath, "index.html");
    if (!fileExists(indexHtmlPath)) {
      indexHtmlPath = null;
    }
  }

  return { publicDir, indexHtmlPath };
}

function findDirectory(basePath, dirNames) {
  for (const dirName of dirNames) {
    const dirPath = path.join(basePath, dirName);
    if (directoryExists(dirPath)) {
      return dirPath;
    }
  }
  return null;
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function directoryExists(dirPath) {
  try {
    const stats = fs.statSync(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function serveFromPublicDirectory(
  req,
  res,
  publicDir,
  projectKey,
  clientJsPath
) {
  const relativePath = req.url.split("?")[0].slice(projectKey.length + 2); // +2 to account for the leading slash and potential trailing slash
  const filePath = path.join(publicDir, relativePath);

  try {
    const stats = fs.statSync(filePath);

    if (stats.isDirectory() || filePath.endsWith("/index.html")) {
      const indexPath = filePath.endsWith("/index.html")
        ? filePath
        : path.join(filePath, "index.html");

      if (fileExists(indexPath)) {
        await serveHtmlFile(
          res,
          indexPath,
          projectKey,
          clientJsPath
        );
      } else {
        serveNotFound(res);
      }
    } else {
      const contentType = getContentType(filePath);
      if (contentType === "text/html") {
        await serveHtmlFile(res, filePath, projectKey);
      } else {
        const fileContent = fs.readFileSync(filePath);
        res.writeHead(200, { "Content-Type": contentType });
        res.end(fileContent);
      }
    }
  } catch (error) {
    console.error(`Error serving file: ${error}`);
    serveNotFound(res);
  }
}

async function serveHtmlFile(
  res,
  filePath,
  projectKey,
  clientJsPath = "",
) {
  try {
    let htmlContent = fs.readFileSync(filePath, "utf8");
    let modules = [];

    [htmlContent, modules] = processHtml(htmlContent, projectKey);

    // Dynamic URL rewriting script
    const urlRewriteScript = `
      <script>
        (function() {
          const projectKey = '${projectKey}';
          const urlAttributes = ['src', 'href'];

          function shouldRewriteUrl(url) {
            return url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/' + projectKey + '/');
          }

          function rewriteUrl(url) {
            return shouldRewriteUrl(url) ? '/' + projectKey + url : url;
          }

          function rewriteUrlsInElement(element) {
            if (element.nodeType === Node.ELEMENT_NODE) {
              urlAttributes.forEach(attr => {
                if (element.hasAttribute(attr)) {
                  const originalUrl = element.getAttribute(attr);
                  if (shouldRewriteUrl(originalUrl) && element.tagName !== 'IFRAME') {
                    element.setAttribute(attr, rewriteUrl(originalUrl));
                  }
                }
              });

              if (element.tagName === 'STYLE' || element.tagName === 'SCRIPT') {
                element.textContent = element.textContent.replace(
                  /url\\(['"]?(\\/[^'"]+)['"]?\\)/g,
                  (match, url) => shouldRewriteUrl(url) ? \`url("\${rewriteUrl(url)}")\` : match
                );
              }

              if (element.style && element.style.cssText) {
                element.style.cssText = element.style.cssText.replace(
                  /url\\(['"]?(\\/[^'"]+)['"]?\\)/g,
                  (match, url) => shouldRewriteUrl(url) ? \`url("\${rewriteUrl(url)}")\` : match
                );
              }
            }
          }

          function handleMutations(mutations) {
            mutations.forEach(mutation => {
              if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                  rewriteUrlsInElement(node);
                  if (node.querySelectorAll) {
                    node.querySelectorAll('*').forEach(rewriteUrlsInElement);
                  }
                });
              } else if (mutation.type === 'attributes') {
                const attrName = mutation.attributeName;
                if (urlAttributes.includes(attrName)) {
                  const element = mutation.target;
                  const attrValue = element.getAttribute(attrName);
                  if (shouldRewriteUrl(attrValue)) {
                    element.setAttribute(attrName, rewriteUrl(attrValue));
                  }
                }
              }
            });
          }

          const observer = new MutationObserver(handleMutations);
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: urlAttributes
          });

          // Rewrite URLs in the initial DOM
          document.querySelectorAll('*').forEach(rewriteUrlsInElement);
        })();
      </script>
    `;

    // Inject the URL rewriting script at the beginning of the <head> tag
    htmlContent = htmlContent.replace("<head>", "<head>\n" + urlRewriteScript);

    htmlContent = injectClientBusCode(
      htmlContent,
      clientJsPath,
      projectKey,
      modules,

    );
    htmlContent = injectResizeScript(htmlContent, projectKey);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(htmlContent);
  } catch (error) {
    console.error(`Error serving HTML file: ${error}`);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
}

function injectClientBusCode(
  htmlContent,
  clientJsPath,
  projectKey,
  modules = [],
) {
  const parseKey = extractCode("parsekey");
  const bus = extractCode("bus");
  const client = extractCode("client");
  const getVertstackTimeoutCode = extractCode("getVertstackTimeout");

  const busCode = `
    <script>
      const projectKeys = ${JSON.stringify(modules)};
      const projectKey = "${projectKey}";
      const vertstackTimeout = ${getVertstackTimeout()};
      ${getVertstackTimeoutCode}
      ${parseKey}
      ${bus}
      (${client})(projectKey, projectKeys);
      window.bus = bus;
    </script>
  `;

  const clientScript = clientJsPath ? `
    <script type="module" src="${clientJsPath}"></script>
  ` : '';

  const exportHandlerScript = clientJsPath ? `
    <script type="module">
      import * as clientExports from '${clientJsPath}';
      
      // Register exported functions
      for (let [key, func] of Object.entries(clientExports)) {
        if (typeof func === 'function' && key !== 'default') {
          if (key.startsWith('_')) {
            key = key.slice(1);
            window.bus(key, (payload) => func(payload.data));
          } else if (key.startsWith("$")) {
            window.bus(key, (payload) => func(payload.data));
          } else {
            window.bus("*." + key, (payload) => func(payload.data));
          }
          let altKey = key.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
          if (key !== altKey) {
            if (altKey.startsWith('_')) {
              altKey = altKey.slice(1);
              window.bus(altKey, (payload) => func(payload.data));
            } else if (altKey.startsWith("$")) {
              window.bus(altKey, (payload) => func(payload.data));
            } else {
              window.bus("*." + altKey, (payload) => func(payload.data));
            }
          }
        }
      }
    </script>
  ` : '';

  if (htmlContent.includes("</head>")) {
    htmlContent = htmlContent.replace("</head>", `${busCode}${clientScript}${exportHandlerScript}</head>`);
  } else if (htmlContent.includes("<body>")) {
    htmlContent = htmlContent.replace("<body>", `${busCode}${clientScript}${exportHandlerScript}<body>`);
  } else if (htmlContent.includes("<html>")) {
    htmlContent = htmlContent.replace(
      "<html>",
      `<html><head>${busCode}${clientScript}${exportHandlerScript}</head>`
    );
  } else {
    htmlContent = `<head>${busCode}${clientScript}${exportHandlerScript}</head>${htmlContent}`;
  }
  return htmlContent;
}

function injectResizeScript(htmlContent, projectKey) {
  const resizeScript = `
    <script>
    function getIFrameHeight(){
    function getComputedBodyStyle(prop) {
        function getPixelValue(value) {
            var PIXEL = /^\d+(px)?$/i;

            if (PIXEL.test(value)) {
                return parseInt(value,base);
            }

            var 
                style = el.style.left,
                runtimeStyle = el.runtimeStyle.left;

            el.runtimeStyle.left = el.currentStyle.left;
            el.style.left = value || 0;
            value = el.style.pixelLeft;
            el.style.left = style;
            el.runtimeStyle.left = runtimeStyle;

            return value;
        }

        var 
            el = document.body,
            retVal = 0;

        if (document.defaultView && document.defaultView.getComputedStyle) {
            retVal =  document.defaultView.getComputedStyle(el, null)[prop];
        } else {//IE8 & below
            retVal =  getPixelValue(el.currentStyle[prop]);
        } 

        return parseInt(retVal,10);
    }

    const marginBottom = getComputedBodyStyle('marginBottom')
    let containerHeight = document.body.getBoundingClientRect().bottom + marginBottom;
    const scrollHeight = document.body.scrollHeight;

    if (scrollHeight > containerHeight) {
        containerHeight = scrollHeight;
    } 

    return containerHeight;
    }
      let shortTimeout;
      let mediumTimeout;
      let longTimeout;
      function sendHeight() {
      const iframeHeight = getIFrameHeight();
        window.parent.postMessage({ projectKey: '${projectKey}', height: iframeHeight }, '*');
        clearTimeout(shortTimeout);
        shortTimeout =setTimeout(() => {
          if (iframeHeight !== getIFrameHeight()) {
            sendHeight();
          }
        }, 10); 
        
        clearTimeout(mediumTimeout);
        mediumTimeout = setTimeout(() => {
          if (iframeHeight !== getIFrameHeight()) {
            sendHeight();
          }
          }, 50);
        
        clearTimeout(longTimeout);
        longTimeout = setTimeout(() => {
          if (iframeHeight !== getIFrameHeight()) {
            sendHeight();
          }
          }, 100);  
      }

      
      window.addEventListener('load', sendHeight);
      window.addEventListener('resize', sendHeight);

      const observer = new MutationObserver(sendHeight);
      observer.observe(document.body, { 
        attributes: true, 
        childList: true, 
        subtree: true 
      });
    (${extractCode("watchresize")})();
    </script>
  `;

  if (htmlContent.includes("</body>")) {
    return htmlContent.replace("</body>", `${resizeScript}</body>`);
  } else {
    return htmlContent + resizeScript;
  }
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".woff": "application/font-woff",
    ".ttf": "application/font-ttf",
    ".eot": "application/vnd.ms-fontobject",
    ".otf": "application/font-otf",
    ".wasm": "application/wasm",
  };

  return mimeTypes[ext] || "application/octet-stream";
}

function serveNotFound(res) {
  res.writeHead(404);
  res.end("Not Found");
}

function setupWebSocketServer(wss) {
  wss.on("error", (error) => {
    console.error("WebSocket server error:", error);
  });

  wss.on("connection", handleWebSocketConnection);
}

function handleWebSocketConnection(ws, request) {
  const cookies = parseCookies(request.headers.cookie);
  const sessionId = cookies.sessionId;

  if (!sessions.has(sessionId)) {
    ws.close(1008, "Invalid session");
    return;
  }

  const session = sessions.get(sessionId);
  session.ws = ws;

  setupWebSocketListeners(ws, session);
  sendInitialConnectionInfo(ws, sessionId);
}

function setupWebSocketListeners(ws, session) {
  ws.on("message", (message) => handleWebSocketMessage(message, session));
  ws.on("close", () => handleWebSocketClose(session));
  ws.on('error', (error) => {
    // Handle the error appropriately
  });
}

async function handleWebSocketMessage(messageString, session) {
  const message = JSON.parse(messageString.toString());

  if (message.data === "connect") {
    initModule(message.key, session, message.pageId);
  } else if (message.data === 'disconnect') {
    const child = serverModules.get(message.key);
    if (child) {
      child.send({ key: message.key, data: "disconnect", target: session.sessionId, pageId: message.pageId });
    }
  } else {
    if (message.target === "*") {
      console.error("Client attempted to send a broadcast message", session.id, message);
    } else {
      if (!message.target) {
        message.target = session.sessionId;
      }
      await session.interBus.receiveExternalMessage(message);
    }
  }
}

function handleWebSocketClose(session) {
  sessions.delete(session.sessionId);
  closeSessionForModule(session);
}

function sendInitialConnectionInfo(ws, session) {
  ws.send(
    JSON.stringify({
      key: "connect",
      data: {
        sessionId: session.sessionId,
      },
    })
  );
}

function startServer(server, options) {
  const PORT = parseInt(options.port) || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

function parseCookies(cookieHeader) {
  return cookieHeader.split(";").reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split("=");
    acc[key] = value;
    return acc;
  }, {});
}

// </session>

// <module>

function loadServerModule(project) {
  const child = forkChildProcess(project);
  setupChildProcessListeners(child, project);
  registerModule(child, project);
  return child;
}

function forkChildProcess(project) {
  return spawn(process.execPath, [__filename, '--sandboxed', '--timeout='+getVertstackTimeout(), project], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    maxBuffer: 100 * 1024 * 1024,
  });
}

function setupChildProcessListeners(child, project) {
  const prefix = createColoredPrefix(project, projectKeys.keys());

  child.stdout.on('data', (data) => {
    process.stdout.write(`${prefix} ${data}`);
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(`${prefix} \x1b[31m${data}\x1b[0m`);
  });

  child.on('message', (message) => handleChildProcessMessage(message, project, child));
  child.on('error', (error) => handleChildProcessError(error, project));
  child.on('exit', (code) => handleChildProcessExit(code, project));
}

function handleChildProcessMessage(message, project, child) {
  if (typeof message === 'string') {
    const prefix = createColoredPrefix(project, projectKeys.keys());
    console.log(`${prefix} ${message}`);
    return;
  }

  broadcastMessageToSessions(message, project);
}

function broadcastMessageToSessions(message, sourceProject) {
  sessions.forEach(async (session) => {
    if (session.ws && (message.target === "*" || session.sessionId === message.target)) {
      const messageToSend = { ...message };
      if (message.target === "*") {
        messageToSend.target = session.sessionId;
        messageToSend.pageId = "*";
      }
      await session.interBus.receiveInternalMessage(sourceProject, messageToSend);
    }
  });
}

function handleChildProcessError(error, project) {
  const prefix = createColoredPrefix(project, projectKeys.keys());
  console.error(`${prefix} \x1b[31m${error}\x1b[0m`);
}

function handleChildProcessExit(code, project) {
  const prefix = createColoredPrefix(project, projectKeys.keys());
  console.log(`${prefix} Child process exited with code ${code}`);
}

function registerModule(child, project) {
  serverModules.set(project, child);
}

process.on('SIGINT', () => {
  console.log('Caught interrupt signal');
  serverModules.forEach((child, project) => {
    console.log(`Terminating child process for ${project}`);
    child.kill('SIGTERM');
  });
  process.exit();
});

// </module>

// <client>
function client(projectKey) {
  let pageId;
  let queue = [];
  const [bus, handleExternal] = createBus(projectKey, (message) => {
    if (!pageId) {
      queue.push(message);
      return;
    }
    message.pageId = pageId;
    broadcastChannel.postMessage(message);
  });
  window.bus = bus;

  const broadcastChannel = new BroadcastChannel(projectKey);
  broadcastChannel.onmessage = async (event) => {
    const message = event.data;
    if (!message.interBus || (!message.requestId && !message.responseId)) {
      return;
    }

    if (message.pageId !== pageId) {
      return;
    }

    const res = await handleExternal(message);
    if (!message.responseId) {
      broadcastChannel.postMessage({
        responseId: message.requestId,
        data: res,
        pageId
      });
    }
  };

  function initClient(receivedPageId) {
    pageId = receivedPageId;

    broadcastChannel.postMessage({ key: projectKey, data: "connect", pageId });

    window.addEventListener('beforeunload', () => {
      broadcastChannel.postMessage({ key: projectKey, data: "disconnect", pageId });
    });

    queue.forEach(message => {
      message.pageId = pageId;
      broadcastChannel.postMessage(message);
    });

    setupMouseEventSharing();
  }

  function setupMouseEventSharing() {
    const mouseEvents = ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu', 'wheel'];

    function getIframeOffset() {
      let win = window;
      let totalOffsetX = 0;
      let totalOffsetY = 0;

      while (win !== window.top) {
        const rect = win.frameElement.getBoundingClientRect();
        totalOffsetX += rect.left;
        totalOffsetY += rect.top;
        win = win.parent;
      }

      return { x: totalOffsetX, y: totalOffsetY };
    }

    function sendEventToParent(event) {
      if (event.isSynthetic) {
        return;
      }

      const eventProps = [
        'clientX', 'clientY', 'pageX', 'pageY', 'screenX', 'screenY',
        'offsetX', 'offsetY', 'movementX', 'movementY',
        'button', 'buttons', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey'
      ];

      const iframeOffset = getIframeOffset();
      const eventData = {
        type: event.type,
        iframeOffset: iframeOffset,
        projectKey
      };

      eventProps.forEach(prop => {
        if (event[prop] !== undefined) {
          if (prop.endsWith('X')) {
            eventData[prop] = event[prop] + iframeOffset.x;
          } else if (prop.endsWith('Y')) {
            eventData[prop] = event[prop] + iframeOffset.y;
          } else {
            eventData[prop] = event[prop];
          }
        }
      });

      window.top.postMessage({
        type: 'childMouseEvent',
        event: eventData
      }, '*');
    }

    function propagateEventToChildren(eventData) {
      const iframes = Array.from(document.getElementsByTagName('iframe'));
      iframes.forEach(iframe => {
        const iframeRect = iframe.getBoundingClientRect();
        const iframeEvent = {
          ...eventData,
          clientX: eventData.clientX - iframeRect.left,
          clientY: eventData.clientY - iframeRect.top,
          pageX: eventData.pageX - iframeRect.left + iframe.contentWindow.pageXOffset,
          pageY: eventData.pageY - iframeRect.top + iframe.contentWindow.pageYOffset
        };
        iframe.contentWindow.postMessage({
          type: 'mouseEvent',
          event: iframeEvent
        }, '*');
      });
    }

    mouseEvents.forEach(eventType => {
      window.addEventListener(eventType, sendEventToParent, false);
    });

    window.addEventListener('message', event => {
      if (event.data.type === 'mouseEvent') {
        const eventData = event.data.event;

        const recreatedEvent = new MouseEvent(eventData.type, {
          ...eventData,
          bubbles: true,
          cancelable: true
        });

        recreatedEvent.isSynthetic = true;

        if (eventData.projectKey !== projectKey) {
          document.dispatchEvent(recreatedEvent);
        }

        // Propagate the event to nested iframes
        propagateEventToChildren(eventData);
      }
    }, true);
  }

  window.addEventListener('message', function (event) {
    if (event.data.type === 'setPageId' && !pageId) {
      initClient(event.data.pageId);
    }
  }, false);

  window.addEventListener('message', function (event) {
    if (event.data.type === 'getPageId') {
      window.parent.postMessage({ type: 'setupProjectChannel', projectKey: event.data.projectKey }, '*');
      if (event.source && event.source !== window) {
        event.source.postMessage({ type: 'setPageId', pageId: pageId }, '*');
      }
    }
  }, false);

  window.parent.postMessage({ type: 'getPageId', projectKey: projectKey }, '*');
}
// </client>

// <webworker>
function webWorker() {
  let ws;
  const clients = new Set();
  const broadcastChannels = new Map();
  const clientInstances = new Map();
  let interBus;
  let unloading = false;
  let queue = [];

  function connectWebSocket() {
    ws = new WebSocket(`${self.location.protocol === 'https:' ? 'wss://' : 'ws://'}${self.location.host}`);
    ws.onopen = () => {
      if (queue.length > 0) {
        queue.forEach(message => ws.send(JSON.stringify(message)));
        queue = [];
      }
      broadcast({ type: 'ready' });
    }
    ws.onclose = () => {
      broadcast({ type: 'close' });
      broadcastChannels.forEach(channel => channel.close());
      self.close();
    };
    ws.onerror = (error) => broadcast({ type: 'error', error });
    ws.onmessage = (event) => handleWebSocketMessage(event.data);
  }

  function broadcast(message) {
    clients.forEach(client => client.postMessage(message));
  }

  function handleWebSocketMessage(data) {
    const message = JSON.parse(data);
    interBus.receiveExternalMessage(message);
  }

  function setupBroadcastChannel(key) {
    if (!broadcastChannels.has(key)) {
      const channel = new BroadcastChannel(key);
      channel.onmessage = (event) => handleProjectChannelMessage(key, event);
      broadcastChannels.set(key, channel);
    }
  }

  function connectClientInstance(key, pageId) {
    if (!clientInstances.has(key)) {
      clientInstances.set(key, new Set());
    }
    clientInstances.get(key).add(pageId);

    interBus.registerChannel(key, (message) => {
      message.interBus = true;
      broadcastChannels.get(key).postMessage(message);
    }, pageId);
  }

  function setupInterBus() {
    interBus = new InterBus((message) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });
  }

  function handleProjectChannelMessage(sourceKey, event) {
    const message = event.data;
    const pageId = message.pageId;

    if (!pageId) {
      console.error('Received message without pageId', message);
      return;
    }

    if (message.data === "connect" && message.key === sourceKey) {
      connectClientInstance(sourceKey, pageId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ key: sourceKey, data: "connect", pageId: pageId }));
      } else {
        queue.push({ key: sourceKey, data: "connect", pageId: pageId });
      }
      return;
    } else if (message.data === "disconnect" && message.key === sourceKey) {
      setTimeout(() => {
        if (unloading) return;
        ws.send(JSON.stringify({ key: sourceKey, data: "disconnect", pageId: pageId }));
      });
      if (clientInstances.has(sourceKey)) {
        clientInstances.get(sourceKey).delete(pageId);
        if (clientInstances.get(sourceKey).size === 0) {
          clientInstances.delete(sourceKey);
        }
      }
      interBus.unregisterChannel(sourceKey, pageId);
      return;
    }
    if (message.target === "*") {
      throw new Error("Client cannot handle broadcast messages, " + JSON.stringify(message));
    }
    if (message.pageId && message.pageId !== pageId) {
      console.error('Ignoring message for different pageId', message);
      return;
    }
    interBus.receiveInternalMessage(sourceKey, message);
  }

  self.onconnect = (e) => {
    const port = e.ports[0];
    clients.add(port);

    if (!ws || ws.readyState === WebSocket.CLOSED) {
      connectWebSocket();
    } else {
      port.postMessage({ type: 'ready' });
    }

    if (!interBus) {
      setupInterBus();
    }

    port.onmessage = (event) => {
      const { type, data } = event.data;
      switch (type) {
        case 'setupChannel':
          setupBroadcastChannel(data);
          break;
        case 'send':
          handleProjectChannelMessage(data.sourceKey, { data: data.message });
          break;
      }
    };

    port.start();
  };

  self.onclose = () => {
    unloading = true;
    clients.forEach(client => client.close());
    ws.close();
    broadcastChannels.forEach(channel => channel.close());
  }
}
// </webworker>

// <mainclient>
function mainClient(projectKeys) {
  let worker;
  let workerReady = false;
  let messageQueue = [];
  let channels = [];

  const pageId = Math.random().toString(36).substring(2) + Date.now().toString(36);

  function setupWorker() {
    worker = new SharedWorker('websocket-worker.js');
    worker.port.onmessage = handleWorkerMessage;
    worker.port.start();

    projectKeys.forEach(key => {
      sendOrQueueMessage({ type: 'setupChannel', data: key });
      setupSingleProjectChannel(key);
    });

    worker.port.postMessage({ type: 'ready' });
  }

function sendOrQueueMessage(message) {
  if (workerReady && worker) {
    worker.port.postMessage(message);
  } else {
    messageQueue.push(message);
  }
}

  function flushMessageQueue() {
    while (messageQueue.length > 0) {
      const message = messageQueue.shift();
      worker.port.postMessage(message);
    }
  }

  function handleWorkerMessage(event) {
    const { type, data } = event.data;
    switch (type) {
      case 'ready':
        workerReady = true;
        flushMessageQueue();
        cleanupBroadcastChannels();
        break;
      case 'close':
        console.log("WebSocket connection closed, reloading...");
        setTimeout(() => location.reload(), 250);
        break;
      case 'error':
        console.error("WebSocket error:", data);
        break;
    }
  }

  function setupSingleProjectChannel(key) {
    const channel = new BroadcastChannel(key);
    channel.onmessage = (event) => handleProjectChannelMessage(key, event);
    channels.push(channel);
  }

  function handleProjectChannelMessage(sourceKey, event) {
    const message = event.data;
    sendOrQueueMessage({ type: 'send', data: { sourceKey, message } });
  }

  function cleanupBroadcastChannels() {
    channels.forEach(channel => {
      channel.onmessage = null;
      channel.close();
    });
    channels = [];
  }

  function setupMouseEventSharing() {
    const iframes = new Set();

    function findAllIframes(win = window) {
      const frames = Array.from(win.document.getElementsByTagName('iframe'));
      frames.forEach(frame => {
        iframes.add(frame.contentWindow);
        findAllIframes(frame.contentWindow);
      });
    }

    function initIframeTracking() {
      findAllIframes();
      const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node.tagName === 'IFRAME') {
              iframes.add(node.contentWindow);
              findAllIframes(node.contentWindow);
            }
          });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    function getDocumentOffset() {
      const bodyStyle = window.getComputedStyle(document.body);
      return {
        x: parseInt(bodyStyle.marginLeft, 10),
        y: parseInt(bodyStyle.marginTop, 10)
      };
    }
    function propagateEvent(originalEvent) {
      const docOffset = getDocumentOffset();
      iframes.forEach((frameWindow) => {
        const frameElement = frameWindow.frameElement;
        if (frameElement) {
          const rect = frameElement.getBoundingClientRect();
          const adjustedEvent = {
            ...originalEvent,
            clientX: originalEvent.clientX - rect.left - docOffset.x,
            clientY: originalEvent.clientY - rect.top - docOffset.y,
            pageX: originalEvent.pageX - rect.left - docOffset.x,
            pageY: originalEvent.pageY - rect.top - docOffset.y
          };
          frameWindow.postMessage({
            type: 'mouseEvent',
            event: adjustedEvent
          }, '*');
        }
      });
    }

    window.addEventListener('message', event => {
      if (event.data.type === 'childMouseEvent') {
        propagateEvent(event.data.event);
      }
    }, true);

    const mouseEvents = ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu', 'wheel'];
    mouseEvents.forEach(eventType => {
      window.addEventListener(eventType, (event) => {
        const docOffset = getDocumentOffset();
        const adjustedEvent = {
          type: event.type,
          clientX: event.clientX + docOffset.x,
          clientY: event.clientY + docOffset.y,
          pageX: event.pageX + docOffset.x,
          pageY: event.pageY + docOffset.y,
        };
        propagateEvent(adjustedEvent);
      }, true);
    });

    initIframeTracking();
    window.rescanIframes = initIframeTracking;
  }

  window.addEventListener('message', function (event) {
    if (event.data.type === 'getPageId') {
      if (event.source && event.source !== window) {
        event.source.postMessage({ type: 'setPageId', pageId: pageId }, '*');
      }
      if (!projectKeys.includes(event.data.projectKey)) {
        sendOrQueueMessage({ type: 'setupChannel', data: event.data.projectKey });
      }
    } else if (event.data.type === 'setupProjectChannel') {
      if (!workerReady) {
        setupSingleProjectChannel(event.data.projectKey);
      }
      sendOrQueueMessage({ type: 'setupChannel', data: event.data.projectKey });
    }
  }, false);

  setupWorker();
  setupMouseEventSharing();
}
// </mainclient>

// <sandbox>
function handleSandboxedMode() {
  if (!isSandboxed) return;

  const projectKey = process.argv[process.argv.indexOf("--sandboxed") + 2];
  let moduleLoaded = false;
  let serverModule;
  const messageQueue = [];
  const sessions = new Map();
  const cleanupCallbacks = [];

  async function loadModule(project) {
    const folderPath = path.join(process.cwd(), project);
    const { moduleCreator, modulePath, exports } = await findAndLoadModule(folderPath);
    moduleLoaded = true;
    return { moduleCreator, exports };
  }

  async function findAndLoadModule(folderPath) {
    const serverJsPath = path.join(folderPath, "server.js");
    const serverMjsPath = path.join(folderPath, "server.mjs");

    if (fs.existsSync(serverMjsPath)) {
      const module = await import(url.pathToFileURL(serverMjsPath));
      return {
        moduleCreator: module.default || module,
        modulePath: serverMjsPath,
        exports: module
      };
    } else if (fs.existsSync(serverJsPath)) {
      const module = require(serverJsPath);
      return {
        moduleCreator: module.default || module,
        modulePath: serverJsPath,
        exports: module
      };
    } else {
      console.warn(`No module found for project ${path.basename(folderPath)}`);
      return { moduleCreator: () => { }, modulePath: "No module found", exports: {} };
    }
  }

  async function handleIncomingMessage(message) {
    if (!moduleLoaded) {
      messageQueue.push(message);
      return;
    }
    const pageId = message.pageId;

    if (message.data === "connect") {
      handleNewConnection(message, pageId);
    } else if (message.data === "disconnect") {
      const [, , cleanup] = sessions.get(`${message.target}_${pageId}`) || [];
      if (cleanup) {
        cleanup();
      }
    } else {
      const [bus, handleExternal] = sessions.get(`${message.target}_${message.pageId}`) || [];
      if (!bus) {
        let responses = [];
        for (const [key, [bus, handleExternal]] of sessions.entries()) {
          const response = handleExternal(message);
          if (response && !message.responseId) {
            responses.push(response);
          }
        }
        if (responses.length && !message.responseId) {
          process.send({
            responseId: message.requestId,
            data: (await Promise.all(responses)).flat(),
            target: message.target,
            pageId,
          });
        } else {
          process.send({
            responseId: message.requestId,
            data: [],
            target: message.target,
            pageId,
          });
        }

        return;
      }
      const res = await handleExternal(message);
      if (!message.responseId) {
        process.send({
          responseId: message.requestId,
          data: res,
          target: message.target,
          pageId,
        });
      }
    }
  }

  function handleNewConnection(message, pageId) {
    const cleanups = [];
    const sessionId = message.target;
    const [bus, handleExternal, closeBus] = createBus(projectKey, (payload) => {
      if (!payload.target || payload.target === true) {
        payload.target = sessionId;
      }
      payload.pageId = payload.pageId ?? pageId;
      payload.originPageId = pageId;
      process.send(payload);
    });
    const cleanupSession = () => {
      sessions.delete(`${sessionId}_${pageId}`);
      cleanups.forEach((cleanup) => {
        const index = cleanupCallbacks.indexOf(cleanup);
        if (index !== -1) {
          cleanupCallbacks.splice(index, 1);
        }
        cleanup();
      });
      closeBus();
    };
    sessions.set(`${sessionId}_${pageId}`, [bus, handleExternal, cleanupSession]);

    for (let [key, func] of Object.entries(serverModule.exports)) {
      if (typeof func === 'function' && key !== 'default') {
        if (key.startsWith('_')) {
          key = key.slice(1);
          bus(key, (payload) => func(payload.data, bus, sessionId, pageId, payload));
        } else if (key.startsWith('$')) {
          bus(key, (payload) => func(payload.data, bus, sessionId, pageId, payload));
        } else {
          bus("*." + key, (payload) => func(payload.data, bus, sessionId, pageId, payload));
        }
        let altKey = key.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
        if (key !== altKey) {
          if (altKey.startsWith('_')) {
            altKey = altKey.slice(1);
            bus(altKey, (payload) => func(payload.data, bus, sessionId, pageId, payload));
          } else if (altKey.startsWith("$")) {
            bus(altKey, (payload) => func(payload.data, bus, sessionId, pageId, payload));
          } else {
            bus("*." + altKey, (payload) => func(payload.data, bus, sessionId, pageId, payload));
          }
        }
      }
    }

    const cleanup = serverModule.moduleCreator(bus, sessionId, pageId) ?? (() => { });
    cleanups.push(cleanup);
    if (typeof cleanup === 'function') {
      cleanupCallbacks.push(cleanup);
    }
  }

  process.on('message', handleIncomingMessage);

  process.on("SIGTERM", async () => {
    for (const cleanup of cleanupCallbacks) {
      await cleanup();
    }
    process.exit(0);
  });

  loadModule(projectKey).then(({ moduleCreator, exports }) => {
    serverModule = { moduleCreator, exports };
    messageQueue.forEach(handleIncomingMessage);
  });
}

// </sandbox>

if (isSandboxed) {
  handleSandboxedMode();
} else {
  // Load server modules from command-line arguments
  const args = process.argv.slice(2);

  if (args.length > 0) {
    const [prefixedArgs, modules] = args.reduce(
      (acc, arg) => {
        if (arg.startsWith("--")) {
          acc[0].push(arg.slice(2).split("="));
        } else {
          const [module, proxyPort] = arg.split('=');
          acc[1].push({ module, proxyPort });
        }
        return acc;
      },
      [[], []]
    );
    const options = prefixedArgs.reduce((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {
      port: "3000",
    });

    const proxyPorts = new Map();
    modules.forEach(({ module, proxyPort }) => {
      if (proxyPort) {
        proxyPorts.set(module, proxyPort);
      }
      projectKeys.set(module, module);
    });

    Promise.all(
      modules.map(({ module }) => loadServerModule(module))
    ).then(() => {
      setupServer(options, proxyPorts);
    });
  } else {
    console.log(
      "No server modules specified. Run with: node script.js module1[=proxyPort] module2[=proxyPort] ..."
    );
  }
}