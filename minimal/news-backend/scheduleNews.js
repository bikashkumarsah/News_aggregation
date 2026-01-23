const mongoose = require('mongoose');
const { fetchAllNews, removeDuplicates } = require('./newsFetcher');

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/newsDB', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Article Schema
const articleSchema = new mongoose.Schema({
  title: String,
  description: String,
  content: String,
  topics: [String],
  category: String,
  source: String,
  author: String,
  url: {
    type: String,
    unique: true
  },
  urlToImage: String,
  publishedAt: Date,
  fetchedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

articleSchema.index({ category: 1, publishedAt: -1 });
articleSchema.index({ topics: 1, publishedAt: -1 });
articleSchema.index({ url: 1 });
articleSchema.index({ publishedAt: 1 }); // Index for deletion query

const Article = mongoose.model('Article', articleSchema);

// Delete old articles (older than 1 week)
async function deleteOldArticles() {
  try {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const result = await Article.deleteMany({
      publishedAt: { $lt: oneWeekAgo }
    });
    
    if (result.deletedCount > 0) {
      console.log(`🗑️  Deleted ${result.deletedCount} old articles (older than 1 week)`);
    } else {
      console.log('✅ No old articles to delete');
    }
    
    return result.deletedCount;
  } catch (error) {
    console.error('❌ Error deleting old articles:', error.message);
    return 0;
  }
}

// Update function
async function updateNews() {
  try {
    const timestamp = new Date().toLocaleString();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 News Update Started: ${timestamp}`);
    console.log('='.repeat(60));
    
    // First, delete old articles
    await deleteOldArticles();
    
    // Then fetch new articles
    const articles = await fetchAllNews();
    const uniqueArticles = removeDuplicates(articles);
    
    let savedCount = 0;
    let skippedCount = 0;
    
    for (const article of uniqueArticles) {
      try {
        const exists = await Article.findOne({ url: article.url });
        
        if (!exists) {
          await Article.create(article);
          savedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        if (error.code === 11000) {
          skippedCount++;
        }
      }
    }
    
    console.log(`\n✅ Update Complete!`);
    console.log(`   New: ${savedCount} | Skipped: ${skippedCount}`);
    
    const totalCount = await Article.countDocuments();
    console.log(`   Total in DB: ${totalCount} articles`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ Update error:', error.message);
  }
}

// Run update every 30 minutes (1800000 ms)
const UPDATE_INTERVAL = 30 * 60 * 1000;

console.log('🚀 News Scheduler Started');
console.log(`⏰ Updates every ${UPDATE_INTERVAL / 60000} minutes`);
console.log('🗑️  Auto-deletes articles older than 1 week');
console.log('Press Ctrl+C to stop\n');

// Run immediately on start
updateNews();

// Schedule periodic updates
setInterval(updateNews, UPDATE_INTERVAL);
