# Duneli — HTTPS & Deployment Guide
*Generated: 2026-03-20*

---

## Your 3 options (pick one)

### Option A — Railway (easiest, recommended for beginners)
Deploy in 5 minutes, HTTPS automatic, free tier available.

### Option B — Render
Similar to Railway, also free tier, HTTPS automatic.

### Option C — Self-hosted with Nginx + Let's Encrypt
You run your own server (VPS like DigitalOcean/Hetzner). More control, more work.

---

## Option A — Deploy to Railway (recommended)

**Step 1: Install Railway CLI**
```powershell
npm install -g @railway/cli
```

**Step 2: Login**
```powershell
railway login
```

**Step 3: Initialize project (run from your duneli database folder)**
```powershell
cd "C:\Users\SIMRAN\OneDrive\Desktop\iuXoa\Duneli\duneli database"
railway init
```

**Step 4: Add a PostgreSQL database on Railway**
- Go to https://railway.app → your project → New Service → Database → PostgreSQL
- Railway gives you a DATABASE_URL automatically

**Step 5: Set environment variables on Railway**
In Railway dashboard → your project → Variables, add:
```
NODE_ENV=production
SESSION_SECRET=b3ecdff478dd9723481db0b61b5553d642ace93d76a55d653289e8b7ddac0b675b487d3075656f6562f3e6d98039eff1
DATABASE_URL=(use the one Railway generates for you — NOT your local one)
```

**Step 6: Deploy**
```powershell
railway up
```

Railway automatically:
- Gives you an HTTPS URL (e.g. https://duneli-production.up.railway.app)
- Handles SSL certificate renewal
- Restarts your app if it crashes

---

## Option B — Deploy to Render

**Step 1:** Go to https://render.com → New → Web Service

**Step 2:** Connect your GitHub repo (push your code to GitHub first)

**Step 3:** Set build command:
```
npm install && npx prisma generate && npx prisma migrate deploy
```

**Step 4:** Set start command:
```
npm start
```

**Step 5:** Add environment variables in Render dashboard (same as Railway above)

Render automatically handles HTTPS.

---

## Option C — Self-hosted Nginx + Let's Encrypt

Use this if you have a VPS (DigitalOcean, Hetzner, Linode etc.)

### Prerequisites
- Ubuntu 22.04 VPS
- Domain name pointing to your VPS IP (e.g. duneli.yourdomain.com)

### Step 1: Install Nginx and Certbot on your VPS
```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx -y
```

### Step 2: Create Nginx config
```bash
sudo nano /etc/nginx/sites-available/duneli
```

Paste this (replace duneli.yourdomain.com with your real domain):
```nginx
server {
    listen 80;
    server_name duneli.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Step 3: Enable the site
```bash
sudo ln -s /etc/nginx/sites-available/duneli /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 4: Get SSL certificate (free, auto-renews)
```bash
sudo certbot --nginx -d duneli.yourdomain.com
```

Certbot will automatically edit your Nginx config to add HTTPS.

### Step 5: Run your app with PM2 (keeps it alive after reboot)
```bash
npm install -g pm2
pm2 start npm --name "duneli" -- start
pm2 startup
pm2 save
```

---

## What HTTPS protects

Without HTTPS:
- Session tokens travel in plain text over the network
- Anyone on the same WiFi can steal tokens (man-in-the-middle)
- Passwords visible in transit

With HTTPS:
- Everything encrypted end-to-end
- Browsers show the padlock
- Required for cookies with Secure flag

---

## Checklist before going live

- [ ] Run `npx prisma migrate deploy` on production DB
- [ ] Set NODE_ENV=production in production environment
- [ ] SESSION_SECRET set (never use the dev one in production — generate a new one)
- [ ] DATABASE_URL points to production DB (not localhost)
- [ ] HTTPS enabled
- [ ] Backup script scheduled on production server
- [ ] postgres superuser password changed from default
