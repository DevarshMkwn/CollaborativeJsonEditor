#!/usr/bin/env node

/**
 * Collaborative Document Editor - CLI Client
 * Real-time synchronization with CRDT backend
 * Usage: node cli.js --server <url> --room <roomId> [--action <action>] [--field <field>] [--value <value>]
 */

const WebSocket = require('ws');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const Y = require('yjs');

/**
 * Base64 encoding/decoding utilities
 */
const Base64Utils = {
    encode(str) {
        return Buffer.from(str).toString('base64');
    },
    
    decode(b64str) {
        return Buffer.from(b64str, 'base64').toString('utf-8');
    },
    
    stringify(obj) {
        return JSON.stringify(obj);
    }
};

/**
 * Yjs-based State Manager for CLI mode with proper CRDT support
 */
class YjsStateManager {
    constructor() {
        this.doc = new Y.Doc();
        this.ystate = this.doc.getMap('state');
        this.ystate.set('title', '');
        this.ystate.set('content', '');
        this.ystate.set('author', '');
        this.updateListeners = [];
        this.stateObservers = [];
        this.lastState = null;
        console.log('✓ YjsStateManager created with Yjs');
    }

    getMap(name) {
        return this.ystate;
    }

    setState(updates) {
        try {
            this.doc.transact(() => {
                for (const [key, value] of Object.entries(updates)) {
                    this.ystate.set(key, value);
                }
            });
            
            this.stateObservers.forEach(callback => {
                callback({
                    keysChanged: Object.keys(updates)
                });
            });
        } catch (error) {
            console.error('Error updating state:', error);
        }
    }

    on(event, callback) {
        if (event === 'update') {
            this.updateListeners.push(callback);
        }
    }

    applyUpdate(update) {
        try {
            Y.applyUpdate(this.doc, update);
        } catch (error) {
            console.error('Error applying update:', error);
        }
    }

    // Get the state as a plain object
    getState() {
        return this.ystate.toJSON();
    }

    // Encode current state as Yjs binary update
    encodeState() {
        return Y.encodeStateAsUpdate(this.doc);
    }
}

/**
 * CLI Collaborative Client
 */
class CollaborativeCLIClient {
    constructor(serverUrl, roomId) {
        this.serverUrl = serverUrl;
        this.roomId = roomId;
        this.ws = null;
        this.clientId = null;
        this.isConnected = false;
        this.updatesSent = 0;
        this.updatesReceived = 0;
        this.lastUpdateTime = null;
        this.connectionStartTime = null;

        // State management
        this.ydoc = new YjsStateManager();
        this.ystate = this.ydoc.getMap('state');
        this.useYjs = true; // Now using Yjs with proper CRDT support
        this.lastEncodeState = this.ydoc.encodeState();
        this.hasReceivedInitialState = false;
        this.messageQueue = [];
        this.isApplyingRemoteUpdate = false;

        // Interactive mode
        this.rl = null;
        this.isInteractive = false;
        this.commandMode = false;
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = {
            'info': '[ℹ️  INFO]',
            'success': '[✓ SUCCESS]',
            'error': '[✗ ERROR]',
            'warning': '[⚠️  WARNING]',
            'debug': '[🔍 DEBUG]'
        }[type] || '[LOG]';

        console.log(`${timestamp} ${prefix} ${message}`);
    }

    async connect() {
        try {
            this.log(`Connecting to ${this.serverUrl}...`, 'info');
            
            return new Promise((resolve, reject) => {
                this.ws = new WebSocket(this.serverUrl);

                this.ws.on('open', () => {
                    this.onOpen();
                    resolve();
                });

                this.ws.on('message', (data) => this.onMessage(data));
                this.ws.on('error', (error) => {
                    this.onError(error);
                    reject(error);
                });
                this.ws.on('close', () => this.onClose());

                // Timeout after 10 seconds
                setTimeout(() => {
                    if (!this.isConnected) {
                        reject(new Error('Connection timeout'));
                    }
                }, 10000);
            });
        } catch (error) {
            this.log(`Connection failed: ${error.message}`, 'error');
            throw error;
        }
    }

