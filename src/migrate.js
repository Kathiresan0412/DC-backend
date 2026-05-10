import { closeMongo, connectMongo } from './mongodb.js';
const migrate = async () => {
    const db = await connectMongo();
    await db.createCollection('users').catch((error) => {
        if (error instanceof Error && error.message.includes('already exists')) {
            return;
        }
        throw error;
    });
    await db.createCollection('items').catch((error) => {
        if (error instanceof Error && error.message.includes('already exists')) {
            return;
        }
        throw error;
    });
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ role: 1 });
    await db.collection('users').createIndex({ status: 1 });
    await db.collection('items').createIndex({ created_at: -1 });
    console.log(`Database migrated: ${db.databaseName}`);
};
migrate()
    .then(async () => {
    await closeMongo();
})
    .catch(async (error) => {
    const message = error instanceof Error ? error.message : 'Failed to migrate database.';
    console.error(message);
    await closeMongo();
    process.exit(1);
});
//# sourceMappingURL=migrate.js.map