#!/usr/bin/env node
/**
 * Seed a handful of demo articles so the UI has content before the first RSS
 * fetch. Safe to run repeatedly: articles are upserted by URL and nothing
 * else in the database is touched.
 *
 * Usage:
 *   node addSampleData.js           # add or refresh the sample articles
 *   node addSampleData.js --remove  # delete only the sample articles
 */

require('dotenv').config({ quiet: true });

const Article = require('./models/Article');
const { getTopicsForArticle } = require('./services/topicService');
const {
  connectMongo,
  disconnectMongo
} = require('./features/marketGyan/services/mongoConnectionService');

const SAMPLE_URL_PREFIX = 'https://example.com/khabar-sample/';
const HOUR_MS = 60 * 60 * 1000;

// Sample articles (published "hours ago" so they appear at the top of the feed)
const sampleArticles = [
  {
    title: 'New AI Model Breakthrough in Natural Language Processing',
    description: 'Researchers have developed a new AI model that significantly improves natural language understanding.',
    category: 'technology',
    source: 'Tech News Daily',
    author: 'John Doe',
    slug: 'ai-breakthrough',
    hoursAgo: 1
  },
  {
    title: 'Stock Market Reaches New Heights',
    description: 'Major indices hit record highs as investors show confidence in economic recovery.',
    category: 'business',
    source: 'Business Weekly',
    author: 'Jane Smith',
    slug: 'stock-market',
    hoursAgo: 2
  },
  {
    title: 'Championship Finals This Weekend',
    description: 'Top teams prepare for the ultimate showdown in this season\'s championship finals.',
    category: 'sports',
    source: 'Sports Today',
    author: 'Mike Johnson',
    slug: 'championship-finals',
    hoursAgo: 3
  },
  {
    title: 'New Blockbuster Movie Breaks Box Office Records',
    description: 'The latest superhero film shatters opening weekend records worldwide.',
    category: 'entertainment',
    source: 'Entertainment Buzz',
    author: 'Sarah Williams',
    slug: 'blockbuster-movie',
    hoursAgo: 4
  },
  {
    title: 'Study Reveals Benefits of Mediterranean Diet',
    description: 'New research shows significant health improvements from following Mediterranean eating patterns.',
    category: 'health',
    source: 'Health Magazine',
    author: 'Dr. Emily Brown',
    slug: 'mediterranean-diet',
    hoursAgo: 5
  },
  {
    title: 'NASA Discovers Potential Signs of Life on Distant Moon',
    description: 'Scientists detect unusual chemical signatures on Europa that could indicate biological activity.',
    category: 'science',
    source: 'Science Daily',
    author: 'Dr. Robert Chen',
    slug: 'nasa-discovery',
    hoursAgo: 6
  },
  {
    title: 'Quantum Computing Makes Major Advancement',
    description: 'Tech giant announces breakthrough in quantum error correction, bringing practical quantum computers closer to reality.',
    category: 'technology',
    source: 'Tech Insider',
    author: 'Alex Turner',
    slug: 'quantum-computing',
    hoursAgo: 7
  },
  {
    title: 'Global Economy Shows Strong Recovery Signs',
    description: 'Economic indicators suggest robust growth across major markets in the coming quarter.',
    category: 'business',
    source: 'Financial Times',
    author: 'David Martinez',
    slug: 'economy-recovery',
    hoursAgo: 8
  }
];

const toArticle = ({ slug, hoursAgo, ...sample }, now) => {
  const article = {
    ...sample,
    content: `${sample.description} This is sample content for local development and demos.`,
    url: `${SAMPLE_URL_PREFIX}${slug}`,
    urlToImage: null,
    publishedAt: new Date(now - (hoursAgo * HOUR_MS)),
    fetchedAt: new Date(now)
  };
  article.topics = getTopicsForArticle(article);
  return article;
};

const addSampleData = async () => {
  const now = Date.now();
  const result = await Article.bulkWrite(sampleArticles.map((sample) => {
    const article = toArticle(sample, now);
    return {
      updateOne: {
        filter: { url: article.url },
        update: { $set: article },
        upsert: true
      }
    };
  }));
  console.log(`✅ Sample articles ready (${result.upsertedCount} added, ${result.modifiedCount} refreshed)`);

  sampleArticles.forEach((article, index) => {
    console.log(`${index + 1}. [${article.category}] ${article.title}`);
  });
};

const removeSampleData = async () => {
  const result = await Article.deleteMany({ url: { $regex: `^${SAMPLE_URL_PREFIX.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}` } });
  console.log(`🗑️  Removed ${result.deletedCount} sample articles`);
};

const main = async () => {
  await connectMongo();
  console.log('✅ Connected to MongoDB');
  if (process.argv.includes('--remove')) await removeSampleData();
  else await addSampleData();
};

main()
  .catch((error) => {
    console.error('❌ Error updating sample data:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo().catch(() => {});
    console.log('\n✅ Database connection closed');
  });