    onOpen() {
        this.isConnected = true;
        this.connectionStartTime = Date.now();
        this.log('Connected to WebSocket server', 'success');

        // Reset initial state flag
        this.hasReceivedInitialState = false;

        // Send JOIN_ROOM message
        const joinMessage = {
            type: 'join-room',
            roomId: this.roomId,
            timestamp: Date.now()
        };

        this.log(`Joining room: ${this.roomId}`, 'info');
        this.ws.send(JSON.stringify(joinMessage));
    }

    onMessage(data) {
        try {
            const message = JSON.parse(data);
            this.handleMessage(message);
        } catch (error) {
            this.log(`Failed to parse message: ${error.message}`, 'error');
        }
    }

    handleMessage(message) {
        switch (message.type) {
            case 'document-state':
                this.applyDocumentState(message);
                break;
            case 'document-update':
                this.handleDocumentUpdate(message);
                break;
            case 'ack':
                this.handleAck(message);
                break;
            case 'error':
                this.handleError(message);
                break;
            default:
                this.log(`Unknown message type: ${message.type}`, 'warning');
        }
    }

    applyDocumentState(message) {
        try {
            const stateData = message.payload.state;
            
            if (!this.ydoc) {
                this.log('State manager not initialized', 'error');
                return;
            }

            // First try to apply as Yjs binary update
            try {
                const stateBuffer = Buffer.from(stateData, 'base64');
                this.isApplyingRemoteUpdate = true;
                this.ydoc.applyUpdate(stateBuffer);
                this.isApplyingRemoteUpdate = false;
                this.lastEncodeState = this.ydoc.encodeState();
                
                this.log('Received initial Yjs document state', 'success');
                this.log(`State: ${JSON.stringify(this.ydoc.getState(), null, 2)}`, 'debug');
            } catch (updateError) {
                // Fallback - try as JSON
                try {
                    const jsonStr = Base64Utils.decode(stateData);
                    const stateObj = JSON.parse(jsonStr);
                    
                    this.isApplyingRemoteUpdate = true;
                    this.ydoc.setState(stateObj);
                    this.isApplyingRemoteUpdate = false;
                    
                    this.log('Received initial document state (JSON fallback)', 'success');
                    this.log(`State: ${JSON.stringify(this.ydoc.getState(), null, 2)}`, 'debug');
                } catch (parseError) {
                    this.log(`Could not parse state: ${parseError.message}`, 'warning');
                }
            }

            this.hasReceivedInitialState = true;
        } catch (error) {
            this.log(`Failed to apply document state: ${error.message}`, 'error');
        }
    }

    handleDocumentUpdate(message) {
        try {
            const { clientId, payload } = message;
            
            if (payload && payload.update) {
                if (this.ydoc) {
                    try {
                        // Try to apply as Yjs binary update first
                        const updateBuffer = Buffer.from(payload.update, 'base64');
                        
                        try {
                            this.isApplyingRemoteUpdate = true;
                            this.ydoc.applyUpdate(updateBuffer);
                            this.isApplyingRemoteUpdate = false;
                            this.lastEncodeState = this.ydoc.encodeState();
                            
                            if (clientId !== this.clientId) {
                                this.updatesReceived++;
                                this.lastUpdateTime = new Date();
                                this.log(`Received Yjs binary update from ${clientId}:`, 'success');
                                this.displayState();
                            }
                        } catch (yjsError) {
                            // Fallback - try as JSON
                            const jsonStr = Base64Utils.decode(payload.update);
                            const updateObj = JSON.parse(jsonStr);
                            
                            this.isApplyingRemoteUpdate = true;
                            this.ydoc.setState(updateObj);
                            this.isApplyingRemoteUpdate = false;
                            
                            if (clientId !== this.clientId) {
                                this.updatesReceived++;
                                this.lastUpdateTime = new Date();
                                this.log(`Received update from ${clientId} (JSON fallback):`, 'success');
                                this.displayState();
                            }
                        }
                    } catch (parseError) {
                        this.log(`Could not parse update: ${parseError.message}`, 'warning');
                    }
                }
            }
        } catch (error) {
            this.log(`Failed to handle document update: ${error.message}`, 'error');
        }
    }

