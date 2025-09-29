# Configuration Template

Before launching Mindline publicly, update the following placeholders throughout the codebase:

## Required Replacements

### GitHub Repository
**Find**: `yourusername/mindline`
**Replace with**: Your actual GitHub username and repo name (e.g., `lawzava/mindline`)

**Files to update**:
- README.md (3 occurrences)
- PRIVACY.md (1 occurrence)
- TERMS.md (2 occurrences)
- CONTRIBUTING.md (1 occurrence)
- CHANGELOG.md (1 occurrence)

### Security Contact Email
**Find**: `[security@yourdomain.com]`
**Replace with**: Your actual security contact email

**Files to update**:
- SECURITY.md (1 occurrence)

### Signaling Server Domain
**Find**: `signal.yourdomain.com`
**Replace with**: Your actual signaling server domain (e.g., `signal.mindline.app`)

**Files to update**:
- js/config.js (1 occurrence)
- nginx.conf (2 occurrences)
- scripts/inject-env.js (1 occurrence)

### Demo URL (if applicable)
**Find**: `https://your-demo-url.com`
**Replace with**: Your actual demo/production URL (e.g., `https://mindline.app`)

## Quick Find & Replace Commands

```bash
# Update GitHub repository
find . -type f \( -name "*.md" -o -name "*.js" \) -not -path "*/node_modules/*" -exec sed -i '' 's/yourusername\/mindline/lawzava\/mindline/g' {} +

# Update security email
find . -type f \( -name "*.md" \) -not -path "*/node_modules/*" -exec sed -i '' 's/security@yourdomain.com/security@mindline.app/g' {} +

# Update signaling server domain
find . -type f \( -name "*.js" -o -name "*.conf" -o -name "*.md" \) -not -path "*/node_modules/*" -exec sed -i '' 's/signal\.yourdomain\.com/signal.mindline.app/g' {} +
```

## Verification Checklist

After making replacements, verify:
- [ ] All GitHub links work correctly
- [ ] Security email is correct
- [ ] Signaling server domain matches your actual setup
- [ ] No placeholder text remains in public-facing files

## Additional Configuration

### Production Environment Variables
Set these when deploying:
- `SIGNALING_SERVER` - Your signaling server URL
- `USE_SSL` - Set to `true` for HTTPS
- `PORT` - Signaling server port (default: 3000)
- `NODE_ENV` - Set to `production`

### Cloudflare Configuration
- Verify DNS records point to your server
- Ensure WebSocket support is enabled
- Check SSL/TLS encryption mode (Full or Full Strict)

---

**Note**: Keep this file for reference but consider removing it before making the repository public, or add it to .gitignore if you want to keep configuration notes private.