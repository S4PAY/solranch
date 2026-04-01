# SOL RANCH - Backend

## Quick Setup (Contabo VPS)

### 1. Prerequisites
```bash
# Install Node 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Create database
sudo -u postgres psql -c "CREATE DATABASE solranch;"
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'your_password_here';"
```

### 2. Upload & Install
```bash
# From Windows PowerShell:
scp sol-ranch-backend.zip root@YOUR_VPS_IP:/opt/
# On VPS:
cd /opt && unzip sol-ranch-backend.zip
cd sol-ranch/backend
npm install
```

### 3. Configure Environment
```bash
cp .env.example .env
nano .env
# Fill in:
#   DATABASE_URL
#   RANCH_TOKEN_MINT (after Pump.fun launch)
#   HELIUS_API_KEY (sign up at helius.dev - free tier = 100k credits/day)
#   REWARDS_WALLET_PRIVATE_KEY
#   FRONTEND_URL
```

### 4. Initialize Database
```bash
npm run db:init
```

### 5. Run
```bash
# Development
npm run dev

# Production (use PM2)
npm install -g pm2
pm2 start src/index.js --name sol-ranch
pm2 save
pm2 startup
```

### 6. Nginx Reverse Proxy
```nginx
server {
    listen 80;
    server_name api.solranch.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```
Then: `sudo certbot --nginx -d api.solranch.com`

### 7. Helius Webhook Setup
1. Go to https://dev.helius.xyz/webhooks
2. Create webhook pointing to `https://api.solranch.com/api/webhooks/helius`
3. Set transaction type: TOKEN_TRANSFER
4. Filter by RANCH_TOKEN_MINT address
5. Copy the webhook secret to .env

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/ranchers/register | Register wallet (+ referral code) |
| GET | /api/ranchers/:wallet | Get rancher profile |
| GET | /api/ranchers/:wallet/stats | Full stats + today's points |
| POST | /api/points/checkin | Daily check-in ("Feed Cattle") |
| POST | /api/points/social | Submit social share ("Repair Fences") |
| GET | /api/leaderboard?period=today\|week\|alltime | Leaderboard |
| GET | /api/rewards/pool | Current reward pool status |
| GET | /api/rewards/:wallet | Payout history |
| GET | /api/rodeo/active | Active rodeo events |
| POST | /api/rodeo/enter | Enter a rodeo event |
| GET | /api/health | Health check |

## Cron Jobs (auto-run via node-cron)
- **00:00 UTC** - Daily token balance snapshot (hold points)
- **00:30 UTC** - Daily reward distribution

## Architecture
```
Frontend (React) → API (Express:3001) → PostgreSQL
                                      → Solana RPC (balance checks)
                                      → Helius (webhooks for buy detection)
```
