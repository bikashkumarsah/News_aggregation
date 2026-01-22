# Dependencies Reference

This document lists all dependencies for the project.

## Backend Dependencies

### Production Dependencies
```
express@^4.18.2          - Web framework for Node.js
mongoose@^7.5.0          - MongoDB object modeling
cors@^2.8.5              - Enable CORS
rss-parser@^3.13.0       - Parse RSS feeds
node-fetch@^2.7.0        - Fetch API for Node.js
natural@^6.7.0           - Natural Language Processing
```

### Development Dependencies
```
nodemon@^3.0.1           - Auto-restart server on changes
```

## Frontend Dependencies

### Production Dependencies
```
react@^19.2.0            - JavaScript library for UI
react-dom@^19.2.0        - React DOM rendering
react-scripts@^5.0.1     - React build scripts
lucide-react@^0.548.0    - Icon library
web-vitals@^2.1.4        - Performance metrics
```

### Development Dependencies
```
tailwindcss@^3.3.0       - Utility-first CSS framework
postcss@^8.4.31          - CSS post-processor
autoprefixer@^10.4.16    - Auto-prefix CSS
```

## System Requirements

- Node.js: v14.0.0 or higher
- npm: v6.0.0 or higher
- MongoDB: v4.0 or higher
- Operating System: Windows, macOS, or Linux

## Installation Commands

### Backend
```bash
cd news-backend
npm install
```

### Frontend
```bash
cd news-aggregator
npm install
```

## Verification

To verify installations:

```bash
# Check Node.js version
node --version

# Check npm version
npm --version

# Check MongoDB
mongod --version

# List installed packages
npm list --depth=0
```