import { closeMongo, connectMongo } from './mongodb.js';
const collections = [
    'users',
    'items',
    'businesses',
    'services',
    'customers',
    'invoices',
    'payments',
    'categories',
];
const createCollectionIfMissing = async (db, collectionName) => {
    await db.createCollection(collectionName).catch((error) => {
        if (error instanceof Error && error.message.includes('already exists')) {
            return;
        }
        throw error;
    });
};
const migrate = async () => {
    const db = await connectMongo();
    await Promise.all(collections.map((collectionName) => createCollectionIfMissing(db, collectionName)));
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ role: 1 });
    await db.collection('users').createIndex({ status: 1 });
    await db.collection('items').createIndex({ created_at: -1 });
    await db.collection('items').createIndex({ category: 1 });
    await db.collection('items').createIndex({ status: 1 });
    await db.collection('businesses').createIndex({ key: 1 }, { unique: true });
    await db.collection('businesses').createIndex({ name: 1 }, { unique: true });
    await db.collection('services').createIndex({ name: 1, business: 1 }, { unique: true });
    await db.collection('services').createIndex({ business: 1 });
    await db.collection('customers').createIndex({ customer_id: 1 }, { unique: true });
    await db.collection('customers').createIndex({ email: 1 });
    await db.collection('customers').createIndex({ business: 1 });
    await db.collection('customers').createIndex({ status: 1 });
    await db.collection('invoices').createIndex({ invoice_id: 1 }, { unique: true });
    await db.collection('invoices').createIndex({ customer: 1 });
    await db.collection('invoices').createIndex({ business: 1 });
    await db.collection('invoices').createIndex({ status: 1 });
    await db.collection('invoices').createIndex({ due_at: 1 });
    await db.collection('payments').createIndex({ payment_id: 1 }, { unique: true });
    await db.collection('payments').createIndex({ invoice_id: 1 });
    await db.collection('payments').createIndex({ customer: 1 });
    await db.collection('payments').createIndex({ business: 1 });
    await db.collection('payments').createIndex({ paid_at: -1 });
    await db.collection('categories').createIndex({ slug: 1 }, { unique: true });
    await db.collection('categories').createIndex({ name: 1 }, { unique: true });
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