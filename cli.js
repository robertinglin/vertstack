#!/usr/bin/env node
const { spawn, execSync  } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const os = require('node:os');

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function findModuleFile(modulePath, fileName) {
    const mjsPath = path.join(modulePath, `${fileName}.mjs`);
    const jsPath = path.join(modulePath, `${fileName}.js`);

    if (await fileExists(mjsPath)) {
        return mjsPath;
    } else if (await fileExists(jsPath)) {
        return jsPath;
    }
    return null;
}

async function generateReadme(args) {
    const modules = args.filter(arg => !arg.startsWith('--'));
    let readmeContent = '# Project\n\n';

    readmeContent += '### Start'
    readmeContent += '\n\n```sh\n';
    readmeContent += 'npx VertStack ' + args.join(' ') + '\n';
    readmeContent += '```\n\n';
    readmeContent += '## Modules\n\n';
    readmeContent += modules.map(module => `* ${module}`).join('\n') + '\n\n';

    for (const module of modules) {
        readmeContent += `## ${module} module\n\n`;

        const modulePath = path.join(process.cwd(), module);
        const serverFile = await findModuleFile(modulePath, 'server');
        const clientFile = await findModuleFile(modulePath, 'client');

        if (serverFile) {
            readmeContent += await generateModuleSection(serverFile, 'Server');
        }
        if (clientFile) {
            readmeContent += await generateModuleSection(clientFile, 'Client');
        }
    }

    await fs.writeFile('README.md', readmeContent);
    console.log('README.md has been generated successfully.');
}


async function generateModuleSection(filePath, type) {
    let content = '';
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const { incomingMessages, outgoingMessages } = parseFile(fileContent);

        content += `### ${type}\n\n`;
        
        if (incomingMessages.length > 0) {
            content += `#### Incoming Messages\n\n`;
            for (const event of incomingMessages) {
                content += `* \`${event.name}\`\n`;
                if (event.params.length > 0) {
                    content += `  - Payload: \`${event.params} \`\n`;
                }
            }
            content += '\n';
        }

        if (outgoingMessages.length > 0) {
            content += `#### Outgoing Messages\n\n`;
            for (const event of outgoingMessages) {
                content += `* \`${event.name}\`\n`;
            }
            content += '\n';
        }
    } catch (error) {
        console.error(`Error reading ${type} file for module: ${error.message}`);
    }
    return content;
}

function parseFile(fileContent) {
    const incomingMessages = [];
    const outgoingMessages = [];

    // Parse exported functions
    const exportRegex = /export\s+(const|function|let)\s+(\w+)\s*(?:=\s*(?:async\s*)?\(([^)]*)\)\s*=>|=\s*function\s*\(([^)]*)\)|\(([^)]*)\))/g;
    let match;
    while ((match = exportRegex.exec(fileContent)) !== null) {
        const [, , name, arrowParams, funcParams, shortArrowParams] = match;
        const params = (arrowParams || funcParams || shortArrowParams || '').split(',').map(param => param.trim()).filter(p => p !== 'sessionId' && p !== 'bus' && p !== '');
        incomingMessages.push({ name, params: params.join(', ') });
    }

    // Parse bus function calls
    const busRegex = /bus\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:{([^}]*)}\s*=>|function\s*\(([^)]*)\)|\(([^)]*)\)\s*=>)?/g;
    while ((match = busRegex.exec(fileContent)) !== null) {
        const [, name, arrowParams, funcParams, shortArrowParams] = match;
        if (arrowParams || funcParams || shortArrowParams) {
            // This is a listener (incoming message)
            const params = (arrowParams || funcParams || shortArrowParams || '').split(',').map(param => param.trim()).filter(p => p !== 'sessionId' && p !== 'bus' && p !== '');
            incomingMessages.push({ name, params: params.join(', ') });
        } else {

            if (outgoingMessages.some(event => event.name === name)) {
                continue;
            }
            // This is an emitter (outgoing message)
            outgoingMessages.push({ name });
        }
    }

    return { incomingMessages, outgoingMessages };
}

