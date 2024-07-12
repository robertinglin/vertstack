const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const url = require("url");
const zlib = require("zlib");
const { execSync, spawn } = require("child_process");
const os = require("os");

const isSandboxed = process.argv.includes("--sandboxed");

const fullCode = fs.readFileSync(__filename, "utf8");
function extractCode(tag) {
  const tagRegex = new RegExp(`// <${tag}>([\\s\\S]*?)// <\\/${tag}>`);
  const match = fullCode.match(tagRegex);
  return match ? match[1].trim() : "";
}

// <parsekey>
function extractProjectKey(key) {
  if (key.startsWith("!") || key.startsWith("@") || key.startsWith("#")) {
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

  if (key.startsWith("!")) {
    normalizedKey = key.slice(1);
    isPrivate = true;
  } else if (key.startsWith("@")) {
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
      normalizedKey = "!" + normalizedKey;
    } else if (isLocal) {
      normalizedKey = "@" + normalizedKey;
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

// <bus>
function createBus(projectKey, handleRemoteDispatch) {
  const subscribers = new Map();
  const responsePromises = new Map();

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

  function alwaysDispatchFromBus(key, data, target) {
    const requestId = Math.random().toString(36).slice(2);
    return new Promise(async (resolve, reject) => {
      let { normalizedKey } = parseKey(key, projectKey);
      handleRemoteDispatch({
        key: normalizedKey,
        data,
        requestId,
        target,
      });
      responsePromises.set(requestId, resolve);
      setTimeout(() => {
        if (responsePromises.has(requestId)) {
          responsePromises.delete(requestId);
          console.error("Request timed out: " + requestId);
        }
        resolve([]);
      }, 5000);
    }).then((response) => {
      let { normalizedKey } = parseKey(key, projectKey);
      if (normalizedKey.startsWith("!") || normalizedKey.startsWith("@")) {
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
    responses.push(...notifySubscribers("*", { key, data }));
    responses.push(...notifySubscribers(key, { key, data }));

    const keyParts = key.split(".");
    for (let i = 1; i <= keyParts.length; i++) {
      const partialKey = keyParts.slice(0, i).join(".");
      if (partialKey !== key) {
        responses.push(...notifySubscribers(partialKey, { key, data }));
      }

      const wildcardKey = `*.${keyParts.slice(1, i).join(".")}`;
      responses.push(...notifySubscribers(wildcardKey, { key, data }));
    }

    return responses;
  }

  function notifySubscribers(key, payload) {
    let responses = [];
    if (subscribers.has(key)) {
      subscribers.get(key).forEach((callback) => {
        try {
          const response = callback(payload);
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
      });
    }
    return responses;
  }

  const bus = function bus(keyOrCallback, dataOrTarget, maybeTarget) {
    if (typeof keyOrCallback === "function") {
      return handleSubscription(projectKey, keyOrCallback);
    } else if (typeof dataOrTarget === "function") {
      return handleSubscription(keyOrCallback, dataOrTarget);
    } else {
      return alwaysDispatchFromBus(keyOrCallback, dataOrTarget, maybeTarget); // handleDispatch(keyOrCallback, dataOrTarget, maybeTarget);
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

  return [bus, processExternalMessage];
}
// </bus>

// <interbus>
function createInterbus(sendExternalMessage) {
  const channels = new Map();
  const projectRequestPromises = new Map();

  this.receiveExternalMessage = async (message) => {
    if (message.requestId) {
      const channelResponses = [];
      const projectKey = extractProjectKey(message.key);
      const parsedKey = parseKey(message.key, projectKey);

      for (const [channelKey, channel] of channels) {
        if (!parsedKey.isPrivate || channelKey === projectKey) {
          channelResponses.push(
            new Promise((resolve) => {
              projectRequestPromises.set(
                channelKey + "_" + message.requestId,
                resolve
              );
              channel(message);
            })
          );
        }
      }

      if (channelResponses.length > 0) {
        const timeout = new Promise((resolve) => {
          setTimeout(() => {
            resolve([]);
          }, 5000);
        });
        const response = await Promise.race([
          Promise.all(channelResponses),
          timeout,
        ]);
        sendExternalMessage({
          responseId: message.requestId,
          data: response.flat(),
        });
      }
    } else if (message.responseId) {
      const requestId = message.responseId;
      const resolve = projectRequestPromises.get("external_" + requestId);
      if (resolve) {
        projectRequestPromises.delete("external_" + requestId);
        resolve(message.data);
      }
    }
  };

  this.receiveInternalMessage = async (projectKey, message) => {
    if (message.requestId) {
      const channelResponses = [];
      const parsedKey = parseKey(message.key, projectKey);

      for (const [channelKey, channel] of channels) {
        if (!parsedKey.isPrivate && channelKey !== projectKey) {
          channelResponses.push(
            new Promise((resolve) => {
              projectRequestPromises.set(
                channelKey + "_" + message.requestId,
                resolve
              );

              channel(message);
            })
          );
        }
      }

      let externalPromise;
      if (!parsedKey.isLocal) {
        sendExternalMessage(message);
        externalPromise = new Promise((resolve) => {
          projectRequestPromises.set("external_" + message.requestId, resolve);
        });
      }

      const timeout = new Promise((resolve) => {
        setTimeout(() => {
          resolve([]);
        }, 5000);
      });
      const externalResponses = externalPromise ? externalPromise : [];
      const response = await Promise.race([
        Promise.all([...channelResponses, externalResponses]),
        timeout,
      ]);

      const channel = channels.get(projectKey);
      if (channel) {
        channel({
          responseId: message.requestId,
          data: response.flat(),
        });
      }
    } else if (message.responseId) {
      const requestId = message.responseId;
      const resolve = projectRequestPromises.get(projectKey + "_" + requestId);

      if (resolve) {
        resolve(message.data);
        projectRequestPromises.delete(projectKey + "_" + requestId);
      } else {
        console.error(
          "No resolve function found for",
          projectKey + "_" + requestId
        );
      }
    }
  };

  this.registerChannel = (key, bus) => {
    channels.set(key, bus);
  };

  return this;
}
// </interbus>

// <server>
const sessions = new Map();
const serverModules = new Map();
const projectKeys = new Map();
// <websocket>
// Load the 'ws' package
let WebSocket;

async function getWsPackage() {
  const cacheDir = path.join(__dirname, ".cache");
  const wsDir = path.join(cacheDir, "ws");
  const tarballPath = path.join(cacheDir, "ws.tar.gz");
  const WebSocketPath = path.join(wsDir, "index.js");

  // Check if the specific file we need exists
  if (fs.existsSync(WebSocketPath)) {
    return require(WebSocketPath);
  }

  // If the cache directory exists but the file doesn't, clean it up
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }

  // Recreate the cache directory
  fs.mkdirSync(cacheDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tarballPath);
    https
      .get("https://registry.npmjs.org/ws/-/ws-8.13.0.tgz", (response) => {
        response.pipe(file);
        file.on("finish", () => {
          file.close(async () => {
            try {
              if (os.platform() === "win32") {
                // Windows extraction using Node.js built-in modules
                await extractTarGz(tarballPath, cacheDir);
              } else {
                // Unix-like (Linux, macOS)
                execSync(`tar -xzf ${tarballPath} -C ${cacheDir}`);
              }

              // Rename the extracted folder
              fs.renameSync(path.join(cacheDir, "package"), wsDir);

              // Remove the tarball
              fs.unlinkSync(tarballPath);

              if (fs.existsSync(WebSocketPath)) {
                resolve(require(WebSocketPath));
              } else {
                reject(
                  new Error("WebSocket server file not found after extraction")
                );
              }
            } catch (error) {
              reject(error);
            }
          });
        });
      })
      .on("error", (err) => {
        fs.unlink(tarballPath, () => reject(err));
      });
  });
}

async function extractTarGz(tarballPath, destPath) {
  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    const extract = extractTar(destPath);

    fs.createReadStream(tarballPath)
      .pipe(gunzip)
      .pipe(extract)
      .on("finish", resolve)
      .on("error", reject);
  });
}

function extractTar(destPath) {
  let currentFileInfo = null;
  let currentFileBuffer = null;

  return new require("stream").Transform({
    transform(chunk, encoding, callback) {
      let offset = 0;
      while (offset < chunk.length) {
        if (!currentFileInfo) {
          // Read header
          if (chunk.length - offset < 512) {
            break;
          }
          const header = chunk.slice(offset, offset + 512);
          offset += 512;

          const nameBuffer = header.slice(0, 100);
          const name = nameBuffer.toString().split("\0")[0].trim();

          if (name === "") {
            break;
          }

          const sizeBuffer = header.slice(124, 124 + 12);
          const size = parseInt(sizeBuffer.toString().trim(), 8);

          currentFileInfo = { name, size, bytesRead: 0 };
          currentFileBuffer = [];

          if (size === 0) {
            fs.mkdirSync(path.join(destPath, name), { recursive: true });
            currentFileInfo = null;
          }
        } else {
          // File content
          const bytesToRead = Math.min(
            chunk.length - offset,
            currentFileInfo.size - currentFileInfo.bytesRead
          );
          const fileContent = chunk.slice(offset, offset + bytesToRead);
          currentFileBuffer.push(fileContent);
          offset += bytesToRead;
          currentFileInfo.bytesRead += bytesToRead;

          if (currentFileInfo.bytesRead >= currentFileInfo.size) {
            const filePath = path.join(destPath, currentFileInfo.name);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, Buffer.concat(currentFileBuffer));

            const padding = 512 - (currentFileInfo.size % 512);
            if (padding < 512) {
              offset += padding;
            }

            currentFileInfo = null;
            currentFileBuffer = null;
          }
        }
      }
      callback();
    },
  });
}

// </websocket>

// <session>

const initModule = (projectKey, session) => {
  const sessionId = session.sessionId;
  // Initialize the server module for this session
  if (serverModules.has(projectKey)) {
    const child = serverModules.get(projectKey);
    session.interBus.registerChannel(projectKey, (message) => {
      if (!message.target) {
        message.target = sessionId;
      }
      child.stdin.write(JSON.stringify(message) + "\n");
    });
    child.stdin.write(
      JSON.stringify({ key: projectKey, data: "connect", target: sessionId }) +
        "\n"
    );
  }
};

function createSession() {
  const sessionId = crypto.randomBytes(16).toString("hex");
  const sessionInterBus = createInterbus((message) => {
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

function setupServer(options) {
  const server = createHttpServer();
  const wss = new WebSocket.Server({ noServer: true });

  setupWebSocketServer(wss);
  setupHttpServerUpgrade(server, wss);
  startServer(server, options);
}

function getIFrameCode() {
  const parseKey = extractCode("parsekey");
  const bus = extractCode("bus");
  const client = extractCode("client");

  return `
    ${parseKey}
    ${bus}
    (${client})(projectKey);
  `;
}

function getMainClientCode() {
  const parseKey = extractCode("parsekey");
  const interBus = extractCode("interbus");
  const mainClientCode = extractCode("mainclient");

  return `
    ${parseKey}
    ${interBus}
    const projectKeys = ${JSON.stringify(Array.from(projectKeys.keys()))};
    (${mainClientCode})(projectKeys);
`;
}

function createHttpServer() {
  return http.createServer((req, res) => {
    const urlParts = req.url.split("/");
    const projectKey = urlParts[1].split("?")[0];

    if (req.url === "/") {
      serveMainPage(res);
    } else if (projectKeys.has(projectKey)) {
      serveProjectPage(req, res, projectKey);
    } else {
      serveNotFound(res);
    }
  });
}
function serveMainPage(res) {
  const sessionId = createSession();
  const mainClientCode = getMainClientCode();
  res.writeHead(200, {
    "Content-Type": "text/html",
    "Set-Cookie": `sessionId=${sessionId}; HttpOnly; Path=/`,
  });

  let htmlContent;
  let usingCustomIndex = false;
  try {
    // Try to read the index.html file from the root directory
    htmlContent = fs.readFileSync("index.html", "utf8");
    usingCustomIndex = true;
  } catch (error) {
    // If index.html doesn't exist, we'll use the default template
    usingCustomIndex = false;
  }

  const currentTime = Date.now();

  if (usingCustomIndex) {
    // Replace module comments with iframes in custom index.html
    htmlContent = htmlContent.replace(
      /<!-- @(\w+) -->/g,
      (match, moduleName) => {
        if (projectKeys.has(moduleName)) {
          return `
          <iframe
            id="iframe-${moduleName}"
            src="/${moduleName}?t=${currentTime}"
            style="border: none; background-color: transparent; width: 100%"
            allowTransparency="true"
            frameBorder="0"
            scrolling="no">
          </iframe>
        `;
        }
        return match; // Keep the comment if the module doesn't exist
      }
    );
  } else {
    // Generate the default layout with all modules
    const projectIframes = Array.from(projectKeys.entries())
      .map(
        ([key], index) => `
    <iframe
      id="iframe-${key}"
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
      (function () {
        let lastHeightMap = new Map();

        function setIframeHeight(iframe, projectKey, newHeight, attempts = 0) {
          if (
            lastHeightMap.get(projectKey) === newHeight ||
            !lastHeightMap.has(projectKey)
          ) {
            iframe.style.height = "";
            lastHeightMap.set(projectKey, "!" + newHeight);
            requestAnimationFrame(() => {
              const height = iframe.contentDocument.body.scrollHeight;
              iframe.style.height = height + "px";
            });
          } else if (lastHeightMap.get(projectKey) === "!" + newHeight) {
            lastHeightMap.set(projectKey, "!!" + newHeight);
          } else if (lastHeightMap.get(projectKey) !== "!!" + newHeight) {
            iframe.style.height = newHeight + "px";
            lastHeightMap.set(projectKey, newHeight);
          } else {
            setTimeout(() => {
              if (
                newHeight == lastHeightMap.get(projectKey)?.replaceAll("!", "")
              ) {
                lastHeightMap.delete(projectKey);
              }
            });
          }
        }
        window.addEventListener(
          "message",
          function (event) {
            const iframe = document.getElementById(
              "iframe-" + event.data.projectKey
            );
            if (iframe && typeof event.data.height === "number") {
              setIframeHeight(
                iframe,
                event.data.projectKey,
                event.data.height,
                0
              );
            }
          },
          false
        );
      })();
        </script>
      `;
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

    const clientCode = getIFrameCode(projectKey);
    const clientJsPath = path.join(projectPath, "client.js");
    let clientJsContent = "";
    try {
      clientJsContent = fs.readFileSync(clientJsPath, "utf8");
    } catch (error) {
      // If client.js doesn't exist, we just leave clientJsContent as an empty string
      console.log(`No client.js found for project ${projectKey}`);
    }

    if (publicDir) {
      await serveFromPublicDirectory(
        req,
        res,
        publicDir,
        projectKey,
        clientCode,
        clientJsContent
      );
    } else if (indexHtmlPath) {
      await serveHtmlFile(
        res,
        indexHtmlPath,
        projectKey,
        clientCode,
        clientJsContent
      );
    } else {
      serveDefaultProjectPage(
        res,
        projectKey,
        projectPath,
        clientCode,
        clientJsContent
      );
    }
  } catch (error) {
    console.error("Error in serveProjectPage:", error);
    serveNotFound(res);
  }
}

function serveDefaultProjectPage(
  res,
  projectKey,
  projectPath,
  clientCode,
  clientJsContent
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
    clientCode,
    clientJsContent,
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
  clientCode,
  clientJsContent
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
          clientCode,
          clientJsContent
        );
      } else {
        serveNotFound(res);
      }
    } else {
      const contentType = getContentType(filePath);
      if (contentType === "text/html") {
        await serveHtmlFile(res, filePath, projectKey, clientCode);
      } else {
        const fileContent = fs.readFileSync(filePath, "utf8");
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
  clientCode,
  clientJsContent = ""
) {
  try {
    let htmlContent = fs.readFileSync(filePath, "utf8");

    // Static URL rewriting
    htmlContent = htmlContent.replace(
      /(src|href)=(["'])\/(?!\/)/g,
      `$1=$2/${projectKey}/`
    );

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
                  if (shouldRewriteUrl(originalUrl)) {
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
      clientCode,
      clientJsContent,
      projectKey
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
  clientCode,
  clientJsContent,
  projectKey
) {
  const busCode = `
    <script>
      const projectKey = "${projectKey}";
      ${clientCode}
    </script>
  `;

  const clientJsScript = clientJsContent
    ? `<script>${clientJsContent}</script>`
    : "";

  if (!htmlContent.includes("<script>") && clientJsContent) {
    if (htmlContent.includes("</body>")) {
      htmlContent = htmlContent.replace("</body>", `${clientJsScript}</body>`);
    } else if (htmlContent.includes("</html>")) {
      htmlContent = htmlContent.replace("</html>", `${clientJsScript}</html>`);
    } else {
      htmlContent = `${htmlContent}${clientJsScript}`;
    }
  }

  if (htmlContent.includes("</head>")) {
    htmlContent = htmlContent.replace("</head>", `${busCode}</head>`);
  } else if (htmlContent.includes("<body>")) {
    htmlContent = htmlContent.replace("<body>", `${busCode}<body>`);
  } else if (htmlContent.includes("<html>")) {
    htmlContent = htmlContent.replace(
      "<html>",
      `<html><head>${busCode}</head>`
    );
  } else {
    htmlContent = `<head>${busCode}</head>${htmlContent}`;
  }

  return htmlContent;
}

function injectResizeScript(htmlContent, projectKey) {
  const resizeScript = `
    <script>
      function sendHeight() {
        const height = document.documentElement.scrollHeight;
        window.parent.postMessage({ projectKey: '${projectKey}', height: height }, '*');
      }
      
      window.addEventListener('load', sendHeight);
      window.addEventListener('resize', sendHeight);

      const observer = new MutationObserver(sendHeight);
      observer.observe(document.body, { 
        attributes: true, 
        childList: true, 
        subtree: true 
      });
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

function setupHttpServerUpgrade(server, wss) {
  server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });
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
}

async function handleWebSocketMessage(messageString, session) {
  const message = JSON.parse(messageString.toString());

  if (message.data === "connect") {
    initModule(message.key, session);
  } else {
    if (!message.target) {
      message.target = session.sessionId;
    }
    session.interBus.receiveExternalMessage(message);
  }
}

function handleWebSocketClose(session) {
  sessions.delete(session.sessionId);
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

async function loadServerModule(project) {
  const child = spawnChildProcess(project);
  setupChildProcessListeners(child, project);
  registerModule(child, project);
  return child;
}

function spawnChildProcess(project) {
  return spawn("node", [__filename, "--sandboxed", project], {
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });
}

function setupChildProcessListeners(child, project) {
  child.stdout.on("data", (data) => handleChildProcessOutput(data, project));
  child.stderr.on("data", (data) => handleChildProcessError(data, project));
  child.on("close", (code) => handleChildProcessClose(code, project));
}

function handleChildProcessOutput(data, project) {
  const messages = data
    .toString()
    .split("\n")
    .filter((msg) => msg.trim() !== "");
  messages.forEach((message) => processChildMessage(message, project));
}

function processChildMessage(message, project) {
  if (!message.startsWith("{")) {
    console.log(`${project} :: ${message}`);
    return;
  }

  try {
    const parsedMessage = JSON.parse(message);

    broadcastMessageToSessions(parsedMessage, project);
  } catch (error) {
    console.error(`Error parsing message from ${project}:`, error);
  }
}

function broadcastMessageToSessions(message, sourceProject) {
  sessions.forEach((session) => {
    if (session.sessionId === message.target || message.target === "*") {
      session.interBus.receiveInternalMessage(sourceProject, message);
    }
  });
}

function handleChildProcessError(data, project) {
  console.error(`Error from ${project}:`, data.toString());
}

function handleChildProcessClose(code, project) {
  console.log(`Child process for ${project} exited with code ${code}`);
}

function registerModule(child, project) {
  serverModules.set(project, child);
  projectKeys.set(project, project);
}

// </module>

// <client>
function client(projectKey) {
  const [bus, handleExternal] = createBus(projectKey, (message) => {
    broadcastChannel.postMessage(message);
  });
  window.bus = bus;

  const broadcastChannel = new BroadcastChannel(projectKey);
  broadcastChannel.onmessage = async (event) => {
    const message = event.data;
    const res = await handleExternal(message);
    if (!message.responseId) {
      broadcastChannel.postMessage({
        responseId: message.requestId,
        data: res,
      });
    }
  };
  broadcastChannel.postMessage({ key: projectKey, data: "connect" });
}
// </client>

// <mainclient>
function mainClient(projectKeys) {
  let ws;
  let queue = [];
  const projectChannels = new Map();

  const ibus = createInterbus((message) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      queue.push(message);
    }
  });

  function connectToServer() {
    ws = new WebSocket(`ws://${location.host}`);
    ws.onopen = handleWebSocketOpen;
    ws.onmessage = handleWebSocketMessage;
    ws.onclose = handleWebSocketClose;
    ws.onerror = handleWebSocketError;
  }

  function handleWebSocketOpen() {
    console.log("Main page WebSocket connection opened");
    flushQueue();
  }

  function flushQueue() {
    const messages = queue;
    queue = [];
    messages.forEach((message) => ws.send(JSON.stringify(message)));
  }

  function handleWebSocketMessage(event) {
    const message = JSON.parse(event.data);
    if (message.data === "connect") {
    } else {
      ibus.receiveExternalMessage(message);
    }
  }

  function handleWebSocketClose() {
    setTimeout(connectToServer, 3000);
  }

  function handleWebSocketError(error) {
    console.error("Main page WebSocket error:", error);
  }

  function setupProjectChannels(projectKeys) {
    projectKeys.forEach(setupSingleProjectChannel);
  }

  function setupSingleProjectChannel(key) {
    if (projectChannels.has(key)) return;

    const channel = new BroadcastChannel(key);
    channel.onmessage = (event) => handleProjectChannelMessage(key, event);
    projectChannels.set(key, channel);

    ibus.registerChannel(key, (message) => {
      channel.postMessage(message);
    });

    queue.push({
      key: key,
      data: "connect",
    });
  }

  function handleProjectChannelMessage(sourceKey, event) {
    const message = event.data;
    ibus.receiveInternalMessage(sourceKey, message);
  }

  // Initialize the connection
  connectToServer();

  // Setup initial project channels
  setupProjectChannels(projectKeys);
}
// </mainclient>

// <sandbox>
function handleSandboxedMode() {
  if (!isSandboxed) return;

  const projectKey = process.argv[process.argv.indexOf("--sandboxed") + 1];
  let moduleLoaded = false;
  let serverModule;
  const messageQueue = [];
  const sessions = new Map();
  const cleanupCallbacks = [];

  async function loadModule(project) {
    const folderPath = path.join(process.cwd(), project);
    const { moduleCreator, modulePath } = await findAndLoadModule(folderPath);
    moduleLoaded = true;
    return moduleCreator;
  }

  async function findAndLoadModule(folderPath) {
    const serverJsPath = path.join(folderPath, "server.js");
    const serverMjsPath = path.join(folderPath, "server.mjs");

    if (fs.existsSync(serverMjsPath)) {
      const module = await import(url.pathToFileURL(serverMjsPath));
      return {
        moduleCreator: module.default || module,
        modulePath: serverMjsPath,
      };
    } else if (fs.existsSync(serverJsPath)) {
      return {
        moduleCreator: require(serverJsPath),
        modulePath: serverJsPath,
      };
    } else {
      console.warn(`No module found for project ${path.basename(folderPath)}`);
      return { moduleCreator: () => {}, modulePath: "No module found" };
    }
  }

  async function handleIncomingMessage(chunk) {
    if (!moduleLoaded) {
      messageQueue.push(chunk);
      return;
    }

    const messages = chunk
      .toString()
      .split("\n")
      .filter((msg) => msg.trim());
    for (const messageString of messages) {
      let message;
      try {
        message = JSON.parse(messageString);
      } catch (error) {
        console.error("Error parsing message:", error, chunk.toString());
        return;
      }

      if (message.data === "connect") {
        handleNewConnection(message);
      } else {
        const [bus, handleExternal] = sessions.get(message.target) || [];
        if (!bus) {
          console.error("No session found for target", message.target);
          return;
        }
        const res = await handleExternal(message);
        if (!message.responseId) {

          process.stdout.write(
            JSON.stringify({
              responseId: message.requestId,
              data: res,
              target: message.target,
            }) + "\n"
          );
        }
      }
    }
  }

  function handleNewConnection(message) {
    const sessionId = message.target;
    const [bus, handleExternal] = createBus(projectKey, (payload) => {
      if (!payload.target || payload.target === true) {
        payload.target = sessionId;
      }
      process.stdout.write(JSON.stringify(payload) + "\n");
    });
    sessions.set(sessionId, [bus, handleExternal]);

    const cleanup = serverModule(bus, sessionId);
    if (typeof cleanup === "function") {
      cleanupCallbacks.push(cleanup);
    }
  }

  process.stdin.on("data", handleIncomingMessage);

  process.on("SIGTERM", async () => {
    for (const cleanup of cleanupCallbacks) {
      await cleanup();
    }
    process.exit(0);
  });

  loadModule(projectKey).then((sm) => {
    serverModule = sm;
    messageQueue.forEach((message) => process.stdin.emit("data", message));
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
          acc[1].push(arg);
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
    Promise.all(
      modules.map((arg) => {
        return loadServerModule(arg);
      })
    ).then(() => {
      // Server setup is now handled in the setupServer function
      // which is called after WebSocket is loaded

      getWsPackage()
        .then((ws) => {
          WebSocket = ws;
          setupServer(options);
        })
        .catch((err) => {
          console.error("Failed to load WebSocket package:", err);
          process.exit(1);
        });
    });
  } else {
    console.log(
      "No server modules specified. Run with: node script.js module1 module2 ..."
    );
  }
}
