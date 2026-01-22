# News Aggregator

A real-time news aggregation platform that fetches, classifies, and displays news from multiple sources across various categories.

## Features

- 🔄 Real-time RSS feed fetching from 36+ trusted sources (USA & Nepal)
- 🤖 Automatic news classification using NLP (supports English & Nepali)
- 🔍 Smart search functionality
- 📱 Responsive design
- 🗂️ Multiple categories (Technology, Business, Sports, Entertainment, Health, Science)
- 💾 MongoDB storage for large-scale data
- 📰 Clean, distraction-free reading experience
- 🌐 Full article content extraction (5000+ characters)
- 🗑️ Automatic cleanup of articles older than 1 week

## News Sources

### USA Sources (Top 5 per category)

**Technology:**
- TechCrunch
- The Verge
- Wired

**Business:**
- CNBC
- Fortune
- MarketWatch

**Sports:**
- ESPN
- Yahoo Sports
- CBS Sports

**Entertainment:**
- Variety
- The Hollywood Reporter
- Entertainment Weekly

**Health:**
- Medical News Today
- Healthline
- US News Health

**Science:**
- Science Daily
- NASA
- Science News

### Nepal Sources (English & Nepali)

**All Categories:**
- Online Khabar (English & Nepali)
- The Himalayan Times
- My Republica
- Kathmandu Post

*Note: All sources provide RSS feeds with full article content, not just headlines. Nepali language articles are automatically parsed and classified.*

## Tech Stack

**Frontend:**
- React 19 (`react@^19.2.0`)
- Tailwind CSS (`tailwindcss@^3.3.0`)
- Lucide React Icons (`lucide-react@^0.548.0`)

**Backend:**
- Node.js (v14+)
- Express.js (`express@^4.18.2`)
- MongoDB (Local)
- RSS Parser (`rss-parser@^3.13.0`)
- Natural (`natural@^6.7.0`) - NLP Library
- ONNX Runtime (`onnxruntime-node`) - For TTS models

## Prerequisites

Before running this project, make sure you have the following installed:

