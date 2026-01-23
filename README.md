# 📰 Khabar AI

A modern, AI-powered news aggregation platform with personalized recommendations, text-to-speech, AI summaries, and automated email newsletters.

![Khabar AI](https://img.shields.io/badge/Khabar-AI-6366f1?style=for-the-badge&logo=newspaper&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![MongoDB](https://img.shields.io/badge/MongoDB-Local-47A248?style=flat-square&logo=mongodb&logoColor=white)

## ✨ Features

### 🤖 AI-Powered
- **AI Summaries** - Get instant bullet-point summaries of any article (powered by Gemma 3)
- **Personalized Recommendations** - ML-based article suggestions based on your reading history
- **Smart Classification** - Automatic categorization using NLP (English & Nepali)

### 📱 User Experience
- **Dark Mode** - Beautiful dark theme that syncs across devices
- **Text-to-Speech** - Listen to article summaries (English & Nepali voices)
- **Responsive Design** - Works perfectly on desktop, tablet, and mobile
- **Network Access** - Access from any device on your local network

### 👤 User Features
- **Authentication** - Secure JWT-based login and registration
- **Bookmarks** - Save articles for later reading
- **Reading History** - Track what you've read
- **Custom RSS Feeds** - Add your own news sources

### 📧 Email Newsletters
- **Daily Digest** - Automated personalized newsletters at 7 AM (Nepal time)
- **Beautiful Templates** - Modern, dark-mode compatible email designs
- **Interest Tags** - Shows your top categories and reading preferences
- **One-Click Access** - Open articles directly from email

### 📰 News Aggregation
- **36+ RSS Sources** - Trusted feeds from USA & Nepal
- **Real-time Updates** - Fresh news every 30 minutes
- **Full Content** - Up to 5000 characters per article
- **Auto Cleanup** - Removes articles older than 7 days

## 🗞️ News Sources

### USA Sources
| Category | Sources |
|----------|---------|
| **Technology** | TechCrunch, The Verge, Wired |
| **Business** | CNBC, Fortune, MarketWatch |
| **Sports** | ESPN, Yahoo Sports, CBS Sports |
| **Entertainment** | Variety, Hollywood Reporter, Entertainment Weekly |
| **Health** | Medical News Today, Healthline, US News Health |
| **Science** | Science Daily, NASA, Science News |

### Nepal Sources
| Source | Languages |
|--------|-----------|
| Online Khabar | English & Nepali |
| The Himalayan Times | English |
| My Republica | English |
| Kathmandu Post | English |

## 🛠️ Tech Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19.x | UI Framework |
| Tailwind CSS | 3.x | Styling |
| Lucide React | Latest | Icons |
| Context API | - | State Management |

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 18+ | Runtime |
| Express.js | 4.x | API Server |
| MongoDB | Local | Database |
| Nodemailer | Latest | Email Service |
| Node-Cron | Latest | Scheduled Jobs |
| ONNX Runtime | Latest | TTS Models |
| Natural | 6.x | NLP Classification |

### AI Services
| Service | Purpose |
|---------|---------|
| Gemma 3 (Google) | Article Summarization |
| Piper TTS | Text-to-Speech (English) |
| Google TTS | Text-to-Speech (Nepali) |

## 📁 Project Structure

```
khabar/
├── docs/
│   ├── README_ARCHITECTURE.md                 # Theoretical architecture overview
│   ├── README_QDRANT_EXPLAINER.md             # Qdrant concepts (presentation-friendly)
│   ├── README_SEARCH_QDRANT.md                # Qdrant search + classification flow
│   └── README_NEWSLETTER_PERSONALIZATION.md   # History → preferences → newsletter flow
├── minimal/
│   ├── news-aggregator/          # React Frontend
│   │   ├── src/
│   │   │   ├── App.js            # Main application
│   │   │   ├── config.js         # Dynamic API configuration
│   │   │   ├── context/
│   │   │   │   └── AuthContext.js # Authentication state
│   │   │   └── components/
│   │   │       └── AuthModal.js   # Login/Register modal
│   │   ├── public/
│   │   ├── tailwind.config.js
│   │   └── package.json
│   │
│   └── news-backend/             # Node.js Backend
│       ├── models/
│       │   ├── Article.js        # Article schema
│       │   ├── User.js           # User schema
│       │   ├── en_US-*.onnx      # English TTS model
│       │   └── ne_NP-*.onnx      # Nepali TTS model
│       ├── routes/
│       │   ├── authRoutes.js     # Authentication endpoints
│       │   └── userRoutes.js     # User data endpoints
│       ├── services/
│       │   ├── emailService.js   # Email templates & sending
│       │   ├── newsletterScheduler.js # 7 AM daily emails
│       │   └── preferenceService.js   # AI recommendations
│       ├── middleware/
│       │   └── authMiddleware.js # JWT verification
│       ├── server.js             # Main API server
│       ├── newsFetcher.js        # RSS feed processor
│       ├── updateNews.js         # Manual news update
│       ├── scheduleNews.js       # Automated updates
│       ├── testEmail.js          # Email testing utility
│       ├── updateIP.js           # Network IP helper
│       ├── tts_service.py        # Python TTS service
│       ├── .env                  # Environment config
│       └── package.json
│
└── README.md
```

## 🚀 Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [MongoDB](https://www.mongodb.com/try/download/community) (Local)
- [Python 3](https://www.python.org/) (for TTS)
- Git

### 1. Clone the Repository

```bash
git clone <your-repository-url>
cd khabar
```

### 2. Install MongoDB

**Mac:**
```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community
```

**Windows:**
- Download from https://www.mongodb.com/try/download/community
- Install and run as a service

**Linux:**
```bash
sudo apt-get install mongodb
sudo systemctl start mongodb
```

### 3. Backend Setup

```bash
cd minimal/news-backend

# Install dependencies
npm install

# Create environment file
touch .env
# Add your settings (see Configuration section below)

# Start the server
npm run dev
```

### 4. Frontend Setup

```bash
cd minimal/news-aggregator

# Install dependencies
npm install

# Start the app
npm start
```

### 5. Fetch Initial News

   ```bash
cd minimal/news-backend
   npm run update-news
   ```

## ⚙️ Configuration

### Environment Variables (`.env`)

```env
# MongoDB Connection
MONGODB_URI=mongodb://localhost:27017/newsDB

# JWT Secret
JWT_SECRET=your_secret_key_here

# Server
PORT=5001
FRONTEND_URL=http://192.168.x.x:3000  # Your local network IP

# SMTP Email (Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password  # Gmail App Password

# Qdrant (Vector Database) - for semantic search + filtered retrieval
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=khabar_articles
QDRANT_VECTOR_SIZE=384
```

### Gmail App Password Setup

1. Go to https://myaccount.google.com/apppasswords
2. Sign in and enable 2-Step Verification if needed
3. Select "Mail" for app, "Mac/Other" for device
4. Copy the 16-character password to `SMTP_PASS`

### Network Access (Cross-Device)

To access the app from phones/tablets on the same network:

   ```bash
# Auto-detect and update your IP
cd minimal/news-backend
node updateIP.js
```

Then access:
- **Frontend:** `http://YOUR_IP:3000`
- **Backend:** `http://YOUR_IP:5001`

### Vector Search (Qdrant) - Advanced Search & Topic Filtering

Qdrant is used to power:
- **Semantic search** (search by meaning, not just keywords)
- **Fast filtering** using payload fields like `topics`, `category`, `source`, `publishedAt`

#### Start Qdrant (Docker)

   ```bash
docker run -p 6333:6333 -p 6334:6334 --name qdrant -d qdrant/qdrant
   ```

#### Index existing articles into Qdrant

After you already have articles in MongoDB:
   
   ```bash
cd minimal/news-backend
npm run index-qdrant
```

#### Backfill topics for existing articles (optional)

If your DB already has articles from before topic tagging was added:

```bash
cd minimal/news-backend
npm run backfill-topics
```

To recompute topics for all articles:

```bash
cd minimal/news-backend
node scripts/backfillTopics.js --force
```

#### Search API

The backend exposes:
- `GET /api/search?q=...` (semantic search via Qdrant if available)
- `GET /api/search?topics=finance,politics` (filter-only via MongoDB)

Examples:

```bash
# Semantic search (vector)
curl "http://localhost:5001/api/search?q=interest%20rates&limit=12&page=1"

# Semantic search + topic filter
curl "http://localhost:5001/api/search?q=budget&topics=finance&limit=12&page=1"

# Filter-only feed by topic (latest first)
curl "http://localhost:5001/api/search?topics=politics&limit=12&page=1"
```

> Note: Current implementation uses a **local hashing vectorizer** (works offline).
> For “real” semantic embeddings, swap in a sentence-transformers / embeddings API in `minimal/news-backend/services/qdrantService.js` (`textToVector()`).

## 📧 Email Newsletter System

### Daily Newsletter Schedule

Newsletters are sent automatically at **7:00 AM Nepal Time** to users with daily digest enabled.

### Email Templates

| Template | Trigger | Description |
|----------|---------|-------------|
| Welcome | User signup | Feature introduction |
| Daily Digest | 7 AM daily | Standard news digest |
| Personalized | 7 AM daily | AI-curated based on preferences |
| Weekly | Weekly | Stats + top stories |

### Testing Emails

```bash
cd minimal/news-backend

# Send test email to yourself
node testEmail.js

# Send to specific email
node testEmail.js user@example.com

# Send to all eligible users
node testEmail.js --all

# Send to specific user from database
node testEmail.js --user user@example.com

# List all users
node testEmail.js --list

# Enable daily digest for a user
node testEmail.js --enable user@example.com
```

## 📡 API Endpoints

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/news` | Get all articles |
| GET | `/api/news?category=technology` | Filter by category |
| GET | `/api/news?page=1&limit=12` | Pagination |
| GET | `/api/news/:id` | Get single article |
| POST | `/api/news/:id/summarize` | AI summarize article |
| POST | `/api/news/:id/tts` | Generate TTS audio |
| GET | `/api/categories` | Get category counts |

### Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Get current user |
| PUT | `/api/auth/profile` | Update profile |

### User Endpoints (Protected)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/user/bookmarks` | Get bookmarks |
| POST | `/api/user/bookmarks/:id` | Add bookmark |
| DELETE | `/api/user/bookmarks/:id` | Remove bookmark |
| GET | `/api/user/history` | Get reading history |
| POST | `/api/user/history/:id` | Add to history |
| GET | `/api/user/recommendations` | Get AI recommendations |
| PUT | `/api/user/email-preferences` | Update email settings |
| POST | `/api/user/test/send-newsletter` | Trigger newsletter |

## 📜 Available Scripts

### Backend (`news-backend/`)

```bash
npm start              # Start server
npm run dev            # Start with auto-reload (nodemon)
npm run update-news    # Fetch news once
npm run schedule-news  # Start scheduled updates (30 min)
npm run cleanup-old    # Delete articles > 7 days old
```

### Frontend (`news-aggregator/`)

```bash
npm start    # Start development server
npm run build # Build for production
npm test     # Run tests
```

### Utility Scripts

```bash
# Email Testing
node testEmail.js --help

# Network IP Update
node updateIP.js
```

## 🎨 Features Showcase

### AI Summary
Click "AI Summary" on any article to get:
- Bullet-point summary
- Key facts highlighted in **bold**
- Language-aware (English/Nepali)

### Text-to-Speech
After generating a summary:
- Click "Listen to Summary" 
- English articles use high-quality Piper TTS
- Nepali articles use Google TTS

### Dark Mode
- Toggle in sidebar or header
- Syncs to your account
- Email templates auto-adapt to system preference

### Personalized Recommendations
Based on your reading history:
- Category preferences (%)
- Preferred sources
- Top keywords/topics

## 🔧 Troubleshooting

### Backend Issues

| Problem | Solution |
|---------|----------|
| MongoDB won't connect | Run `mongod` or check if service is running |
| Port 5001 in use | Change `PORT` in `.env` |
| SMTP errors | Verify Gmail App Password |

### Frontend Issues

| Problem | Solution |
|---------|----------|
| API connection failed | Check backend is running on correct port |
| Network access not working | Run `node updateIP.js` and restart |
| Styles not loading | Run `npm install` and restart |

### Email Issues

| Problem | Solution |
|---------|----------|
| Emails not sending | Check SMTP settings in `.env` |
| "Less secure app" error | Use Gmail App Password, not regular password |
| Newsletter not arriving | Check `emailPreferences.dailyDigest` is `true` |

## 🗓️ Version History

### v3.0 (January 2026) - Current
- ✅ **User Authentication** - JWT-based login/registration
- ✅ **Bookmarks & History** - Save and track articles
- ✅ **AI Summaries** - Gemma 3 powered article summarization
- ✅ **Text-to-Speech** - English & Nepali voice synthesis
- ✅ **Dark Mode** - Beautiful dark theme with sync
- ✅ **Email Newsletters** - Automated daily digest at 7 AM
- ✅ **Personalized Recommendations** - ML-based article suggestions
- ✅ **Network Access** - Cross-device support on local network
- ✅ **Modern Email Templates** - Dark mode compatible, mobile responsive

### v2.0 (November 2025)
- Enhanced RSS sources (36+ feeds)
- Full content extraction (5000 chars)
- Nepali language support
- Auto-cleanup of old articles

### v1.0 (Initial)
- Basic RSS fetching
- Category-based aggregation

## 📄 License

This project is licensed under the ISC License.

## 🙏 Acknowledgments

- **News Sources** - RSS feeds from USA & Nepal publishers
- **Google** - Gemma 3 AI for summarization
- **Piper TTS** - High-quality voice synthesis
- **MongoDB** - Database engine
- **React & Node.js** - Framework communities

## 📬 Contact

For questions or support, please open an issue in the repository.

---

<p align="center">
  <b>Made with ❤️ by Bikash Kumar Sah</b><br>
  <i>Your AI-powered news companion</i>
</p>

---

**Disclaimer:** This project is for educational purposes. Respect the terms of service of news sources. All articles link to original publishers.