    handleAck(message) {
        const { payload } = message;
        if (payload && payload.clientJoined) {
            this.clientId = payload.clientJoined;
            this.log(`${payload.message}`, 'success');
            this.log(`Your Client ID: ${this.clientId}`, 'info');
        } else if (payload && payload.clientLeft) {
            this.log(`${payload.message}`, 'info');
        } else {
            this.log(`${payload?.message || 'Server acknowledged'}`, 'info');
        }
    }

    handleError(message) {
        const { payload } = message;
        this.log(`Server error: ${payload.error}`, 'error');
    }

    sendUpdate(field, value) {
        if (!this.isConnected) {
            this.log('Not connected to server', 'error');
            return false;
        }

        if (!this.hasReceivedInitialState) {
            this.log('Initial state not received yet. Please wait.', 'warning');
            return false;
        }

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.log('WebSocket not open', 'error');
            return false;
        }

        try {
            // Update local state
            this.ydoc.setState({ [field]: value });

            // Get Yjs binary update
            const currentState = this.ydoc.encodeState();
            // Create update from the difference between last state and current state
            // For simplicity, we send the last encoded state as "previous" and current as the update
            const updateBuffer = currentState;
            
            const message = {
                type: 'document-update',
                roomId: this.roomId,
                clientId: this.clientId,
                payload: {
                    update: Buffer.from(updateBuffer).toString('base64'),
                    clientId: this.clientId,
                    timestamp: Date.now(),
                },
                timestamp: Date.now(),
            };

            this.ws.send(JSON.stringify(message));
            this.updatesSent++;
            this.lastEncodeState = currentState;
            this.log(`✓ Sent Yjs binary update: ${field} = "${value}"`, 'success');
            return true;
        } catch (error) {
            this.log(`Failed to send update: ${error.message}`, 'error');
            return false;
        }
    }

    sendFullJson(jsonData) {
        if (!this.isConnected) {
            this.log('Not connected to server', 'error');
            return false;
        }

        if (!this.hasReceivedInitialState) {
            this.log('Initial state not received yet. Please wait.', 'warning');
            return false;
        }

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.log('WebSocket not open', 'error');
            return false;
        }

        try {
            // Merge the provided JSON with the current state
            const mergedState = { ...this.ydoc.getState(), ...jsonData };
            this.ydoc.setState(mergedState);

            // Get Yjs binary update
            const currentState = this.ydoc.encodeState();
            const updateBuffer = currentState;
            
            const message = {
                type: 'document-update',
                roomId: this.roomId,
                clientId: this.clientId,
                payload: {
                    update: Buffer.from(updateBuffer).toString('base64'),
                    clientId: this.clientId,
                    timestamp: Date.now(),
                },
                timestamp: Date.now(),
            };

            this.ws.send(JSON.stringify(message));
            this.updatesSent++;
            this.lastEncodeState = currentState;
            this.log(`✓ Sent full JSON update:`, 'success');
            this.log(JSON.stringify(jsonData, null, 2), 'debug');
            return true;
        } catch (error) {
            this.log(`Failed to send JSON update: ${error.message}`, 'error');
            return false;
        }
    }

    displayState() {
        const state = this.ydoc.getState();
        console.log('\n' + '='.repeat(60));
        console.log('📄 Current Document State:');
        console.log('='.repeat(60));
        
        if (Object.keys(state).length === 0) {
            console.log('(empty state)');
        } else {
            for (const [key, value] of Object.entries(state)) {
                const displayValue = typeof value === 'object' 
                    ? JSON.stringify(value) 
                    : value || '(empty)';
                const keyLabel = key.charAt(0).toUpperCase() + key.slice(1);
                console.log(`${keyLabel.padEnd(12)}: "${displayValue}"`);
            }
        }
        console.log('='.repeat(60) + '\n');
    }

    displayFullJson() {
        const state = this.ydoc.getState();
        console.log('\n' + '='.repeat(60));
        console.log('📦 Full JSON State:');
        console.log('='.repeat(60));
        console.log(JSON.stringify(state, null, 2));
        console.log('='.repeat(60) + '\n');
    }

    displayStats() {
        const uptime = this.connectionStartTime 
            ? Math.floor((Date.now() - this.connectionStartTime) / 1000)
            : 0;
        const minutes = Math.floor(uptime / 60);
        const seconds = uptime % 60;

        console.log('\n' + '='.repeat(60));
        console.log('📊 Connection Statistics:');
        console.log('='.repeat(60));
        console.log(`Status:        ${this.isConnected ? '✓ Connected' : '✗ Disconnected'}`);
        console.log(`Client ID:     ${this.clientId || 'Not assigned'}`);
        console.log(`Room ID:       ${this.roomId}`);
        console.log(`Updates Sent:  ${this.updatesSent}`);
        console.log(`Updates Recv:  ${this.updatesReceived}`);
        console.log(`Total Updates: ${this.updatesSent + this.updatesReceived}`);
        console.log(`Uptime:        ${minutes}m ${seconds}s`);
        if (this.lastUpdateTime) {
            console.log(`Last Update:   ${this.lastUpdateTime.toLocaleTimeString()}`);
        }
        console.log('='.repeat(60) + '\n');
    }

    displayHelp() {
        console.log('\n' + '='.repeat(60));
        console.log('📋 Available Commands:');
        console.log('='.repeat(60));
        console.log('  set-title <text>     - Set the document title');
        console.log('  set-content <text>   - Set the document content');
        console.log('  set-author <name>    - Set the document author');
        console.log('  show-state           - Display current document state');
        console.log('  show-json            - Display full JSON state');
        console.log('  send-json <json>     - Send full JSON data to backend');
        console.log('  show-stats           - Display connection statistics');
        console.log('  help                 - Show this help message');
        console.log('  exit                 - Exit the CLI client');
        console.log('='.repeat(60) + '\n');
    }

    startInteractiveMode() {
        this.isInteractive = true;
        this.commandMode = true;

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('\n');
        this.log('Entering interactive mode. Type "help" for available commands.', 'info');
        this.displayHelp();

        this.promptCommand();
    }

    promptCommand() {
        if (!this.rl) return;

        this.rl.question('cli> ', (input) => {
            const trimmed = input.trim();
            
            if (!trimmed) {
                this.promptCommand();
                return;
            }

            this.handleCommand(trimmed);
            this.promptCommand();
        });
    }

    handleCommand(command) {
        const parts = command.split(' ');
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');

        switch (cmd) {
            case 'set-title':
                this.sendUpdate('title', args);
                break;
            case 'set-content':
                this.sendUpdate('content', args);
                break;
            case 'set-author':
                this.sendUpdate('author', args);
                break;
            case 'show-state':
                this.displayState();
                break;
            case 'show-json':
                this.displayFullJson();
                break;
            case 'send-json':
                try {
                    const jsonData = JSON.parse(args);
                    this.sendFullJson(jsonData);
                } catch (parseError) {
                    this.log(`Invalid JSON: ${parseError.message}`, 'error');
                }
                break;
            case 'show-stats':
                this.displayStats();
                break;
            case 'help':
                this.displayHelp();
                break;
            case 'exit':
                this.log('Disconnecting...', 'info');
                this.disconnect();
                process.exit(0);
                break;
            default:
                this.log(`Unknown command: ${cmd}. Type "help" for available commands.`, 'warning');
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
        if (this.rl) {
            this.rl.close();
        }
    }

    onClose() {
        this.isConnected = false;
        this.log('Disconnected from server', 'warning');
    }

    onError(error) {
        this.log(`WebSocket error: ${error.message}`, 'error');
    }
}