function shouldGenerateReadme() {
    const readmeIndex = args.indexOf('--readme');
    if (readmeIndex !== -1) {
        args.splice(readmeIndex, 1);
        return true;
    }
    return false;
}

const args = process.argv.slice(2);
let childProcess;
const envFilePattern = /^\.env/;
const envFileHashes = new Map();

async function getEnvFiles() {
    const files = await fs.readdir(process.cwd());
    return files.filter(file => envFilePattern.test(file));
}

async function hashFile(filePath) {
    const content = await fs.readFile(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
}

async function updateEnvFileHashes() {
    const envFiles = await getEnvFiles();
    for (const file of envFiles) {
        const hash = await hashFile(file);
        envFileHashes.set(file, hash);
    }
}

async function hasEnvFileChanged(file) {
    const currentHash = await hashFile(file);
    const previousHash = envFileHashes.get(file);
    return currentHash !== previousHash;
}

async function watchEnvFiles() {
    try {
        const watcher = fs.watch(process.cwd());
        for await (const event of watcher) {
            if (envFilePattern.test(event.filename)) {
                if (await hasEnvFileChanged(event.filename)) {
                    console.log(`${event.filename} changed. Restarting server...`);
                    await updateEnvFileHashes();
                    restartServer();
                }
            }
        }
    } catch (error) {
        console.error('Error watching .env files:', error);
    }
}

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

async function startServer() {
    const envFiles = await getEnvFiles();
    const nodeArgs = [
        ...envFiles.map(file => `--env-file=${file}`),
        path.join(__dirname, 'vertstack.js'),
        ...args
    ];

    if (childProcess) {
        childProcess.kill();
    }

    childProcess = spawn('npx', ['nodemon', '--watch', '.', '--ext', 'js,mjs,html,css', '--', ...nodeArgs], {
        stdio: 'pipe',
        shell: true
    });

    childProcess.stdout.on('data', (data) => {
        process.stdout.write(data);
    });

    childProcess.stderr.on('data', (data) => {
        process.stderr.write(`${RED}${data}${RESET}`);
    });

    childProcess.on('error', (error) => {
        console.error(`${RED}spawn error: ${error}${RESET}`);
    });

    childProcess.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
    });

    process.on('SIGINT', () => {
        childProcess.kill();
        process.exit();
    });
}

function restartServer() {
    if (childProcess) {
        childProcess.kill();
    }
    startServer();
}

async function copyVertStackFile() {
    const sourceFile = path.join(__dirname, 'vertstack.js');
    const destinationFile = path.join(process.cwd(), 'vertstack.js');

    try {
        await fs.copyFile(sourceFile, destinationFile);
        console.log('Copied vertstack.js to current directory');
    } catch (error) {
        console.error('Error copying vertstack.js:', error);
    }
}

