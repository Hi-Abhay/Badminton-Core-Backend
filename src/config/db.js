require('dotenv').config();
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

    if (!mongoUri) {
      throw new Error('MONGO_URI is missing from your .env file.');
    }

    const conn = await mongoose.connect(mongoUri, {
      // Fails fast (5s) instead of waiting 10s for the buffering timeout
      serverSelectionTimeoutMS: 5000, 
    });

      return `MongoDB Connected: ${conn.connection.host}`

  } catch (error) {
    return `Database Connection Error: ${error.message}`
    // console.error(`Database Connection Error: ${error.message}`);
    
    // DO NOT use process.exit(1) in serverless environments like Vercel.
    // Throw the error instead so your API can catch it and return a 500 error.
    throw error;
  }
};

module.exports = connectDB;
