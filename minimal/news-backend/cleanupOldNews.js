const mongoose = require('mongoose');

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
  category: String,
  source: String,
  author: String,
  url: String,
  urlToImage: String,
  publishedAt: Date,
  fetchedAt: Date,
  createdAt: Date
});

const Article = mongoose.model('Article', articleSchema);

// Delete old articles
async function cleanupOldArticles() {
  try {
    console.log('\n🗑️  Starting cleanup of old articles...\n');
    
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    console.log(`Deleting articles older than: ${oneWeekAgo.toLocaleString()}`);
    
    // Find articles to be deleted
    const articlesToDelete = await Article.find({
      publishedAt: { $lt: oneWeekAgo }
    }).select('title publishedAt category');
    
    if (articlesToDelete.length === 0) {
      console.log('✅ No old articles found. Database is clean!');
      mongoose.connection.close();
      return;
    }
    
    console.log(`\nFound ${articlesToDelete.length} old articles:\n`);
    
    // Show breakdown by category
    const categoryBreakdown = {};
    articlesToDelete.forEach(article => {
      if (!categoryBreakdown[article.category]) {
        categoryBreakdown[article.category] = 0;
      }
      categoryBreakdown[article.category]++;
    });
    
    console.log('Articles to delete by category:');
    Object.entries(categoryBreakdown).forEach(([category, count]) => {
      console.log(`  - ${category}: ${count} articles`);
    });
    
    // Delete the articles
    const result = await Article.deleteMany({
      publishedAt: { $lt: oneWeekAgo }
    });
    
    console.log(`\n✅ Successfully deleted ${result.deletedCount} old articles`);
    
    // Show remaining articles
    const remainingCount = await Article.countDocuments();
    console.log(`📰 Remaining articles in database: ${remainingCount}\n`);
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
  } finally {
    mongoose.connection.close();
    console.log('✅ Database connection closed');
  }
}

// Run the cleanup
cleanupOldArticles();
