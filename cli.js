#!/usr/bin/env node
const { exec } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const os = require('node:os');

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

    const command = `nodemon --watch . --ext js,mjs -- ${nodeArgs.join(' ')}`;

    const childProcess = exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`${RED}exec error: ${error}${RESET}`);
            return;
        }
        if (stderr) {
            console.error(`${RED}${stderr}${RESET}`);
        }
    });

    childProcess.stdout.on('data', (data) => {
        process.stdout.write(data);
    });

    childProcess.stderr.on('data', (data) => {
        process.stderr.write(`${RED}${data}${RESET}`);
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

nodemon --watch . --ext js,mjs --exec "node %ENV_FILES% vertstack.js ${args.join(' ')}"`
        : `#!/bin/sh
ENV_FILES=""
for file in .env*; do
    if [ -f "$file" ]; then
        ENV_FILES="$ENV_FILES --env-file=$file"
    fi
done

nodemon --watch . --ext js,mjs --exec "node $ENV_FILES vertstack.js ${args.join(' ')}"`;

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

async function main() {
    if (shouldInstall()) {
        await updateEnvFileHashes();
        await copyVertStackFile();
        await createOrUpdateScripts();
        console.log('Installation completed. Use serve.cmd/sh to start the server.');
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