async function createOrUpdateScripts() {
    const isWindows = os.platform() === 'win32';
    const serveScript = isWindows ? 'serve.cmd' : 'serve.sh';
    const watchScript = isWindows ? 'watch.cmd' : 'watch.sh';
    const serveDownScript = isWindows ? 'serve-down.cmd' : 'serve-down.sh';

    const serveContent = isWindows
        ? `@echo off
setlocal enabledelayedexpansion

set "ENV_FILES="
for %%F in (.env*) do (
    if "!ENV_FILES!"=="" (
        set "ENV_FILES=--env-file=%%F"
    ) else (
        set "ENV_FILES=!ENV_FILES! --env-file=%%F"
    )
)

echo Starting VertStack server...
start /B "" cmd /c "node %ENV_FILES% vertstack.js ${args.join(' ')} > vertstack.logs 2>&1"
timeout /t 2 > nul
for /f "tokens=2 delims=," %%a in ('tasklist /fi "imagename eq node.exe" /fo csv /nh') do (
    echo %%~a > vertstack.pid
    echo Server started with PID %%~a. Check vertstack.logs for output.
    exit /b
)
echo Failed to start server or retrieve PID.`
        : `#!/bin/sh
ENV_FILES=""
for file in .env*; do
    if [ -f "$file" ]; then
        ENV_FILES="$ENV_FILES --env-file=$file"
    fi
done

nohup node $ENV_FILES vertstack.js ${args.join(' ')} > vertstack.logs 2>&1 &
PID=$!
echo $PID > vertstack.pid
echo "Server started with PID $PID. Check vertstack.logs for output."`;

    const watchContent = isWindows
        ? `@echo off
setlocal enabledelayedexpansion

set "ENV_FILES="
for %%F in (.env*) do (
    if "!ENV_FILES!"=="" (
        set "ENV_FILES=--env-file=%%F"
    ) else (
        set "ENV_FILES=!ENV_FILES! --env-file=%%F"
    )
)

npx nodemon --watch . --ext js,mjs,html,css --exec "node %ENV_FILES% vertstack.js ${args.join(' ')}"`
        : `#!/bin/sh
ENV_FILES=""
for file in .env*; do
    if [ -f "$file" ]; then
        ENV_FILES="$ENV_FILES --env-file=$file"
    fi
done

npx nodemon --watch . --ext js,mjs,html,css --exec "node $ENV_FILES vertstack.js ${args.join(' ')}"`;

    // serveDownContent remains unchanged
    const serveDownContent = isWindows
        ? `@echo off
setlocal enabledelayedexpansion
echo Checking for vertstack.pid file...
if not exist vertstack.pid (
    echo No running server found. vertstack.pid file does not exist.
    exit /b 1
)

echo vertstack.pid file found. Reading content...
set /p PID=<vertstack.pid
echo PID read from file: !PID!

if "!PID!"=="" (
    echo PID file is empty. Unable to stop server.
    del vertstack.pid
    exit /b 1
)

echo Attempting to stop server with PID: !PID!
tasklist /FI "PID eq !PID!" 2>nul | find /I /N "node.exe">nul
if "!ERRORLEVEL!"=="0" (
    echo Attempting to kill process...
    taskkill /F /PID !PID!
    if errorlevel 1 (
        echo Failed to stop server with PID !PID!.
    ) else (
        echo Server with PID !PID! stopped.
    )
) else (
    echo No running server found with PID !PID!.
)

echo Deleting vertstack.pid file...
del vertstack.pid
echo Script execution completed.`
        : `#!/bin/sh
if [ ! -f vertstack.pid ]; then
    echo "No running server found. vertstack.pid file does not exist."
    exit 1
fi

PID=$(cat vertstack.pid)
echo "PID read from file: $PID"

if [ -z "$PID" ]; then
    echo "PID file is empty. Unable to stop server."
    rm vertstack.pid
    exit 1
fi

echo "Attempting to stop server with PID: $PID"
if ps -p $PID > /dev/null 2>&1; then
    kill $PID
    echo "Server with PID $PID stopped."
else
    echo "Process with PID $PID not found. It may have already been stopped."
fi

echo "Deleting vertstack.pid file..."
rm vertstack.pid
echo "Script execution completed."`;

    await fs.writeFile(serveScript, serveContent);
    await fs.writeFile(watchScript, watchContent);
    await fs.writeFile(serveDownScript, serveDownContent);

    if (!isWindows) {
        await fs.chmod(serveScript, '755');
        await fs.chmod(watchScript, '755');
        await fs.chmod(serveDownScript, '755');
    }

    console.log(`Updated ${serveScript}, ${watchScript}, and ${serveDownScript}`);
}

function shouldInstall() {
    const installIndex = args.indexOf('--install');
    if (installIndex !== -1) {
        args.splice(installIndex, 1);
        return true;
    }
    return false;
}


function shouldUseElectron() {
    const electronIndex = args.indexOf('--electron');
    if (electronIndex !== -1) {
        args.splice(electronIndex, 1);
        return true;
    }
    return false;
}

async function installElectronDependencies() {
    console.log('Installing Electron and required dependencies...');
    try {
        execSync('npm install --save-dev electron@latest electron-builder@latest tree-kill@latest', { stdio: 'inherit' });
        console.log('Electron dependencies installed successfully.');
    } catch (error) {
        console.error('Failed to install Electron dependencies:', error);
        process.exit(1);
    }
}


