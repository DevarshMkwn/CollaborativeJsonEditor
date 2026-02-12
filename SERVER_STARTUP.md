## Backend Server Startup Guide

This guide shows how to start the **backend server** (WebSocket service) for this project.

---

### 1. Prerequisites

- Node.js 16+ installed
- Docker + Docker Compose installed

---

### 2. Start Redis (required)

Open **PowerShell** and run:

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask\backend
docker-compose up -d redis
```

Verify Redis is running:

```powershell
docker ps
```

You should see a container like `videosdk-collab-redis`.

---

### 3. Install backend dependencies (first time only)

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask\backend
npm install
```

---

### 4. Start the server (development)

#### Option A – Two instances (multi-instance demo)

**Instance 1** (first PowerShell window):

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask\backend
npm run dev:instance1
```

**Instance 2** (second PowerShell window):

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask\backend
npm run dev:instance2
```

Now you have:

- Instance 1 WebSocket server on port `8082` (see `package.json`)
- Instance 2 WebSocket server on port `8081`

Both share the same Redis instance for synchronization.

---

### 5. Start the server (production build)

If you want to run the compiled JavaScript instead of `ts-node`:

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask\backend
npm run build          # compile TypeScript to dist/
npm start              # runs node dist/index.js
```

You can control ports and other settings via environment variables or a `.env` file, for example:

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask\backend
$env:PORT="8080"
$env:METRICS_PORT="9090"
npm start
```

---

### 6. Stopping the server and Redis

- To stop a backend instance: press `Ctrl + C` in that PowerShell window.
- To stop Redis:

```powershell
cd c:\Users\devar\OneDrive\Desktop\VideoSdkTask\backend
docker-compose down
```

