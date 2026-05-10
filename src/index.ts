import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { ObjectId } from 'mongodb';
import { closeMongo, connectMongo, getMongoDb } from './mongodb.js';
import { hashPassword, signToken, verifyPassword, verifyToken } from './auth.js';

dotenv.config();

type AppRole = 'admin' | 'manager' | 'employee';
type UserStatus = 'active' | 'inactive';

type AppUser = {
  _id?: ObjectId;
  email: string;
  password_hash: string;
  full_name: string;
  role: AppRole;
  status: UserStatus;
  phone?: string;
  bio?: string;
  created_at: Date;
  updated_at: Date;
};

type AuthRequest = Request & {
  user?: AppUser;
};

const app: Express = express();
const port = process.env.PORT || 5000;
const allowedRoles: AppRole[] = ['admin', 'manager', 'employee'];
const allowedStatuses: UserStatus[] = ['active', 'inactive'];

app.use(cors());
app.use(express.json());

const publicUser = (user: AppUser) => ({
  id: user._id?.toString() || '',
  email: user.email,
  full_name: user.full_name,
  role: user.role,
  status: user.status,
  phone: user.phone || '',
  bio: user.bio || '',
  created_at: user.created_at,
  updated_at: user.updated_at,
});

const usersCollection = async () => {
  const db = await getMongoDb();
  return db.collection<AppUser>('users');
};

const itemsCollection = async () => {
  const db = await getMongoDb();
  return db.collection('items');
};

const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  try {
    const payload = verifyToken(token);
    const users = await usersCollection();
    const user = await users.findOne({ _id: new ObjectId(payload.sub) });

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: User not found' });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({ error: 'Forbidden: User account is inactive' });
    }

    req.user = user;
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid token';
    res.status(401).json({ error: `Unauthorized: ${message}` });
  }
};

const requireRole = (roles: AppRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const userRole = req.user?.role;

    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }

    next();
  };
};

app.get('/', (_req: Request, res: Response) => {
  res.send('ServiceHub API');
});

app.get('/api/db/health', async (_req: Request, res: Response) => {
  try {
    const db = await getMongoDb();
    await db.command({ ping: 1 });
    res.json({ connected: true, database: db.databaseName });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MongoDB connection failed.';
    res.status(500).json({ connected: false, error: message });
  }
});

app.post('/api/auth/bootstrap', async (req: Request, res: Response) => {
  const users = await usersCollection();
  const existingUsers = await users.countDocuments();

  if (existingUsers > 0) {
    return res.status(409).json({ error: 'Bootstrap is disabled after the first user is created.' });
  }

  const { email, password, full_name } = req.body;

  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'email, password, and full_name are required.' });
  }

  const now = new Date();
  const passwordHash = await hashPassword(password);
  const result = await users.insertOne({
    email: String(email).toLowerCase(),
    password_hash: passwordHash,
    full_name,
    role: 'admin',
    status: 'active',
    created_at: now,
    updated_at: now,
  });

  const user = await users.findOne({ _id: result.insertedId });

  if (!user) {
    return res.status(500).json({ error: 'Failed to create admin user.' });
  }

  const token = signToken({ sub: user._id.toString(), email: user.email, role: user.role });
  res.status(201).json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  const users = await usersCollection();
  const user = await users.findOne({ email: String(email).toLowerCase() });

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (user.status === 'inactive') {
    return res.status(403).json({ error: 'User account is inactive.' });
  }

  const token = signToken({ sub: user._id.toString(), email: user.email, role: user.role });
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/change-password', requireAuth, async (req: AuthRequest, res: Response) => {
  const { password } = req.body;

  if (!req.user?._id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const users = await usersCollection();
  await users.updateOne(
    { _id: req.user._id },
    { $set: { password_hash: await hashPassword(password), updated_at: new Date() } },
  );

  res.json({ ok: true });
});

