import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();
const uri = process.env.MONGODB_URI || '';
let client = null;
let db = null;
export const connectMongo = async () => {
    if (!uri) {
        throw new Error('MONGODB_URI is not configured.');
    }
    if (db) {
        return db;
    }
    client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5_000,
    });
    await client.connect();
    db = client.db('servicehub');
    return db;
};
export const getMongoDb = async () => {
    return connectMongo();
};
export const closeMongo = async () => {
    if (!client) {
        return;
    }
    await client.close();
    client = null;
    db = null;
};
//# sourceMappingURL=mongodb.js.map