- [Node.js](https://nodejs.org/) (v14 or higher)
- [npm](https://www.npmjs.com/) (comes with Node.js)
- [MongoDB](https://www.mongodb.com/try/download/community) (Local installation)
- Git

## Project Structure

```
minimal/
├── news-aggregator/          # React Frontend
│   ├── src/
│   │   ├── App.js
│   │   └── index.js
│   ├── public/
│   ├── package.json
│   └── .gitignore
│
└── news-backend/             # Node.js Backend
    ├── models/               # AI Models (ONNX)
    ├── server.js             # API server
    ├── newsFetcher.js        # RSS fetching & classification
    ├── updateNews.js         # One-time news update
    ├── scheduleNews.js       # Scheduled news updates
    ├── cleanupOldNews.js     # Manual cleanup script
    ├── package.json
    └── .gitignore
```

## Installation

### 1. Clone the Repository

```bash
git clone <your-repository-url>
cd <repository-name>
```

### 2. Install MongoDB

**Windows:**
- Download from https://www.mongodb.com/try/download/community
- Install and run MongoDB as a service
- MongoDB will run on `mongodb://localhost:27017`

**Mac:**
```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community
```

**Linux:**
```bash
sudo apt-get install mongodb
sudo systemctl start mongodb
```

### 3. Backend Setup

```bash
cd news-backend

# Install dependencies
npm install

# Start the backend server
npm run dev
```

The backend API will run on `http://localhost:5001`

### 4. Frontend Setup

Open a new terminal:

```bash
cd news-aggregator

# Install dependencies
npm install

# Start the React app
npm start
```

The frontend will run on `http://localhost:3000`

## Usage

### Running the Application

1. **Start MongoDB** (if not running as a service)
   ```bash
   mongod
   ```

2. **Start Backend Server**
   ```bash
   cd news-backend
   npm run dev
   ```

3. **Start Frontend**
   ```bash
   cd news-aggregator
   npm start
   ```

4. **Fetch Initial News Data**
   
   In a new terminal:
   ```bash
   cd news-backend
   npm run update-news
   ```

### Scheduled News Updates

To automatically fetch news every 30 minutes and delete old articles:

```bash
cd news-backend
npm run schedule-news
```

Keep this running in a separate terminal. This will:
- ✅ Fetch new articles every 30 minutes
- ✅ Automatically delete articles older than 1 week
- ✅ Skip duplicate articles

### Manual Cleanup

To manually delete old articles (older than 1 week):

```bash
cd news-backend
npm run cleanup-old
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/news` | Get all news articles |
| GET | `/api/news?category=technology` | Get news by category |
| GET | `/api/news/:id` | Get single article by ID |
| POST | `/api/news` | Add new article |
| POST | `/api/news/bulk` | Bulk insert articles |
| DELETE | `/api/news/:id` | Delete article by ID |
| GET | `/api/categories` | Get categories with counts |

## Available Scripts

### Backend

- `npm start` - Start the server
- `npm run dev` - Start server with nodemon (auto-restart)
- `npm run update-news` - Fetch news once (with auto-delete old articles)
- `npm run schedule-news` - Start scheduled updates (every 30 min + auto-cleanup)
- `npm run cleanup-old` - Manually delete articles older than 1 week

### Frontend

- `npm start` - Start development server
- `npm run build` - Build for production
- `npm test` - Run tests

## Configuration

### Backend Port

Default: `5001`

To change, edit `server.js`:
```javascript
const PORT = 5001; // Change this
```

### MongoDB Connection

Default: `mongodb://localhost:27017/newsDB`

To change, edit `server.js`, `updateNews.js`, and `scheduleNews.js`:
```javascript
mongoose.connect('mongodb://localhost:27017/newsDB', { ... })
```

### Update Interval
x
Default: 30 minutes

To change, edit `scheduleNews.js`:
```javascript
const UPDATE_INTERVAL = 30 * 60 * 1000; // Change this (in milliseconds)
```

### Article Retention Period

Default: 7 days (1 week)

To change, edit `scheduleNews.js` and `cleanupOldNews.js`:
```javascript
oneWeekAgo.setDate(oneWeekAgo.getDate() - 7); // Change -7 to your desired days
```

### Content Storage

- **Description**: Up to 500 characters
- **Full Content**: Up to 5000 characters per article
- **Minimum Content Length**: 200 characters (articles with less are skipped)

### RSS Feed Management

To add/remove RSS feeds, edit `newsFetcher.js`:
```javascript
const RSS_FEEDS = {
  technology: [
    'https://your-rss-feed-url.com/feed',
    // Add more feeds here
  ],
  // ... other categories
};
```

**Important Notes:**
- The database is **NOT cleared** when running `scheduleNews.js` or `updateNews.js`
- Articles older than 1 week are **automatically deleted** during updates
- Only articles with substantial content (200+ characters) are saved
- Nepali language articles are supported and automatically classified

## Features to Implement

- [ ] AI-powered article summarization
- [ ] User authentication
- [ ] Bookmarking articles
- [ ] Reading history
- [ ] Custom RSS feed sources
- [ ] Email notifications
- [ ] Dark mode
- [ ] Multi-language support (expand beyond English/Nepali)

## Troubleshooting

### Backend won't start
- Ensure MongoDB is running: `mongod`
- Check if port 5001 is available
- Verify all dependencies: `npm install`

### Frontend won't start
- Ensure React dependencies are installed: `npm install`
- Check if port 3000 is available
- Clear cache: `npm cache clean --force`

### No news articles showing
- Run news fetcher: `npm run update-news`
- Check MongoDB connection
- Verify RSS feeds are accessible

### CORS errors
- Ensure backend is running on port 5001
- Check CORS configuration in `server.js`

### Old articles not being deleted
- Check MongoDB indexes: Ensure `publishedAt` index exists
- Verify date format in database
- Run manual cleanup: `npm run cleanup-old`

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Version History

### v2.0 (November 10, 2025)
- **Enhanced RSS Sources**: Added 36+ feeds across USA and Nepal (English & Nepali).
- **Full Content Extraction**: Increased character limit to 5000 and improved scraping logic.
- **Nepali Support**: Added automatic classification for Nepali language news.
- **Auto-Cleanup**: Implemented automatic deletion of articles older than 7 days.
- **Structural Cleanup**: Consolidated redundant documentation and organized AI models.

### v1.0
- Initial release with basic RSS fetching and aggregation features.

## License

This project is licensed under the ISC License.

## Acknowledgments

- News sources for providing RSS feeds (USA & Nepal)
- MongoDB for database
- React and Node.js communities
- Natural NLP library for text classification

## Contact

For questions or support, please open an issue in the repository.

---

**Note:** This project is for educational purposes. Always respect the terms of service of news sources and their content usage policies. All articles link directly to their original publishers.
