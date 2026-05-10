import { closeMongo, connectMongo } from './mongodb.js';
import { hashPassword } from './auth.js';

const email = process.env.ADMIN_EMAIL || 'admin@gmail.com';
const password = process.env.ADMIN_PASSWORD || 'Admin@123';
const fullName = process.env.ADMIN_FULL_NAME || 'Admin User';

const seedAdmin = async () => {
  const db = await connectMongo();
  const users = db.collection('users');
  const now = new Date();

  await users.createIndex({ email: 1 }, { unique: true });

  const result = await users.updateOne(
    { email: email.toLowerCase() },
    {
      $set: {
        email: email.toLowerCase(),
        password_hash: await hashPassword(password),
        full_name: fullName,
        role: 'admin',
        status: 'active',
        updated_at: now,
      },
      $setOnInsert: {
        created_at: now,
      },
    },
    { upsert: true },
  );

  const action = result.upsertedId ? 'created' : 'updated';
  console.log(`Admin user ${action}: ${email.toLowerCase()}`);
};

seedAdmin()
  .then(async () => {
    await closeMongo();
  })
  .catch(async (error) => {
    const message = error instanceof Error ? error.message : 'Failed to seed admin user.';
    console.error(message);
    await closeMongo();
    process.exit(1);
  });
