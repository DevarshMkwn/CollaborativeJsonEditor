## Project Startup (Backend + Web Client)

### 1. Install dependencies (first time only)

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask\backend
npm install
```

### 2. Start Redis (Docker)

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask\backend
docker-compose up -d redis
```

Verify:

```powershell
docker ps  # should show videosdk-collab-redis
```

### 3. Run backend instances (development)

#### Instance 1

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask\backend
$env:PORT="8080"; $env:METRICS_PORT="9090"; npm run dev
```

Or use the predefined script (ports may differ, see package.json):

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask\backend
npm run dev:instance1
```

#### Instance 2 (optional, new terminal)

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask\backend
npm run dev:instance2
```

## CLI Startup (Node CLI Client)

### 1. Install CLI dependencies (first time only)

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask\client
npm install
```

> Make sure Redis and at least one backend instance are already running (see steps above).

### 2. Run CLI in interactive mode

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask
node client/cli.js --server ws://localhost:8080 --room room1 --interactive
```

Then you can run commands such as:

```text
set-title "My Document"
set-content "Hello from CLI"
show-state
show-stats
exit
```

### 3. One-off CLI command example

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask
node client/cli.js --server ws://localhost:8080 --room room1 `
  --action set --field title --value "Project 2026"
```