async function createElectronMain() {
    const mainContent = `
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const treeKill = require('tree-kill');

let mainWindow;
let serverProcess;
let serverLogStream;

const portArg = ${JSON.stringify(args)}.find(arg => arg.startsWith('--port='));
const port = portArg ? parseInt(portArg.split('=')[1]) : 3000; // Default to 3456 if not specified

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadURL(\`http://localhost:\${port}\`);

    mainWindow.on('closed', function () {
        mainWindow = null;
        stopServerAndQuit();
    });
}

function startServer() {
    serverLogStream = fs.createWriteStream('server.log', { flags: 'a' });
    
    serverProcess = spawn('npx', ['vertstack', ...${JSON.stringify(args)}], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true
    });

    serverProcess.stdout.pipe(serverLogStream);
    serverProcess.stderr.pipe(serverLogStream);

    serverProcess.stdout.on('data', (data) => {
        console.log(\`Server: \${data}\`);
    });

    serverProcess.stderr.on('data', (data) => {
        console.error(\`Server Error: \${data}\`);
    });
}

function stopServerAndQuit() {
    if (serverProcess) {
        console.log('Stopping server process...');
        return new Promise((resolve) => {
            treeKill(serverProcess.pid, 'SIGKILL', (err) => {
                if (err) {
                    console.error('Failed to kill server process:', err);
                } else {
                    console.log('Server process terminated');
                }
                serverProcess = null;
                if (serverLogStream) {
                    console.log('Closing log stream...');
                    serverLogStream.end();
                    serverLogStream = null;
                }
                resolve();
            });
        }).then(() => {
            console.log('Quitting application...');
            app.quit();
        });
    } else {
        if (serverLogStream) {
            console.log('Closing log stream...');
            serverLogStream.end();
            serverLogStream = null;
        }
        console.log('Quitting application...');
        app.quit();
    }
}

app.on('ready', () => {
    startServer();
    setTimeout(createWindow, 1000); // Give the server a second to start
});

app.on('window-all-closed', stopServerAndQuit);

app.on('will-quit', (event) => {
    if (serverProcess || serverLogStream) {
        event.preventDefault();
        stopServerAndQuit().then(() => {
            app.exit(0);
        });
    }
});

// Ensure the server is stopped if the app crashes or is killed
process.on('exit', stopServerAndQuit);
process.on('SIGINT', stopServerAndQuit);
process.on('SIGTERM', stopServerAndQuit);
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    stopServerAndQuit();
});
`;

    await fs.writeFile('electron-main.js', mainContent);
    console.log('Created electron-main.js with robust process termination');
}

function startElectronApp() {
    console.log('Starting Electron app...');
    try {
        execSync('npx electron .', { stdio: 'inherit' });
    } catch (error) {
        console.error('Failed to start Electron app:', error);
    }
}

async function updatePackageJson() {
    let packageJson;
    try {
        packageJson = JSON.parse(await fs.readFile('package.json', 'utf-8'));
    } catch (error) {
        packageJson = {};
    }

    packageJson.main = 'electron-main.js';
    packageJson.scripts = packageJson.scripts || {};
    packageJson.scripts['start-electron'] = 'electron .';

    await fs.writeFile('package.json', JSON.stringify(packageJson, null, 2));
    console.log('Updated package.json with Electron start script');
}

async function main() {
    if (shouldGenerateReadme()) {
        await generateReadme(args);
    } else if (shouldInstall()) {
        await updateEnvFileHashes();
        await copyVertStackFile();
        await createOrUpdateScripts();
        console.log('Installation completed. Use serve.cmd/sh to start the server.');
    } else if (shouldUseElectron()) {
        await updatePackageJson();
        await installElectronDependencies();
        await createElectronMain();
        startElectronApp();
    } else {
        await updateEnvFileHashes();
        await startServer();
        watchEnvFiles();
    }
}

main();

process.on('SIGTERM', () => {
    if (childProcess) {
        childProcess.kill();
    }
    process.exit(0);
});