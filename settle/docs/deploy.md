# Deployment Guide - Settle P2P Crypto Settlement App

**Version**: 1.0
**Last Updated**: 2024-01-16

---

## 1. Prerequisites

### Infrastructure Requirements
- **Node.js**: v18+ (v20 LTS recommended)
- **PostgreSQL**: v14+ (v16 recommended)
- **Memory**: Minimum 2GB RAM
- **Storage**: Minimum 20GB SSD

### Environment Setup
- Domain name with SSL certificate
- Email service (for notifications - optional)
- Monitoring service (Datadog, New Relic, etc. - recommended)

---

## 2. Database Setup

### Create Database
```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE settle_prod;

# Create application user (replace with strong password)
CREATE USER settle_app WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE settle_prod TO settle_app;

# Connect to the new database
\c settle_prod

# Grant schema permissions
GRANT ALL ON SCHEMA public TO settle_app;
```

### Apply Schema
```bash
# Apply main schema
psql -U settle_app -d settle_prod -f database/schema.sql

# Apply constraints migration
psql -U settle_app -d settle_prod -f database/migrations/001_add_constraints.sql
```

### Verify Schema
```bash
psql -U settle_app -d settle_prod -c "\dt"
```

Expected tables:
- users
- merchants
- merchant_offers
- orders
- order_events
- chat_messages
- user_bank_accounts
- reviews
- disputes

---

## 3. Environment Configuration

### Required Environment Variables

Create `.env.production` file:

```bash
# Database
DATABASE_URL=postgresql://settle_app:your_secure_password@localhost:5432/settle_prod
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# Application
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://your-domain.com

# Security (generate strong random strings)
SESSION_SECRET=your_session_secret_here

# Logging
LOG_LEVEL=info

# Optional: External Services
# SMTP_HOST=smtp.sendgrid.net
# SMTP_PORT=587
# SMTP_USER=apikey
# SMTP_PASS=your_sendgrid_api_key
```

### Security Checklist
- [ ] Generate cryptographically secure secrets
- [ ] Use environment-specific database credentials
- [ ] Ensure DATABASE_URL is not exposed in logs
- [ ] Set appropriate CORS origins if needed

---

## 4. Build & Deploy

### Build Application
```bash
# Install dependencies
npm ci --production=false

# Run type check
npm run typecheck

# Run tests
npm test

# Build for production
npm run build
```

### Deploy Options

#### Option A: Docker (Recommended)

Create `Dockerfile`:
```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production=false

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t settle-app .
docker run -p 3000:3000 --env-file .env.production settle-app
```

#### Option B: PM2 (Process Manager)

```bash
# Install PM2 globally
npm install -g pm2

# Start application
pm2 start npm --name "settle-app" -- start

# Save process list
pm2 save

# Setup startup script
pm2 startup
```

#### Option C: Systemd Service

Create `/etc/systemd/system/settle.service`:
```ini
[Unit]
Description=Settle P2P App
After=network.target postgresql.service

[Service]
Type=simple
User=settle
WorkingDirectory=/opt/settle
ExecStart=/usr/bin/npm start
Restart=on-failure
EnvironmentFile=/opt/settle/.env.production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable settle
sudo systemctl start settle
```

---

## 5. Nginx Configuration

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
        # ... same proxy settings
    }
}
```

---

## 6. Database Maintenance

### Backup Strategy
```bash
# Daily backup script
#!/bin/bash
DATE=$(date +%Y%m%d)
pg_dump -U settle_app settle_prod | gzip > /backups/settle_$DATE.sql.gz

# Keep last 30 days
find /backups -name "settle_*.sql.gz" -mtime +30 -delete
```

### Vacuum & Analyze
```bash
# Add to crontab for weekly maintenance
0 3 * * 0 psql -U settle_app -d settle_prod -c "VACUUM ANALYZE;"
```

### Index Maintenance
```bash
# Rebuild indexes if needed (during low traffic)
psql -U settle_app -d settle_prod -c "REINDEX DATABASE settle_prod;"
```

---

## 7. Monitoring

### Health Check Endpoint
The app exposes `/api/health` for monitoring:
```bash
curl https://your-domain.com/api/health
# Expected: {"status":"ok","timestamp":"..."}
```

### Key Metrics to Monitor
- **Response times**: p50, p95, p99 latency
- **Error rates**: 4xx and 5xx responses
- **Database connections**: Pool usage
- **Order metrics**: Creation rate, completion rate
- **Dispute rate**: Monitor for anomalies

### Log Aggregation
Logs are output in JSON format in production. Configure log shipping to your preferred service:
- Datadog
- Papertrail
- CloudWatch
- ELK Stack

---

## 8. Security Hardening

### Application Level
- [x] Input validation with Zod schemas
- [x] SQL parameterized queries (no injection)
- [x] XSS prevention in chat messages
- [x] Authorization checks on all endpoints
- [x] State machine prevents invalid transitions

### Infrastructure Level
- [ ] Enable PostgreSQL SSL connections
- [ ] Firewall: Only allow 443, 22 from trusted IPs
- [ ] Fail2ban for brute force protection
- [ ] Regular security updates

### Database Level
```sql
-- Restrict direct table access, use application user
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO settle_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO settle_app;
```

---

## 9. Rollback Procedure

### Application Rollback
```bash
# If using Docker
docker pull settle-app:previous-tag
docker stop settle-app
docker run -p 3000:3000 --env-file .env.production settle-app:previous-tag

# If using PM2
pm2 stop settle-app
cd /opt/settle-previous
pm2 start npm --name "settle-app" -- start
```

### Database Rollback
```bash
# Restore from backup
pg_restore -U settle_app -d settle_prod -c /backups/settle_YYYYMMDD.sql.gz
```

---

## 10. Troubleshooting

### Common Issues

**Database connection refused**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check connection
psql -U settle_app -d settle_prod -c "SELECT 1;"
```

**App won't start**
```bash
# Check logs
pm2 logs settle-app
# or
journalctl -u settle -f
```

**High memory usage**
- Check for memory leaks in logs
- Restart application
- Consider increasing Node.js memory limit: `NODE_OPTIONS="--max-old-space-size=2048"`

**Slow queries**
```sql
-- Find slow queries
SELECT query, calls, mean_time, total_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

---

## 11. Support

For deployment issues:
1. Check application logs
2. Review this guide
3. File issue at: https://github.com/your-org/settle/issues

---

## Appendix: Quick Start Checklist

- [ ] PostgreSQL installed and configured
- [ ] Database created and schema applied
- [ ] Environment variables configured
- [ ] SSL certificate obtained
- [ ] Nginx configured as reverse proxy
- [ ] Application built and started
- [ ] Health check endpoint responding
- [ ] Monitoring configured
- [ ] Backup automation enabled
- [ ] Security hardening completed
