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
    unique: true // Prevent duplicates
  },
  urlToImage: String,
  publishedAt: Date,
  fetchedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create index for faster queries
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

// Update news in database
async function updateNewsDatabase() {
  try {
    console.log('\n🚀 Starting news update process...\n');
    
    // First, delete old articles
    await deleteOldArticles();
    
    // Fetch all news from RSS feeds
    const articles = await fetchAllNews();
    
    // Remove duplicates
    const uniqueArticles = removeDuplicates(articles);
    
    console.log('\n💾 Saving articles to database...');
    
    let savedCount = 0;
    let skippedCount = 0;
    
    // Save articles one by one (to handle duplicates gracefully)
    for (const article of uniqueArticles) {
      try {
        // Check if article already exists
        const exists = await Article.findOne({ url: article.url });
        
        if (!exists) {
          await Article.create(article);
          savedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        if (error.code === 11000) {
          // Duplicate key error
          skippedCount++;
        } else {
          console.error(`Error saving article: ${error.message}`);
        }
      }
    }
    
    console.log(`\n✅ News update completed!`);
    console.log(`   - New articles saved: ${savedCount}`);
    console.log(`   - Duplicates skipped: ${skippedCount}`);
    
    // Show statistics by category
    console.log('\n📊 Articles by category:');
    const stats = await Article.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    stats.forEach(stat => {
      console.log(`   - ${stat._id}: ${stat.count} articles`);
    });
    
    // Total count
    const totalCount = await Article.countDocuments();
    console.log(`\n📰 Total articles in database: ${totalCount}`);
    
  } catch (error) {
    console.error('❌ Error updating news:', error);
  } finally {
    mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

// Run the update
updateNewsDatabase();
