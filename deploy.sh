#!/bin/bash

# Mindline Deployment Script
set -e

echo "🚀 Starting Mindline deployment..."

# Configuration
DEPLOY_USER="mindline"
DEPLOY_PATH="/var/www/mindline"
NGINX_CONFIG="/etc/nginx/sites-available/mindline"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root"
   exit 1
fi

# Install system dependencies
echo "📦 Installing system dependencies..."
sudo apt update
sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx

# Install PM2 globally
sudo npm install -g pm2

# Create application directory
sudo mkdir -p $DEPLOY_PATH
sudo chown $USER:www-data $DEPLOY_PATH
cd $DEPLOY_PATH

# Install Node.js dependencies
print_status "Installing Node.js dependencies..."
npm install

# Build application
print_status "Building application..."
npm run build:production

# Create logs directory
mkdir -p logs

# Setup PM2
print_status "Configuring PM2..."
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 startup
pm2 startup systemd | grep sudo | bash

print_status "Application built and PM2 configured!"
print_warning "Next steps:"
echo "1. Configure your domain in /etc/nginx/sites-available/mindline"
echo "2. Enable the site: sudo ln -s /etc/nginx/sites-available/mindline /etc/nginx/sites-enabled/"
echo "3. Test nginx: sudo nginx -t"
echo "4. Get SSL certificate: sudo certbot --nginx -d yourdomain.com"
echo "5. Restart nginx: sudo systemctl restart nginx"

echo -e "${GREEN}🎉 Deployment script completed!${NC}"