import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from backend root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');

dotenv.config({ path: envPath });
console.log(`📄 Loading .env from: ${envPath}`);

// Local MongoDB URI
const LOCAL_MONGODB_URI = 'mongodb://localhost:27017/phonix';

// Atlas MongoDB URI from environment
const ATLAS_MONGODB_URI = process.env.MONGODB_URI;

if (!ATLAS_MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment variables');
  process.exit(1);
}

console.log('🔄 Starting migration...');
console.log(`📍 Local: ${LOCAL_MONGODB_URI}`);
console.log(`☁️  Atlas: ${ATLAS_MONGODB_URI.replace(/:[^:]*@/, ':****@')}`);

// Connect to local DB
const localConnection = await mongoose.createConnection(LOCAL_MONGODB_URI);

// Connect to Atlas
const atlasConnection = await mongoose.createConnection(ATLAS_MONGODB_URI);

async function migrateCollection(collectionName) {
  try {
    console.log(`\n📦 Migrating collection: ${collectionName}`);

    // Get collection from local DB
    const localCollection = localConnection.collection(collectionName);
    const documents = await localCollection.find({}).toArray();

    if (documents.length === 0) {
      console.log(`⚠️  No documents found in local collection: ${collectionName}`);
      return;
    }

    console.log(`📤 Found ${documents.length} documents to migrate`);

    // Get collection from Atlas
    const atlasCollection = atlasConnection.collection(collectionName);

    // Insert documents
    const result = await atlasCollection.insertMany(documents);
    console.log(`✅ Successfully inserted ${result.insertedCount} documents to Atlas`);
  } catch (error) {
    console.error(`❌ Error migrating ${collectionName}:`, error.message);
  }
}

async function main() {
  try {
    // Check if local connection is connected
    if (!localConnection.connection.readyState) {
      console.error('❌ Cannot connect to local MongoDB at mongodb://localhost:27017');
      console.log('   Make sure local MongoDB is running');
      process.exit(1);
    }

    console.log('✅ Connected to local MongoDB');
    console.log('✅ Connected to Atlas MongoDB');

    // List all local collections
    const localDB = localConnection.db;
    if (!localDB) {
      throw new Error('Failed to access local database');
    }

    const localCollections = await localDB.listCollections().toArray();
    const collectionNames = localCollections.map(c => c.name).filter(name => !name.startsWith('system.'));

    console.log(`\n📋 Found ${collectionNames.length} collections to migrate:`);
    collectionNames.forEach((name, i) => {
      console.log(`   ${i + 1}. ${name}`);
    });

    // Migrate each collection
    for (const collectionName of collectionNames) {
      await migrateCollection(collectionName);
    }

    console.log('\n✅ Migration complete!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    try {
      await localConnection.close();
      await atlasConnection.close();
    } catch (e) {
      console.log('Connection closed');
    }
  }
}

main();
