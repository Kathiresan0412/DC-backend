import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { supabase } from './supabase.js';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Middleware to check authentication using Supabase JWT
const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  // Fetch user role from profiles table (assuming profiles table has user_id and role)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  (req as any).user = { ...user, role: profile?.role || 'staff' };
  next();
};

const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = (req as any).user?.role;
    if (!roles.includes(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }
    next();
  };
};

app.get('/', (req: Request, res: Response) => {
  res.send('Inventory Management API');
});

// --- API Routes ---

// Get all inventory items
app.get('/api/items', requireAuth, async (req: Request, res: Response) => {
  const { data, error } = await supabase.from('items').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Add new item (Manager, Admin only)
app.post('/api/items', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  const { name, sku, quantity, price, category_id } = req.body;
  const { data, error } = await supabase.from('items').insert([{ name, sku, quantity, price, category_id }]).select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// Update item
app.put('/api/items/:id', requireAuth, requireRole(['admin', 'manager', 'staff']), async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body;
  
  // Staff might only be allowed to update quantity. We can enforce it here if needed.
  const userRole = (req as any).user.role;
  if (userRole === 'staff' && Object.keys(updates).some(k => k !== 'quantity')) {
    return res.status(403).json({ error: 'Staff can only update quantity.' });
  }

  const { data, error } = await supabase.from('items').update(updates).eq('id', id).select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Delete item
app.delete('/api/items/:id', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send();
});

// Start the server
app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
