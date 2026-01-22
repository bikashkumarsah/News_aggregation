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
  createdAt: Date
});

const Article = mongoose.model('Article', articleSchema);

// Sample articles
const sampleArticles = [
  {
    title: 'New AI Model Breakthrough in Natural Language Processing',
    description: 'Researchers have developed a new AI model that significantly improves natural language understanding.',
    content: 'Full article content here...',
    category: 'technology',
    source: 'Tech News Daily',
    author: 'John Doe',
    url: 'https://example.com/ai-breakthrough',
    urlToImage: 'https://via.placeholder.com/400x200',
    publishedAt: new Date('2025-10-30T10:00:00Z')
  },
  {
    title: 'Stock Market Reaches New Heights',
    description: 'Major indices hit record highs as investors show confidence in economic recovery.',
    content: 'Full article content here...',
    category: 'business',
    source: 'Business Weekly',
    author: 'Jane Smith',
    url: 'https://example.com/stock-market',
    urlToImage: 'https://via.placeholder.com/400x200',
    publishedAt: new Date('2025-10-30T09:30:00Z')
  },
  {
    title: 'Championship Finals This Weekend',
    description: 'Top teams prepare for the ultimate showdown in this season\'s championship finals.',
    content: 'Full article content here...',
    category: 'sports',
    source: 'Sports Today',
    author: 'Mike Johnson',
    url: 'https://example.com/championship-finals',
    urlToImage: 'https://via.placeholder.com/400x200',
    publishedAt: new Date('2025-10-30T08:00:00Z')
  },
  {
    title: 'New Blockbuster Movie Breaks Box Office Records',
    description: 'The latest superhero film shatters opening weekend records worldwide.',
    content: 'Full article content here...',
    category: 'entertainment',
    source: 'Entertainment Buzz',
    author: 'Sarah Williams',
    url: 'https://example.com/blockbuster-movie',
    urlToImage: 'https://via.placeholder.com/400x200',
    publishedAt: new Date('2025-10-29T20:00:00Z')
  },
  {
    title: 'Study Reveals Benefits of Mediterranean Diet',
    description: 'New research shows significant health improvements from following Mediterranean eating patterns.',
    content: 'Full article content here...',
    category: 'health',
    source: 'Health Magazine',
    author: 'Dr. Emily Brown',
    url: 'https://example.com/mediterranean-diet',
    urlToImage: 'https://via.placeholder.com/400x200',
    publishedAt: new Date('2025-10-29T14:00:00Z')
  },
  {
    title: 'NASA Discovers Potential Signs of Life on Distant Moon',
    description: 'Scientists detect unusual chemical signatures on Europa that could indicate biological activity.',
    content: 'Full article content here...',
    category: 'science',
    source: 'Science Daily',
    author: 'Dr. Robert Chen',
    url: 'https://example.com/nasa-discovery',
    urlToImage: 'https://via.placeholder.com/400x200',
    publishedAt: new Date('2025-10-29T11:00:00Z')
  },
  {
    title: 'Quantum Computing Makes Major Advancement',
    description: 'Tech giant announces breakthrough in quantum error correction, bringing practical quantum computers closer to reality.',
    content: 'Full article content here...',
    category: 'technology',
    source: 'Tech Insider',
    author: 'Alex Turner',
    url: 'https://example.com/quantum-computing',
    urlToImage: 'https://via.placeholder.com/400x200',
    publishedAt: new Date('2025-10-29T07:30:00Z')
  },
  {
    title: 'Global Economy Shows Strong Recovery Signs',
    description: 'Economic indicators suggest robust growth across major markets in the coming quarter.',
    content: 'Full article content here...',
    category: 'business',
    source: 'Financial Times',
    author: 'David Martinez',
    url: 'https://example.com/economy-recovery',
    urlToImage: 'https://via.placeholder.com/400x200',
    publishedAt: new Date('2025-10-28T16:00:00Z')
  }
];

// Insert sample data
const addSampleData = async () => {
  try {
    // Clear existing data (optional)
    await Article.deleteMany({});
    console.log('🗑️  Cleared existing articles');
    
    // Insert new data
    const result = await Article.insertMany(sampleArticles);
    console.log(`✅ Added ${result.length} sample articles`);
    
    // Display added articles
    console.log('\nAdded articles:');
    result.forEach((article, index) => {
      console.log(`${index + 1}. [${article.category}] ${article.title}`);
    });
    
    mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  } catch (error) {
    console.error('❌ Error adding sample data:', error);
    mongoose.connection.close();
  }
};

addSampleData();