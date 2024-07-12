#!/usr/bin/env node

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

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

async function startServer() {
  const envFiles = await getEnvFiles();
  const nodeArgs = [
    ...envFiles.map(file => `--env-file=${file}`),
    path.join(__dirname, 'vertstack.js'),
    ...args
  ];

  childProcess = spawn('node', nodeArgs, {
    stdio: 'inherit'
  });

  childProcess.on('close', (code) => {
    if (code !== null) {
      console.log(`Child process exited with code ${code}`);
    }
  });
}

function restartServer() {
  if (childProcess) {
    childProcess.kill();
  }
  startServer();
}

// Start the server and watch for .env file changes
async function main() {
  await updateEnvFileHashes();
  await startServer();
  watchEnvFiles();
}

main();

// Handle SIGTERM
process.on('SIGTERM', () => {
  if (childProcess) {
    childProcess.kill();
  }
  process.exit(0);
});