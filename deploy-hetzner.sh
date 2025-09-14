#!/bin/bash

# Mindline Hybrid Deployment - Hetzner Signaling Server Setup
set -e

echo "🚀 Setting up Mindline signaling server on Hetzner..."

# Configuration
DOMAIN="signal.yourdomain.com"  # Replace with your domain
DEPLOY_PATH="/opt/mindline-signaling"

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
if [[ $EUID -ne 0 ]]; then
   print_error "This script must be run as root (use sudo)"
   exit 1
fi

# Update system
print_status "Updating system packages..."
apt update && apt upgrade -y

# Install Docker and Docker Compose
print_status "Installing Docker and Docker Compose..."
apt install -y docker.io docker-compose
systemctl enable docker
systemctl start docker

# Install Certbot for SSL
print_status "Installing Certbot for SSL certificates..."
apt install -y certbot

# Create deployment directory
print_status "Creating deployment directory..."
mkdir -p $DEPLOY_PATH
cd $DEPLOY_PATH

# Copy deployment files (assumes they're in the current directory)
print_status "Copying deployment files..."
if [ -f "../docker-compose.yml" ]; then
    cp ../docker-compose.yml .
    cp ../Dockerfile .
    cp ../nginx.conf .
    cp ../signaling-server.js .
    cp ../ecosystem.config.js .
    cp ../package.json .
    cp ../package-lock.json . 2>/dev/null || true
else
    print_error "Deployment files not found. Make sure to run this script from the project directory."
    exit 1
fi

# Create SSL directory
mkdir -p ssl
mkdir -p logs

# Check if domain is configured
print_warning "Domain Configuration Required:"
echo "1. Make sure DNS A record for $DOMAIN points to this server's IP"
echo "2. Replace 'signal.yourdomain.com' in nginx.conf with your actual domain"
echo ""
read -p "Have you configured the domain? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_error "Please configure your domain first, then re-run this script"
    exit 1
fi

# Get SSL certificate
print_status "Obtaining SSL certificate for $DOMAIN..."
certbot certonly --standalone --non-interactive --agree-tos --email admin@$DOMAIN -d $DOMAIN

# Copy certificates
print_status "Copying SSL certificates..."
cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem ssl/
cp /etc/letsencrypt/live/$DOMAIN/privkey.pem ssl/
chmod 644 ssl/*.pem

# Build and start services
print_status "Building and starting Docker services..."
docker-compose build
docker-compose up -d

# Wait for services to start
sleep 10

# Test services
print_status "Testing services..."
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    print_status "Signaling server is running"
else
    print_error "Signaling server failed to start"
    docker-compose logs
    exit 1
fi

if curl -f -k https://localhost/health > /dev/null 2>&1; then
    print_status "Nginx proxy is running"
else
    print_error "Nginx proxy failed to start"
    docker-compose logs nginx
    exit 1
fi

# Setup certificate auto-renewal
print_status "Setting up SSL certificate auto-renewal..."
echo "0 12 * * * /usr/bin/certbot renew --quiet && cd $DEPLOY_PATH && docker-compose restart nginx" | crontab -

# Create management script
cat > manage.sh << 'EOF'
#!/bin/bash
case $1 in
    start)
        docker-compose up -d
        ;;
    stop)
        docker-compose down
        ;;
    restart)
        docker-compose restart
        ;;
    logs)
        docker-compose logs -f ${2:-}
        ;;
    status)
        docker-compose ps
        echo ""
        curl -s https://signal.yourdomain.com/health | jq . 2>/dev/null || curl -s https://signal.yourdomain.com/health
        ;;
    update)
        git pull
        docker-compose build
        docker-compose up -d
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|logs|status|update}"
        ;;
esac
EOF
chmod +x manage.sh

# Create systemd service
cat > /etc/systemd/system/mindline-signaling.service << EOF
[Unit]
Description=Mindline Signaling Server
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$DEPLOY_PATH
ExecStart=/usr/bin/docker-compose up -d
ExecStop=/usr/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mindline-signaling

print_status "Deployment completed successfully!"
echo ""
print_warning "Next steps:"
echo "1. Update your frontend config to point to wss://$DOMAIN/ws"
echo "2. Deploy your frontend to Cloudflare Pages"
echo "3. Test the connection between frontend and signaling server"
echo ""
echo "Management commands:"
echo "  cd $DEPLOY_PATH"
echo "  ./manage.sh status    # Check service status"
echo "  ./manage.sh logs      # View logs"
echo "  ./manage.sh restart   # Restart services"
echo ""
echo "🎉 Your signaling server is running at: wss://$DOMAIN/ws"