/**
 * Parse command-line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        server: null,
        room: null,
        action: null,
        field: null,
        value: null,
        data: null,
        interactive: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '--server' && i + 1 < args.length) {
            options.server = args[++i];
        } else if (arg === '--room' && i + 1 < args.length) {
            options.room = args[++i];
        } else if (arg === '--action' && i + 1 < args.length) {
            options.action = args[++i];
        } else if (arg === '--field' && i + 1 < args.length) {
            options.field = args[++i];
        } else if (arg === '--value' && i + 1 < args.length) {
            options.value = args[++i];
        } else if (arg === '--data' && i + 1 < args.length) {
            options.data = args[++i];
        } else if (arg === '--interactive' || arg === '-i') {
            options.interactive = true;
        } else if (arg === '--help' || arg === '-h') {
            showUsage();
            process.exit(0);
        }
    }

    return options;
}

function showUsage() {
    console.log(`
Collaborative Document Editor - CLI Client

Usage:
  node cli.js --server <url> --room <roomId> [options]

Options:
  --server <url>          WebSocket server URL (required)
  --room <roomId>         Room ID to join (required)
  --action <action>       Action to perform: 'set', 'show', 'show-json', 'send-json'
  --field <field>         Field to set: 'title', 'content', 'author'
  --value <text>          Value to set (use with --action set)
  --data <json>           JSON data to send (use with --action send-json)
  --interactive, -i       Start in interactive mode
  --help, -h              Show this help message

Examples:
  # Interactive mode
  node cli.js --server ws://localhost:8080 --room room1 --interactive

  # Set title and exit
  node cli.js --server ws://localhost:8080 --room room1 \\
    --action set --field title --value "My Document"

  # Show current state (3 fields)
  node cli.js --server ws://localhost:8080 --room room1 --action show

  # Show full JSON state
  node cli.js --server ws://localhost:8080 --room room1 --action show-json

  # Send full JSON data to backend
  node cli.js --server ws://localhost:8080 --room room1 \\
    --action send-json --data '{"title": "New Title", "content": "New Content", "author": "John"}'
    `);
}

/**
 * Main entry point
 */