app.get('/api/profile', requireAuth, async (req: AuthRequest, res: Response) => {
  if (!req.user?._id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.json(publicUser(req.user));
});

app.put('/api/profile', requireAuth, async (req: AuthRequest, res: Response) => {
  if (!req.user?._id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { full_name, phone, bio } = req.body;
  const users = await usersCollection();
  const updatedAt = new Date();

  await users.updateOne(
    { _id: req.user._id },
    {
      $set: {
        full_name: full_name || req.user.full_name,
        phone: phone || '',
        bio: bio || '',
        updated_at: updatedAt,
      },
    },
  );

  const user = await users.findOne({ _id: req.user._id });
  res.json(user ? publicUser(user) : publicUser(req.user));
});

app.get('/api/users', requireAuth, requireRole(['admin']), async (_req: AuthRequest, res: Response) => {
  const users = await usersCollection();
  const data = await users
    .find({}, { projection: { password_hash: 0 } })
    .sort({ created_at: -1 })
    .toArray();

  res.json(data.map((user) => ({
    ...user,
    id: user._id.toString(),
    _id: undefined,
  })));
});

app.post('/api/users', requireAuth, requireRole(['admin']), async (req: Request, res: Response) => {
  const { email, password, full_name } = req.body;
  const role = req.body.role as AppRole;

  if (!email || !password || !full_name || !allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'email, password, full_name, and a valid role are required.' });
  }

  const users = await usersCollection();
  const existingUser = await users.findOne({ email: String(email).toLowerCase() });

  if (existingUser) {
    return res.status(409).json({ error: 'A user with this email already exists.' });
  }

  const now = new Date();
  const result = await users.insertOne({
    email: String(email).toLowerCase(),
    password_hash: await hashPassword(password),
    full_name,
    role,
    status: 'active',
    created_at: now,
    updated_at: now,
  });
  const user = await users.findOne({ _id: result.insertedId });

  if (!user) {
    return res.status(500).json({ error: 'Failed to create user.' });
  }

  res.status(201).json(publicUser(user));
});

app.patch('/api/users/:id', requireAuth, requireRole(['admin']), async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { full_name, role, status } = req.body;
  const updates: Partial<Pick<AppUser, 'full_name' | 'role' | 'status' | 'updated_at'>> = {
    updated_at: new Date(),
  };

  if (full_name) updates.full_name = full_name;
  if (role && allowedRoles.includes(role)) updates.role = role;
  if (status && allowedStatuses.includes(status)) updates.status = status;

  const users = await usersCollection();
  await users.updateOne({ _id: new ObjectId(id) }, { $set: updates });
  const user = await users.findOne({ _id: new ObjectId(id) });

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  res.json(publicUser(user));
});

app.get('/api/items', requireAuth, async (_req: Request, res: Response) => {
  const items = await itemsCollection();
  const data = await items.find({}).sort({ created_at: -1 }).toArray();

  res.json(data.map((item) => ({
    ...item,
    id: item._id.toString(),
    _id: undefined,
  })));
});

app.post('/api/items', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  const items = await itemsCollection();
  const now = new Date();
  const result = await items.insertOne({
    ...req.body,
    created_at: now,
    updated_at: now,
  });
  const item = await items.findOne({ _id: result.insertedId });

  res.status(201).json(item ? { ...item, id: item._id.toString(), _id: undefined } : null);
});

app.put('/api/items/:id', requireAuth, requireRole(['admin', 'manager', 'employee']), async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const updates = req.body;

  if (req.user?.role === 'employee' && Object.keys(updates).some((key) => key !== 'quantity')) {
    return res.status(403).json({ error: 'Employees can only update quantity.' });
  }

  const items = await itemsCollection();
  await items.updateOne(
    { _id: new ObjectId(id) },
    { $set: { ...updates, updated_at: new Date() } },
  );
  const item = await items.findOne({ _id: new ObjectId(id) });

  if (!item) {
    return res.status(404).json({ error: 'Item not found.' });
  }

  res.json({ ...item, id: item._id.toString(), _id: undefined });
});

app.delete('/api/items/:id', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const items = await itemsCollection();
  await items.deleteOne({ _id: new ObjectId(id) });

  res.status(204).send();
});

const startServer = async () => {
  const db = await connectMongo();
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  console.log(`[mongo]: Connected to database ${db.databaseName}`);

  const server = app.listen(port, () => {
    console.log(`[server]: Server is running at http://localhost:${port}`);
  });
  const keepAliveInterval = setInterval(() => undefined, 60_000);

  process.on('SIGTERM', () => {
    clearInterval(keepAliveInterval);
    server.close(async () => {
      await closeMongo();
      process.exit(0);
    });
  });
};

startServer().catch((error) => {
  const message = error instanceof Error ? error.message : 'Failed to start server.';
  console.error(`[server]: ${message}`);
  process.exit(1);
});
