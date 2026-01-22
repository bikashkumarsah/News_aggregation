# Update Summary - News Aggregator v2.0

## Changes Made (Date: November 10, 2025)

### ✅ Completed Updates

#### 1. RSS Feed Sources Updated
- **Added USA Sources**: 15+ premium news sources across all categories
- **Added Nepal Sources**: Both English and Nepali language feeds
  - Online Khabar (English & Nepali)
  - The Himalayan Times
  - My Republica  
  - Kathmandu Post
- **Total Sources**: 36+ RSS feeds

#### 2. Full Article Content Extraction
- Now extracts up to **5000 characters** (increased from 2000)
- Checks `content:encoded` field for full articles
- Falls back to `content`, `description`, `contentSnippet`
- Strips HTML but preserves text structure
- **Minimum content**: 200 characters (articles with less are skipped)

#### 3. Nepali Language Support
- Added Nepali keywords for classification:
  - प्रविधि (technology)
  - व्यवसाय (business)
  - खेलकुद (sports)
  - मनोरञ्जन (entertainment)
  - स्वास्थ्य (health)
  - विज्ञान (science)
- Nepali articles are automatically classified correctly

#### 4. Automatic Article Cleanup
- **New Feature**: Auto-delete articles older than 1 week
- Runs automatically with `scheduleNews.js`
- Also runs with `updateNews.js`
- Shows deletion count in console
- Keeps database clean and performant

#### 5. New Files Created
- **cleanupOldNews.js**: Manual cleanup script
  - Deletes articles older than 1 week
  - Shows breakdown by category
  - Can be run anytime with: `npm run cleanup-old`

#### 6. Updated Files
- ✅ `newsFetcher.js`: USA/Nepal feeds + full content extraction + Nepali support
- ✅ `scheduleNews.js`: Added auto-cleanup function
- ✅ `updateNews.js`: Added auto-cleanup function
- ✅ `package.json`: Added `cleanup-old` script
- ✅ `README.md`: Complete documentation update

### 📋 Database Behavior

**Important Notes:**
- ❌ Database is **NEVER** cleared automatically
- ✅ New articles are added continuously
- ✅ Duplicates are skipped (based on URL)
- ✅ Old articles (>1 week) are automatically deleted
- ✅ Articles are indexed for fast queries

### 🎯 Current Features

1. **36+ RSS Sources** (USA + Nepal, English + Nepali)
2. **Full Content** (up to 5000 characters)
3. **Auto Classification** (6 categories with Nepali support)
4. **Smart Search** (title, description, source)
5. **Auto Cleanup** (deletes articles >1 week old)
6. **Duplicate Prevention** (URL-based)
7. **Real-time Updates** (every 30 minutes)

### 🚀 How to Use

#### Start Everything:
```bash
# Terminal 1 - Backend API
cd news-backend
npm run dev

# Terminal 2 - News Scheduler (optional)
cd news-backend
npm run schedule-news

# Terminal 3 - Frontend
cd news-aggregator
npm start
```

#### Fetch News Once:
```bash
cd news-backend
npm run update-news
```

#### Manual Cleanup:
```bash
cd news-backend
npm run cleanup-old
```

### 📊 Expected Results

After running `npm run update-news`, you should see:
- ✅ Articles from USA sources (TechCrunch, ESPN, Variety, etc.)
- ✅ Articles from Nepal sources (Online Khabar, Himalayan Times, etc.)
- ✅ Both English and Nepali articles
- ✅ Full article content (not just headlines)
- ✅ Automatic deletion of old articles
- ✅ Articles properly categorized

### ⚙️ Configuration

#### Change retention period (currently 1 week):
Edit `scheduleNews.js` and `cleanupOldNews.js`:
```javascript
oneWeekAgo.setDate(oneWeekAgo.getDate() - 7); // Change -7 to desired days
```

#### Change update interval (currently 30 minutes):
Edit `scheduleNews.js`:
```javascript
const UPDATE_INTERVAL = 30 * 60 * 1000; // milliseconds
```

#### Add more RSS feeds:
Edit `newsFetcher.js`:
```javascript
const RSS_FEEDS = {
  technology: [
    'https://your-new-feed.com/rss',
    // ... existing feeds
  ]
};
```

### 🐛 Known Issues & Solutions

**Issue**: Some RSS feeds might be blocked or slow
**Solution**: The system handles errors gracefully and continues with other feeds

**Issue**: Some articles might be too short
**Solution**: Only articles with 200+ characters are saved

**Issue**: Nepali encoding issues
**Solution**: UTF-8 encoding is properly handled

### 📝 Version History

- **v1.0**: Initial release with basic RSS fetching
- **v2.0** (Current): 
  - USA + Nepal sources
  - Full content extraction
  - Nepali language support
  - Auto-cleanup (1 week)
  - Enhanced documentation

### 🔜 Next Steps (Optional)

1. Test with: `npm run update-news`
2. Verify news appear in frontend
3. Check that both English and Nepali articles are present
4. Run `npm run cleanup-old` to test cleanup
5. Start scheduler for continuous updates: `npm run schedule-news`

### ✨ What's Different From Before

**Before:**
- Limited RSS feeds
- Only 2000 chars content
- No Nepali support
- No automatic cleanup
- Articles accumulated forever

**After:**
- 36+ RSS feeds (USA + Nepal)
- 5000 chars content
- Nepali language support
- Auto-delete after 1 week
- Clean, performant database

---

**Date**: November 10, 2025  
**Version**: 2.0  
**Status**: ✅ Ready to Use
