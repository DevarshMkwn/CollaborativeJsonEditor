## CLI Client - Quick Guide

This document explains how to run and use the Node.js CLI client located in the `client/cli.js` file.

---

### 1. Prerequisites

- Node.js 16+ installed
- Redis running (via Docker)
- At least one backend instance running

If you haven't started Redis and the backend yet, follow the steps in `READ.md` or `QUICKSTART.md` first.

---

### 2. Install CLI Dependencies

From the project root:

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask\client
npm install
```

This installs the dependencies needed by `cli.js` (WebSocket, Yjs, etc.).

---

### 3. Run CLI in Interactive Mode

From the project root:

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask
node client/cli.js --server ws://localhost:8080 --room room1 --interactive
```

- `--server` – WebSocket URL of your backend instance  
- `--room` – Room ID to join (any string)  
- `--interactive` – Start in interactive REPL mode

Once connected, you can type commands like:

```text
set-title "My Document"
set-content "Hello from CLI"
set-author "John Doe"
show-state
show-stats
help
exit
```

---

### 4. One-Off Commands (Non-Interactive)

You can perform a single action and exit without starting the REPL.

#### Set a field

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask
node client/cli.js --server ws://localhost:8080 --room room1 `
  --action set --field title --value "Project 2026"
```

#### Show current state

```powershell
node client/cli.js --server ws://localhost:8080 --room room1 --action show
```

---

### 5. Example Workflows

#### Multi-user CLI demo

1. Open two terminals.
2. In both, run:

   ```powershell
   cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask
   node client/cli.js --server ws://localhost:8080 --room shared --interactive
   ```

3. Type `set-title "From Terminal 1"` in the first terminal.
4. Observe updates reflected in the second terminal when running `show-state`.

#### Monitor a room periodically (PowerShell)

```powershell
while ($true) {
  node client/cli.js --server ws://localhost:8080 --room room1 --action show
  Start-Sleep -Seconds 2
}
```

---

### 6. Helpful References

For more detailed CLI documentation and examples, see:

- `CLI_GUIDE.md` – Full CLI documentation
- `CLI_QUICK_REFERENCE.md` – Command quick reference
- `CLI_EXAMPLES.sh` / `scripts/CLI_EXAMPLES.bat` – Ready-made usage scripts