async function main() {
    const options = parseArgs();

    // Validate required options
    if (!options.server || !options.room) {
        console.error('Error: --server and --room are required');
        console.error('Use --help for usage information');
        process.exit(1);
    }

    try {
        const client = new CollaborativeCLIClient(options.server, options.room);
        
        console.log('\n' + '='.repeat(60));
        console.log('🚀 Collaborative Document Editor - CLI Client');
        console.log('='.repeat(60));
        console.log(`Server: ${options.server}`);
        console.log(`Room:   ${options.room}`);
        console.log('='.repeat(60) + '\n');

        // Connect to server
        await client.connect();

        // Give a moment for initial state to arrive
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Handle action mode
        if (options.action === 'set' && options.field && options.value) {
            client.log(`Setting ${options.field} to "${options.value}"`, 'info');
            client.sendUpdate(options.field, options.value);
            
            // Wait for update to be processed
            await new Promise(resolve => setTimeout(resolve, 500));
            client.displayState();
            client.displayStats();
            client.disconnect();
            process.exit(0);
        } else if (options.action === 'show') {
            client.displayState();
            client.displayStats();
            client.disconnect();
            process.exit(0);
        } else if (options.action === 'show-json') {
            client.displayFullJson();
            client.displayStats();
            client.disconnect();
            process.exit(0);
        } else if (options.action === 'send-json') {
            if (!options.data) {
                console.error('Error: --data is required for send-json action');
                console.error('Use --help for usage information');
                process.exit(1);
            }
            try {
                const jsonData = JSON.parse(options.data);
                client.log('Sending full JSON data to backend', 'info');
                client.sendFullJson(jsonData);
                
                // Wait for update to be processed
                await new Promise(resolve => setTimeout(resolve, 500));
                client.displayFullJson();
                client.displayStats();
                client.disconnect();
                process.exit(0);
            } catch (parseError) {
                console.error(`Error: Invalid JSON data - ${parseError.message}`);
                process.exit(1);
            }
        } else if (options.interactive) {
            // Interactive mode
            client.startInteractiveMode();
        } else {
            // Default: show state and exit
            client.displayState();
            client.displayStats();
            client.disconnect();
            process.exit(0);
        }

    } catch (error) {
        console.error(`Fatal error: ${error.message}`);
        process.exit(1);
    }
}

// Run the client
if (require.main === module) {
    main().catch(error => {
        console.error(`Unexpected error: ${error.message}`);
        process.exit(1);
    });
}

module.exports = { CollaborativeCLIClient, Base64Utils, YjsStateManager };
