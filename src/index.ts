import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { ObjectId } from 'mongodb';
import { createRequire } from 'node:module';
import { closeMongo, connectMongo, getMongoDb } from './mongodb.js';
import { hashPassword, signToken, verifyPassword, verifyToken } from './auth.js';

dotenv.config();

const require = createRequire(import.meta.url);
const nodemailer = require('nodemailer') as {
  createTransport: (options: Record<string, unknown>) => {
    sendMail: (message: Record<string, unknown>) => Promise<unknown>;
  };
};

type AppRole = 'admin' | 'manager' | 'employee';
type UserStatus = 'active' | 'inactive';
type CustomerStatus = 'Active' | 'Due' | 'New lead';
type ServiceStatus = 'Active' | 'Inactive';
type InvoiceStatus = 'Draft' | 'Sent' | 'Confirmed' | 'Paid' | 'Due' | 'Overdue';

type AppUser = {
  _id?: ObjectId;
  email: string;
  password_hash: string;
  full_name: string;
  role: AppRole;
  status: UserStatus;
  phone?: string;
  bio?: string;
  avatar_url?: string;
  created_at: Date;
  updated_at: Date;
};

type AuthRequest = Request & {
  user?: AppUser;
};

type AppCustomer = {
  _id?: ObjectId;
  name: string;
  email: string;
  phone: string;
  address: string;
  business: string;
  plan: string;
  status: CustomerStatus;
  balance: number;
  lastService: string;
  created_at: Date;
  updated_at: Date;
};

type AppService = {
  _id?: ObjectId;
  name: string;
  business: string;
  category: string;
  description: string;
  price: number;
  billing: string;
  status: ServiceStatus;
  includes: string[];
  trustPoints: string[];
  serviceArea: string;
  contactPhone: string;
  secondaryPhone: string;
  email: string;
  imageUrl?: string;
  source: string;
  created_at: Date;
  updated_at: Date;
};

type EmailLog = {
  type: 'invoice' | 'payment_slip';
  to: string;
  subject: string;
  body: string;
  sent_at: Date;
};

type ProofPayment = {
  payment_id?: string;
  method?: string;
  totalAmount: number;
  paidAmount: number;
  receivableAmount: number;
  generated_at: Date;
  notes?: string;
};

type AppInvoice = {
  _id?: ObjectId;
  invoice_id: string;
  customerId: string;
  customer: string;
  email: string;
  business: string;
  serviceId: string;
  service: string;
  issued: string;
  due: string;
  amount: number;
  paid: number;
  receivable: number;
  status: InvoiceStatus;
  agreementLink: string;
  feedback: string;
  confirmed_at?: Date;
  proofPayment?: ProofPayment;
  proofPayments?: ProofPayment[];
  emails: EmailLog[];
  created_at: Date;
  updated_at: Date;
};

type AppPayment = {
  _id?: ObjectId;
  payment_id: string;
  invoiceId: string;
  invoice_id: string;
  customerId: string;
  customer: string;
  email: string;
  business: string;
  service: string;
  method: string;
  amount: number;
  paid_at: Date;
  date: string;
  notes: string;
  created_at: Date;
  updated_at: Date;
};

type InvoicePaymentLine = {
  label: string;
  method: string;
  amount: number;
  paid_at: Date;
  date: string;
  notes?: string;
  receivableAfterPayment: number;
};

type ActivityActor = {
  id: string;
  name: string;
  email: string;
  role: AppRole | 'customer' | 'system';
};

type ActivityEntityType = 'auth' | 'profile' | 'user' | 'item' | 'customer' | 'service' | 'invoice' | 'payment';

type AppActivityLog = {
  _id?: ObjectId;
  action: string;
  entityType: ActivityEntityType;
  entityId: string;
  entityLabel: string;
  summary: string;
  details: Record<string, unknown>;
  actor: ActivityActor;
  business?: string;
  customerId?: string;
  invoiceId?: string;
  paymentId?: string;
  serviceId?: string;
  targetUserId?: string;
  created_at: Date;
};

const app: Express = express();
const port = process.env.PORT || 5000;
const allowedRoles: AppRole[] = ['admin', 'manager', 'employee'];
const allowedStatuses: UserStatus[] = ['active', 'inactive'];
const allowedCustomerStatuses: CustomerStatus[] = ['Active', 'Due', 'New lead'];
const allowedServiceStatuses: ServiceStatus[] = ['Active', 'Inactive'];
const allowedInvoiceStatuses: InvoiceStatus[] = ['Draft', 'Sent', 'Confirmed', 'Paid', 'Due', 'Overdue'];

const getEnv = (name: string, fallback: string) => (process.env[name] || fallback).trim();

const getPublicAppName = () => getEnv('PUBLIC_APP_NAME', 'Primozen');

const businessDetailsFor = (business: string) => {
  const isFrozen = business === 'Frozen Solution';

  return {
    name: business,
    email: isFrozen ? getEnv('FROZEN_SOLUTION_EMAIL', 'frozensolutions92@gmail.com') : getEnv('PRIMECUT_SERVICES_EMAIL', 'freshcutservices92@gmail.com'),
    phone: isFrozen ? getEnv('FROZEN_SOLUTION_PHONE', '+1 647-212-3424') : getEnv('PRIMECUT_SERVICES_PHONE', '+1 647-765-0949'),
    secondaryPhone: isFrozen ? getEnv('FROZEN_SOLUTION_SECONDARY_PHONE', '+1 647-854-5652') : getEnv('PRIMECUT_SERVICES_SECONDARY_PHONE', '+1 647-854-5652'),
    serviceArea: isFrozen ? getEnv('FROZEN_SOLUTION_SERVICE_AREA', 'Residential driveway & sidewalk') : getEnv('PRIMECUT_SERVICES_SERVICE_AREA', 'Residential driveway & yard'),
  };
};

const flyerTrustPoints = [
  'Complete & modern equipment',
  'Competitive & affordable price',
  'Service available 24/7',
  'Residential & commercial service',
];

const initialServices: Omit<AppService, '_id' | 'created_at' | 'updated_at'>[] = [
  {
    name: 'Snow Blowing',
    business: 'Frozen Solution',
    category: 'Snow Removal',
    description: 'Residential driveway and sidewalk snow blowing service from the Frozen Solution flyer.',
    price: 400,
    billing: 'Starting monthly',
    status: 'Active',
    includes: ['Silver $400 monthly', 'Gold $900 monthly', 'Residential driveway & sidewalk'],
    trustPoints: [...flyerTrustPoints, 'Serving the city since 2024'],
    serviceArea: businessDetailsFor('Frozen Solution').serviceArea,
    contactPhone: businessDetailsFor('Frozen Solution').phone,
    secondaryPhone: businessDetailsFor('Frozen Solution').secondaryPhone,
    email: businessDetailsFor('Frozen Solution').email,
    source: 'Snow Removal Service flyer',
  },
  {
    name: 'Snow Plowing',
    business: 'Frozen Solution',
    category: 'Snow Removal',
    description: 'Snow plowing service with modern equipment for residential and commercial properties.',
    price: 400,
    billing: 'Starting monthly',
    status: 'Active',
    includes: ['Silver $400 monthly', 'Gold $900 monthly', 'Residential & commercial service'],
    trustPoints: [...flyerTrustPoints, 'Serving the city since 2024'],
    serviceArea: businessDetailsFor('Frozen Solution').serviceArea,
    contactPhone: businessDetailsFor('Frozen Solution').phone,
    secondaryPhone: businessDetailsFor('Frozen Solution').secondaryPhone,
    email: businessDetailsFor('Frozen Solution').email,
    source: 'Snow Removal Service flyer',
  },
  {
    name: 'Snow Shoveling',
    business: 'Frozen Solution',
    category: 'Snow Removal',
    description: 'Manual snow shoveling for walkways, driveways, and service areas.',
    price: 400,
    billing: 'Starting monthly',
    status: 'Active',
    includes: ['Silver $400 monthly', 'Gold $900 monthly', 'Residential driveway & sidewalk'],
    trustPoints: [...flyerTrustPoints, 'Serving the city since 2024'],
    serviceArea: businessDetailsFor('Frozen Solution').serviceArea,
    contactPhone: businessDetailsFor('Frozen Solution').phone,
    secondaryPhone: businessDetailsFor('Frozen Solution').secondaryPhone,
    email: businessDetailsFor('Frozen Solution').email,
    source: 'Snow Removal Service flyer',
  },
  {
    name: 'Ice Removal',
    business: 'Frozen Solution',
    category: 'Snow Removal',
    description: 'Ice removal service for safer residential and commercial access.',
    price: 400,
    billing: 'Starting monthly',
    status: 'Active',
    includes: ['Silver $400 monthly', 'Gold $900 monthly', 'Service available 24/7'],
    trustPoints: [...flyerTrustPoints, 'Serving the city since 2024'],
    serviceArea: businessDetailsFor('Frozen Solution').serviceArea,
    contactPhone: businessDetailsFor('Frozen Solution').phone,
    secondaryPhone: businessDetailsFor('Frozen Solution').secondaryPhone,
    email: businessDetailsFor('Frozen Solution').email,
    source: 'Snow Removal Service flyer',
  },
  {
    name: 'Salting/Sanding',
    business: 'Frozen Solution',
    category: 'Snow Removal',
    description: 'Salting and sanding service to improve traction after snow or ice events.',
    price: 400,
    billing: 'Starting monthly',
    status: 'Active',
    includes: ['Silver $400 monthly', 'Gold $900 monthly', 'Residential & commercial service'],
    trustPoints: [...flyerTrustPoints, 'Serving the city since 2024'],
    serviceArea: businessDetailsFor('Frozen Solution').serviceArea,
    contactPhone: businessDetailsFor('Frozen Solution').phone,
    secondaryPhone: businessDetailsFor('Frozen Solution').secondaryPhone,
    email: businessDetailsFor('Frozen Solution').email,
    source: 'Snow Removal Service flyer',
  },
  {
    name: 'Lawn Mowing',
    business: 'Primecut Services',
    category: 'Fresh Cut Services',
    description: 'Fresh cut lawn mowing service from the Primecut Services flyer.',
    price: 50,
    billing: 'Starting price',
    status: 'Active',
    includes: ['Residential driveway & yard'],
    trustPoints: flyerTrustPoints,
    serviceArea: businessDetailsFor('Primecut Services').serviceArea,
    contactPhone: businessDetailsFor('Primecut Services').phone,
    secondaryPhone: businessDetailsFor('Primecut Services').secondaryPhone,
    email: businessDetailsFor('Primecut Services').email,
    source: 'Fresh Cut Services flyer',
  },
  {
    name: 'Edging',
    business: 'Primecut Services',
    category: 'Fresh Cut Services',
    description: 'Lawn edging for clean borders and finished property lines.',
    price: 50,
    billing: 'Starting price',
    status: 'Active',
    includes: ['Residential driveway & yard'],
    trustPoints: flyerTrustPoints,
    serviceArea: businessDetailsFor('Primecut Services').serviceArea,
    contactPhone: businessDetailsFor('Primecut Services').phone,
    secondaryPhone: businessDetailsFor('Primecut Services').secondaryPhone,
    email: businessDetailsFor('Primecut Services').email,
    source: 'Fresh Cut Services flyer',
  },
  {
    name: 'Lawn Cleanup',
    business: 'Primecut Services',
    category: 'Fresh Cut Services',
    description: 'General lawn cleanup for residential yards and driveway areas.',
    price: 50,
    billing: 'Starting price',
    status: 'Active',
    includes: ['Residential driveway & yard'],
    trustPoints: flyerTrustPoints,
    serviceArea: businessDetailsFor('Primecut Services').serviceArea,
    contactPhone: businessDetailsFor('Primecut Services').phone,
    secondaryPhone: businessDetailsFor('Primecut Services').secondaryPhone,
    email: businessDetailsFor('Primecut Services').email,
    source: 'Fresh Cut Services flyer',
  },
  {
    name: 'Fertilization & Weed Control',
    business: 'Primecut Services',
    category: 'Fresh Cut Services',
    description: 'Fertilization and weed control service for healthier lawn care.',
    price: 50,
    billing: 'Starting price',
    status: 'Active',
    includes: ['Residential driveway & yard'],
    trustPoints: flyerTrustPoints,
    serviceArea: businessDetailsFor('Primecut Services').serviceArea,
    contactPhone: businessDetailsFor('Primecut Services').phone,
    secondaryPhone: businessDetailsFor('Primecut Services').secondaryPhone,
    email: businessDetailsFor('Primecut Services').email,
    source: 'Fresh Cut Services flyer',
  },
];

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const publicUser = (user: AppUser) => ({
  id: user._id?.toString() || '',
  email: user.email,
  full_name: user.full_name,
  role: user.role,
  status: user.status,
  phone: user.phone || '',
  bio: user.bio || '',
  avatar_url: user.avatar_url || '',
  created_at: user.created_at,
  updated_at: user.updated_at,
});

const isValidImageDataUrl = (value: string) => {
  if (!value) return true;
  if (value.length > 1_400_000) return false;

  return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value);
};

const usersCollection = async () => {
  const db = await getMongoDb();
  return db.collection<AppUser>('users');
};

const itemsCollection = async () => {
  const db = await getMongoDb();
  return db.collection('items');
};

const customersCollection = async () => {
  const db = await getMongoDb();
  return db.collection<AppCustomer>('customers');
};

const servicesCollection = async () => {
  const db = await getMongoDb();
  return db.collection<AppService>('services');
};

const invoicesCollection = async () => {
  const db = await getMongoDb();
  return db.collection<AppInvoice>('invoices');
};

const paymentsCollection = async () => {
  const db = await getMongoDb();
  return db.collection<AppPayment>('payments');
};

const activityLogsCollection = async () => {
  const db = await getMongoDb();
  return db.collection<AppActivityLog>('activity_logs');
};

const dropIndexIfExists = async (collection: { dropIndex: (indexName: string) => Promise<unknown> }, indexName: string) => {
  await collection.dropIndex(indexName).catch((error: unknown) => {
    if (error instanceof Error && (error.message.includes('index not found') || error.message.includes('index does not exist'))) {
      return;
    }

    throw error;
  });
};

const publicCustomer = (customer: AppCustomer) => ({
  ...customer,
  id: customer._id?.toString() || '',
  _id: undefined,
});

const publicService = (service: AppService) => ({
  ...service,
  id: service._id?.toString() || '',
  _id: undefined,
  imageUrl: service.imageUrl || '',
});

const publicInvoice = (invoice: AppInvoice) => ({
  ...invoice,
  id: invoice._id?.toString() || '',
  _id: undefined,
});

const publicPayment = (payment: AppPayment) => ({
  ...payment,
  id: payment._id?.toString() || '',
  _id: undefined,
});

const paymentProofHistoryForInvoice = async (invoice: AppInvoice): Promise<ProofPayment[]> => {
  const payments = await paymentsCollection();
  const invoicePayments = await payments
    .find({ invoice_id: invoice.invoice_id })
    .sort({ paid_at: 1, created_at: 1 })
    .toArray();

  const totalPaymentAmount = invoicePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  let runningPaid = Math.max(Number(invoice.paid || 0) - totalPaymentAmount, 0);

  const proofPayments = invoicePayments.map((payment) => {
    const paidAmount = Number(payment.amount || 0);
    runningPaid = Math.min(runningPaid + paidAmount, invoice.amount);

    return {
      payment_id: payment.payment_id,
      method: payment.method,
      totalAmount: invoice.amount,
      paidAmount,
      receivableAmount: Math.max(invoice.amount - runningPaid, 0),
      generated_at: payment.paid_at,
      notes: payment.notes,
    };
  }).reverse();

  return proofPayments.length ? proofPayments : (invoice.proofPayment && invoice.proofPayment.paidAmount > 0 ? [invoice.proofPayment] : []);
};

const publicInvoiceWithPaymentHistory = async (invoice: AppInvoice) => (
  publicInvoice({
    ...invoice,
    proofPayments: await paymentProofHistoryForInvoice(invoice),
  })
);

const publicActivityLog = (log: AppActivityLog) => ({
  ...log,
  id: log._id?.toString() || '',
  _id: undefined,
});

const actorFromUser = (user?: AppUser): ActivityActor => ({
  id: user?._id?.toString() || 'system',
  name: user?.full_name || 'System',
  email: user?.email || '',
  role: user?.role || 'system',
});

const hiddenActivityActions = ['signed_in', 'signed_out'];

const writeActivityLog = async ({
  req,
  actor,
  action,
  entityType,
  entityId,
  entityLabel,
  summary,
  details = {},
  business,
  customerId,
  invoiceId,
  paymentId,
  serviceId,
  targetUserId,
}: {
  req?: AuthRequest;
  actor?: ActivityActor;
  action: string;
  entityType: ActivityEntityType;
  entityId: string;
  entityLabel: string;
  summary: string;
  details?: Record<string, unknown>;
  business?: string | undefined;
  customerId?: string | undefined;
  invoiceId?: string | undefined;
  paymentId?: string | undefined;
  serviceId?: string | undefined;
  targetUserId?: string | undefined;
}) => {
  try {
    if (entityType === 'auth' || hiddenActivityActions.includes(action)) {
      return;
    }

    const logs = await activityLogsCollection();
    const log: AppActivityLog = {
      action,
      entityType,
      entityId,
      entityLabel,
      summary,
      details,
      actor: actor || actorFromUser(req?.user),
      created_at: new Date(),
    };

    if (business) log.business = business;
    if (customerId) log.customerId = customerId;
    if (invoiceId) log.invoiceId = invoiceId;
    if (paymentId) log.paymentId = paymentId;
    if (serviceId) log.serviceId = serviceId;
    if (targetUserId) log.targetUserId = targetUserId;

    await logs.insertOne(log);
  } catch (error) {
    console.error('[activity-log]: Failed to write activity log', error);
  }
};

const formatMoney = (value: number) => (
  new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 2,
  }).format(value)
);

const formatDate = (date: Date) => (
  new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
);

const getBaseUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
const getAgreementLink = (invoiceId: string) => `${getBaseUrl()}/agreements/${encodeURIComponent(invoiceId)}`;
const getLogoUrl = () => `${getBaseUrl()}/primozen-logo.png`;

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const createEmailLog = ({
  type,
  to,
  subject,
  body,
}: Omit<EmailLog, 'sent_at'>): EmailLog => ({
  type,
  to,
  subject,
  body,
  sent_at: new Date(),
});

const getSmtpTransport = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host) {
    throw new Error('SMTP_HOST is required to send invoice email.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });
};

const parseEmailAddress = (value: string) => {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] || value).trim();
};

const parseEmailName = (value: string) => {
  const match = value.match(/^([^<]+)</);
  return match?.[1]?.trim().replace(/^"|"$/g, '');
};

const sendEmail = async (email: EmailLog, html: string) => {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!from) {
    throw new Error('SMTP_FROM or SMTP_USER is required to send invoice email.');
  }

  const fromAddress = parseEmailAddress(from);
  const fromName = process.env.SMTP_FROM_NAME || parseEmailName(from) || 'Primozen';
  const transport = getSmtpTransport();

  await transport.sendMail({
    from: {
      name: fromName,
      address: fromAddress,
    },
    to: email.to,
    subject: email.subject,
    text: email.body,
    html,
    replyTo: process.env.SMTP_REPLY_TO || fromAddress,
  });
};

const invoicePaymentLines = async (invoice: AppInvoice): Promise<InvoicePaymentLine[]> => {
  const payments = await paymentsCollection();
  const invoicePayments = await payments
    .find({ invoice_id: invoice.invoice_id })
    .sort({ paid_at: 1, created_at: 1 })
    .toArray();
  const recordedPaymentTotal = invoicePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const initialPaid = Math.max(Number(invoice.paid || 0) - recordedPaymentTotal, 0);
  let runningPaid = 0;
  const lines: InvoicePaymentLine[] = [];

  if (initialPaid > 0) {
    runningPaid = Math.min(initialPaid, invoice.amount);
    lines.push({
      label: 'Initial payment',
      method: 'Initial payment',
      amount: initialPaid,
      paid_at: invoice.created_at,
      date: invoice.issued,
      receivableAfterPayment: Math.max(invoice.amount - runningPaid, 0),
    });
  }

  invoicePayments.forEach((payment) => {
    const amount = Number(payment.amount || 0);
    runningPaid = Math.min(runningPaid + amount, invoice.amount);
    lines.push({
      label: payment.payment_id,
      method: payment.method,
      amount,
      paid_at: payment.paid_at,
      date: payment.date,
      notes: payment.notes,
      receivableAfterPayment: Math.max(invoice.amount - runningPaid, 0),
    });
  });

  return lines;
};

const invoiceEmailText = (invoice: AppInvoice, paymentLines: InvoicePaymentLine[], agreementLink: string) => {
  const paymentHistory = paymentLines.length
    ? paymentLines.map((payment, index) => (
      `${index + 1}. ${payment.label} - ${payment.date} - ${payment.method} - ${formatMoney(payment.amount)} - Balance after: ${formatMoney(payment.receivableAfterPayment)}`
    )).join('\n')
    : 'No previous payments recorded.';

  return [
    `Hello ${invoice.customer},`,
    `Please review invoice ${invoice.invoice_id} for ${invoice.service}.`,
    `Service: ${invoice.service}`,
    `Company: ${invoice.business}`,
    `Invoice status: ${invoice.status}`,
    `Issued date: ${invoice.issued}`,
    `Due date: ${invoice.due}`,
    `Total amount: ${formatMoney(invoice.amount)}`,
    `Total paid: ${formatMoney(invoice.paid)}`,
    `Pending balance: ${formatMoney(invoice.receivable)}`,
    `Payment history:\n${paymentHistory}`,
    invoice.receivable > 0 ? `Please pay the pending balance of ${formatMoney(invoice.receivable)}.` : 'This invoice is fully paid.',
    `View invoice and payment history: ${agreementLink}`,
  ].join('\n\n');
};

const invoiceEmailHtml = (invoice: AppInvoice, service: AppService | null, paymentLines: InvoicePaymentLine[], agreementLink: string) => {
  const company = businessDetailsFor(invoice.business);
  const paymentRows = paymentLines.length
    ? paymentLines.map((payment, index) => `
      <tr>
        <td style="border-top:1px solid #e5e7eb;padding:10px 8px;color:#111827">${index + 1}</td>
        <td style="border-top:1px solid #e5e7eb;padding:10px 8px;color:#111827">${escapeHtml(payment.date)}</td>
        <td style="border-top:1px solid #e5e7eb;padding:10px 8px;color:#111827">${escapeHtml(payment.label)}</td>
        <td style="border-top:1px solid #e5e7eb;padding:10px 8px;color:#111827">${escapeHtml(payment.method)}</td>
        <td style="border-top:1px solid #e5e7eb;padding:10px 8px;text-align:right;color:#111827">${formatMoney(payment.amount)}</td>
        <td style="border-top:1px solid #e5e7eb;padding:10px 8px;text-align:right;color:#111827">${formatMoney(payment.receivableAfterPayment)}</td>
      </tr>
    `).join('')
    : `
      <tr>
        <td colspan="6" style="border-top:1px solid #e5e7eb;padding:12px 8px;color:#6b7280">No previous payments recorded.</td>
      </tr>
    `;
  const serviceIncludes = service?.includes?.length
    ? `<p style="margin:8px 0 0;color:#374151"><strong>Includes:</strong> ${service.includes.map(escapeHtml).join(', ')}</p>`
    : '';

  return `
    <div style="margin:0;background:#f3f4f6;padding:24px 0;font-family:Arial,sans-serif;color:#111827">
      <div style="margin:0 auto;max-width:720px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="padding:24px;border-bottom:1px solid #e5e7eb">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <img src="${getLogoUrl()}" alt="Primozen" style="display:block;width:148px;max-width:148px;height:auto;margin-bottom:16px">
                <h1 style="margin:0;font-size:24px;line-height:1.25;color:#111827">Invoice ${escapeHtml(invoice.invoice_id)}</h1>
                <p style="margin:6px 0 0;color:#6b7280">${escapeHtml(invoice.business)} - ${escapeHtml(invoice.service)}</p>
              </td>
              <td align="right" style="vertical-align:top;color:#6b7280;font-size:13px">
                <strong style="color:#111827">${escapeHtml(company.name)}</strong><br>
                ${escapeHtml(company.email)}<br>
                ${escapeHtml(company.phone)}<br>
                ${escapeHtml(company.secondaryPhone)}
              </td>
            </tr>
          </table>
        </div>

        <div style="padding:24px">
          <p style="margin:0 0 16px;color:#374151">Hello ${escapeHtml(invoice.customer)}, please review this bill and the payment history saved for this invoice. The button below is only for viewing the invoice and previous payments.</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse">
            <tr>
              <td style="width:50%;padding:14px;background:#f9fafb;border:1px solid #e5e7eb">
                <p style="margin:0;color:#6b7280;font-size:12px;text-transform:uppercase">Bill to</p>
                <p style="margin:6px 0 0;font-weight:700">${escapeHtml(invoice.customer)}</p>
                <p style="margin:3px 0 0;color:#374151">${escapeHtml(invoice.email)}</p>
              </td>
              <td style="width:50%;padding:14px;background:#f9fafb;border:1px solid #e5e7eb">
                <p style="margin:0;color:#6b7280;font-size:12px;text-transform:uppercase">Invoice dates</p>
                <p style="margin:6px 0 0;color:#374151">Issued: <strong>${escapeHtml(invoice.issued)}</strong></p>
                <p style="margin:3px 0 0;color:#374151">Due: <strong>${escapeHtml(invoice.due)}</strong></p>
                <p style="margin:3px 0 0;color:#374151">Status: <strong>${escapeHtml(invoice.status)}</strong></p>
              </td>
            </tr>
          </table>

          <h2 style="margin:0 0 10px;font-size:16px;color:#111827">Company Details</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse">
            <tr>
              <td style="padding:14px;border:1px solid #e5e7eb;background:#ffffff">
                <p style="margin:0;font-weight:700">${escapeHtml(company.name)}</p>
                <p style="margin:6px 0 0;color:#374151">Email: ${escapeHtml(company.email)}</p>
                <p style="margin:3px 0 0;color:#374151">Primary phone: ${escapeHtml(company.phone)}</p>
                <p style="margin:3px 0 0;color:#374151">Secondary phone: ${escapeHtml(company.secondaryPhone)}</p>
                <p style="margin:3px 0 0;color:#374151">Service area: ${escapeHtml(service?.serviceArea || company.serviceArea)}</p>
              </td>
            </tr>
          </table>

          <h2 style="margin:0 0 10px;font-size:16px;color:#111827">Service Details</h2>
          <div style="border:1px solid #e5e7eb;border-radius:6px;padding:14px;margin-bottom:20px">
            <p style="margin:0;font-weight:700">${escapeHtml(invoice.service)}</p>
            <p style="margin:6px 0 0;color:#374151">${escapeHtml(service?.description || `${invoice.service} from ${invoice.business}`)}</p>
            <p style="margin:8px 0 0;color:#374151"><strong>Service area:</strong> ${escapeHtml(service?.serviceArea || company.serviceArea)}</p>
            <p style="margin:8px 0 0;color:#374151"><strong>Billing:</strong> ${escapeHtml(service?.billing || 'Invoice')}</p>
            ${serviceIncludes}
          </div>

          <h2 style="margin:0 0 10px;font-size:16px;color:#111827">Payment Summary</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px">
            <tr>
              <td style="padding:12px;border:1px solid #e5e7eb;background:#f9fafb;color:#6b7280">Total</td>
              <td style="padding:12px;border:1px solid #e5e7eb;text-align:right;font-weight:700">${formatMoney(invoice.amount)}</td>
            </tr>
            <tr>
              <td style="padding:12px;border:1px solid #e5e7eb;background:#f9fafb;color:#6b7280">Previous payments</td>
              <td style="padding:12px;border:1px solid #e5e7eb;text-align:right;font-weight:700">${formatMoney(invoice.paid)}</td>
            </tr>
            <tr>
              <td style="padding:12px;border:1px solid #e5e7eb;background:#fef3c7;color:#92400e">Pending balance</td>
              <td style="padding:12px;border:1px solid #e5e7eb;text-align:right;font-size:18px;font-weight:800;color:#92400e">${formatMoney(invoice.receivable)}</td>
            </tr>
          </table>

          <h2 style="margin:0 0 10px;font-size:16px;color:#111827">Invoice Notes</h2>
          <div style="border:1px solid #e5e7eb;border-radius:6px;padding:14px;margin-bottom:20px;color:#374151">
            <p style="margin:0">This email shows the invoice total, all saved payments for this invoice, and the remaining balance. Viewing the invoice does not record a new payment or change the paid amount.</p>
          </div>

          <h2 style="margin:0 0 10px;font-size:16px;color:#111827">Previous Payments</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;font-size:13px">
            <thead>
              <tr>
                <th align="left" style="padding:8px;color:#6b7280">#</th>
                <th align="left" style="padding:8px;color:#6b7280">Date</th>
                <th align="left" style="padding:8px;color:#6b7280">Payment</th>
                <th align="left" style="padding:8px;color:#6b7280">Method</th>
                <th align="right" style="padding:8px;color:#6b7280">Paid</th>
                <th align="right" style="padding:8px;color:#6b7280">Balance</th>
              </tr>
            </thead>
            <tbody>${paymentRows}</tbody>
          </table>

          ${invoice.receivable > 0 ? `
            <div style="margin:0 0 20px;padding:14px;border:1px solid #f59e0b;background:#fffbeb;border-radius:6px;color:#92400e">
              Pending amount: <strong>${formatMoney(invoice.receivable)}</strong>. Please pay the remaining balance by ${escapeHtml(invoice.due)}.
            </div>
          ` : `
            <div style="margin:0 0 20px;padding:14px;border:1px solid #10b981;background:#ecfdf5;border-radius:6px;color:#047857">
              This invoice is fully paid. No pending balance remains.
            </div>
          `}

          <p style="margin:0 0 18px;color:#374151">Open the invoice page to view the latest payment history and balance.</p>
          <a href="${agreementLink}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700">View invoice and payment history</a>
        </div>
      </div>
    </div>
  `;
};

const normalizeCustomerPayload = (body: Record<string, unknown>, partial = false) => {
  const updates: Partial<AppCustomer> = {};

  const assignString = (field: keyof Pick<AppCustomer, 'name' | 'email' | 'phone' | 'address' | 'business' | 'plan' | 'lastService'>) => {
    const value = body[field];
    if (value !== undefined) updates[field] = String(value).trim();
  };

  assignString('name');
  assignString('email');
  assignString('phone');
  assignString('address');
  assignString('business');
  assignString('plan');
  assignString('lastService');

  if (body.status !== undefined) {
    const status = String(body.status) as CustomerStatus;
    if (!allowedCustomerStatuses.includes(status)) {
      throw new Error('A valid customer status is required.');
    }
    updates.status = status;
  }

  if (body.balance !== undefined) {
    const balance = Number(body.balance);
    if (!Number.isFinite(balance) || balance < 0) {
      throw new Error('Balance must be a valid number.');
    }
    updates.balance = balance;
  }

  if (!partial) {
    const requiredFields: Array<keyof AppCustomer> = ['name', 'email', 'phone', 'address', 'status', 'balance'];
    const missingField = requiredFields.find((field) => updates[field] === undefined || updates[field] === '');

    if (missingField) {
      throw new Error('name, email, phone, address, status, and receivable are required.');
    }
  }

  return updates;
};

const normalizePublicEnquiryPayload = (body: Record<string, unknown>) => {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const address = String(body.address || '').trim();
  const business = String(body.business || '').trim();
  const service = String(body.service || '').trim();
  const message = String(body.message || '').trim();

  if (!name || !email || !phone || !address || !business || !service) {
    throw new Error('name, email, phone, address, business, and service are required.');
  }

  if (message.length > 1000) {
    throw new Error('Message must be 1000 characters or less.');
  }

  return { name, email, phone, address, business, service, message };
};

const normalizeStringArray = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value.split('\n').map((item) => item.trim()).filter(Boolean);
  }

  return [];
};

const normalizeServicePayload = (body: Record<string, unknown>, partial = false) => {
  const updates: Partial<AppService> = {};

  const assignString = (field: keyof Pick<AppService, 'name' | 'business' | 'category' | 'description' | 'billing' | 'serviceArea' | 'contactPhone' | 'secondaryPhone' | 'email' | 'imageUrl' | 'source'>) => {
    const value = body[field];
    if (value !== undefined) updates[field] = String(value).trim();
  };

  assignString('name');
  assignString('business');
  assignString('category');
  assignString('description');
  assignString('billing');
  assignString('serviceArea');
  assignString('contactPhone');
  assignString('secondaryPhone');
  assignString('email');
  assignString('imageUrl');
  assignString('source');

  if (updates.imageUrl !== undefined && !isValidImageDataUrl(updates.imageUrl)) {
    throw new Error('Service image must be a PNG, JPG, WebP, or GIF under 1MB.');
  }

  if (body.status !== undefined) {
    const status = String(body.status) as ServiceStatus;
    if (!allowedServiceStatuses.includes(status)) {
      throw new Error('A valid service status is required.');
    }
    updates.status = status;
  }

  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error('Price must be a valid number.');
    }
    updates.price = price;
  }

  if (body.includes !== undefined) {
    updates.includes = normalizeStringArray(body.includes);
  }

  if (body.trustPoints !== undefined) {
    updates.trustPoints = normalizeStringArray(body.trustPoints);
  }

  if (!partial) {
    const requiredFields: Array<keyof AppService> = ['name', 'business', 'category', 'description', 'price', 'billing', 'status', 'serviceArea', 'contactPhone', 'email'];
    const missingField = requiredFields.find((field) => updates[field] === undefined || updates[field] === '');

    if (missingField) {
      throw new Error('name, business, category, description, price, billing, status, serviceArea, contactPhone, and email are required.');
    }
  }

  return updates;
};

const normalizeInvoicePayload = (body: Record<string, unknown>) => {
  const customerId = String(body.customerId || '').trim();
  const serviceId = String(body.serviceId || '').trim();
  const due = String(body.due || '').trim();
  const amount = Number(body.amount);
  const paid = Number(body.paid || 0);

  if (!ObjectId.isValid(customerId)) {
    throw new Error('A valid customer is required.');
  }

  if (!ObjectId.isValid(serviceId)) {
    throw new Error('A valid service is required.');
  }

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Price must be a valid number.');
  }

  if (!Number.isFinite(paid) || paid < 0 || paid > amount) {
    throw new Error('Paid amount must be between 0 and the total amount.');
  }

  if (!due) {
    throw new Error('Due date is required.');
  }

  const status = body.status ? String(body.status) as InvoiceStatus : 'Draft';
  if (!allowedInvoiceStatuses.includes(status)) {
    throw new Error('A valid invoice status is required.');
  }

  return { customerId, serviceId, due, amount, paid, status };
};

const nextInvoiceId = async () => {
  const invoices = await invoicesCollection();
  const count = await invoices.countDocuments();
  const year = new Date().getFullYear();

  return `INV-${year}-${String(count + 1).padStart(3, '0')}`;
};

const nextPaymentId = async () => {
  const payments = await paymentsCollection();
  const count = await payments.countDocuments();
  const year = new Date().getFullYear();

  return `PAY-${year}-${String(count + 1).padStart(4, '0')}`;
};

const normalizePaymentPayload = (body: Record<string, unknown>) => {
  const invoiceId = String(body.invoiceId || '').trim();
  const method = String(body.method || 'E-transfer').trim();
  const amount = Number(body.amount);
  const paidAtValue = String(body.paid_at || '').trim();
  const notes = String(body.notes || '').trim();

  if (!invoiceId) {
    throw new Error('Invoice is required.');
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Payment amount must be greater than 0.');
  }

  if (!method) {
    throw new Error('Payment method is required.');
  }

  const paidAt = paidAtValue ? new Date(`${paidAtValue}T00:00:00`) : new Date();

  if (Number.isNaN(paidAt.getTime())) {
    throw new Error('Payment date is invalid.');
  }

  return { invoiceId, method, amount, paidAt, notes };
};

const seedInitialServices = async () => {
  const services = await servicesCollection();
  const existingServices = await services.countDocuments();

  if (existingServices > 0) return;

  const now = new Date();
  await Promise.all(initialServices.map((service) => (
    services.updateOne(
      { name: service.name, business: service.business },
      {
        $setOnInsert: {
          ...service,
          created_at: now,
          updated_at: now,
        },
      },
      { upsert: true },
    )
  )));
};

const describeStartupError = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Failed to connect to MongoDB.';

  if (message.toLowerCase().includes('bad auth') || message.toLowerCase().includes('authentication failed')) {
    return [
      'MongoDB authentication failed.',
      'Check the MONGODB_URI username and password in backend/.env.',
      'If the password contains special characters, URL-encode it before putting it in the URI.',
    ].join(' ');
  }

  return message;
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
  res.send('Primozen API');
});

app.get('/api/db/health', async (_req: Request, res: Response) => {
  try {
    const db = await getMongoDb();
    await db.command({ ping: 1 });
    res.json({ connected: true, database: db.databaseName });
  } catch (error) {
    res.status(500).json({ connected: false, error: describeStartupError(error) });
  }
});

app.get('/api/public/config', (_req: Request, res: Response) => {
  res.json({
    appName: getPublicAppName(),
    businesses: [
      {
        key: 'snow',
        service: 'Snow Removal',
        image: '/hero-snow-service.png',
        accent: 'text-sky-700 bg-sky-500/10',
        ...businessDetailsFor('Frozen Solution'),
      },
      {
        key: 'lawn',
        service: 'Fresh Cut Services',
        image: '/hero-lawn-service.png',
        accent: 'text-emerald-700 bg-emerald-500/10',
        ...businessDetailsFor('Primecut Services'),
      },
    ],
  });
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
  const { currentPassword, password } = req.body;

  if (!req.user?._id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!currentPassword || !(await verifyPassword(String(currentPassword), req.user.password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
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

  const { full_name, phone, bio, avatar_url } = req.body;
  const users = await usersCollection();
  const updatedAt = new Date();
  const avatarUrl = typeof avatar_url === 'string' ? avatar_url : req.user.avatar_url || '';

  if (!isValidImageDataUrl(avatarUrl)) {
    return res.status(400).json({ error: 'Profile image must be a PNG, JPG, WebP, or GIF under 1MB.' });
  }

  await users.updateOne(
    { _id: req.user._id },
    {
      $set: {
        full_name: full_name || req.user.full_name,
        phone: phone || '',
        bio: bio || '',
        avatar_url: avatarUrl,
        updated_at: updatedAt,
      },
    },
  );

  const user = await users.findOne({ _id: req.user._id });
  await writeActivityLog({
    req,
    action: 'updated_profile',
    entityType: 'profile',
    entityId: req.user._id.toString(),
    entityLabel: user?.full_name || req.user.full_name,
    summary: `${user?.full_name || req.user.full_name} updated their profile`,
    targetUserId: req.user._id.toString(),
    details: {
      changed: ['full_name', 'phone', 'bio', 'avatar_url'].filter((field) => req.body[field] !== undefined),
    },
  });
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

app.post('/api/users', requireAuth, requireRole(['admin']), async (req: AuthRequest, res: Response) => {
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

  await writeActivityLog({
    req,
    action: 'created_user',
    entityType: 'user',
    entityId: user._id?.toString() || '',
    entityLabel: user.full_name,
    summary: `${req.user?.full_name || 'Admin'} created user ${user.full_name}`,
    targetUserId: user._id?.toString() || '',
    details: { email: user.email, role: user.role, status: user.status },
  });
  res.status(201).json(publicUser(user));
});

app.patch('/api/users/:id', requireAuth, requireRole(['admin']), async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const { full_name, role, status } = req.body;
  const updates: Partial<Pick<AppUser, 'full_name' | 'role' | 'status' | 'updated_at'>> = {
    updated_at: new Date(),
  };

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  const isSelf = req.user?._id?.toString() === id;

  if (isSelf && status === 'inactive') {
    return res.status(400).json({ error: 'Admins cannot mark their own account inactive.' });
  }

  if (isSelf && role && role !== req.user?.role) {
    return res.status(400).json({ error: 'Admins cannot change their own role.' });
  }

  if (full_name) updates.full_name = full_name;
  if (role && allowedRoles.includes(role)) updates.role = role;
  if (status && allowedStatuses.includes(status)) updates.status = status;

  const users = await usersCollection();
  await users.updateOne({ _id: new ObjectId(id) }, { $set: updates });
  const user = await users.findOne({ _id: new ObjectId(id) });

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  await writeActivityLog({
    req,
    action: 'updated_user',
    entityType: 'user',
    entityId: user._id?.toString() || id,
    entityLabel: user.full_name,
    summary: `${req.user?.full_name || 'Admin'} updated user ${user.full_name}`,
    targetUserId: user._id?.toString() || id,
    details: { full_name: user.full_name, role: user.role, status: user.status },
  });
  res.json(publicUser(user));
});

app.delete('/api/users/:id', requireAuth, requireRole(['admin']), async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  if (req.user?._id?.toString() === id) {
    return res.status(400).json({ error: 'Admins cannot delete their own account.' });
  }

  const users = await usersCollection();
  const user = await users.findOne({ _id: new ObjectId(id) });

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (user.status !== 'inactive') {
    return res.status(400).json({ error: 'Only inactive users can be deleted.' });
  }

  await users.deleteOne({ _id: user._id });
  await writeActivityLog({
    req,
    action: 'deleted_user',
    entityType: 'user',
    entityId: user._id?.toString() || id,
    entityLabel: user.full_name,
    summary: `${req.user?.full_name || 'Admin'} deleted user ${user.full_name}`,
    targetUserId: user._id?.toString() || id,
    details: { email: user.email, role: user.role },
  });
  res.status(204).send();
});

app.get('/api/activity-logs', requireAuth, async (req: AuthRequest, res: Response) => {
  const logs = await activityLogsCollection();
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  const filter: Record<string, unknown> = {};
  const query = String(req.query.query || '').trim();
  const action = String(req.query.action || '').trim();
  const entityType = String(req.query.entityType || '').trim();
  const business = String(req.query.business || '').trim();
  const actorId = String(req.query.actorId || '').trim();
  const customerId = String(req.query.customerId || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  if (hiddenActivityActions.includes(action) || entityType === 'auth') {
    return res.json([]);
  }

  if (action) {
    filter.action = action;
  } else {
    filter.action = { $nin: hiddenActivityActions };
  }

  if (entityType) {
    filter.entityType = entityType;
  } else {
    filter.entityType = { $ne: 'auth' };
  }

  if (business) filter.business = business;
  if (actorId) filter['actor.id'] = actorId;
  if (customerId) filter.customerId = customerId;

  if (from || to) {
    const createdAt: Record<string, Date> = {};
    if (from) createdAt.$gte = new Date(`${from}T00:00:00`);
    if (to) createdAt.$lte = new Date(`${to}T23:59:59.999`);
    filter.created_at = createdAt;
  }

  if (query) {
    const search = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { summary: search },
      { entityLabel: search },
      { action: search },
      { entityType: search },
      { business: search },
      { 'actor.name': search },
      { 'actor.email': search },
      { 'details.customer': search },
      { 'details.invoice': search },
      { 'details.service': search },
    ];
  }

  const data = await logs.find(filter).sort({ created_at: -1 }).limit(limit).toArray();
  res.json(data.map(publicActivityLog));
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

app.post('/api/items', requireAuth, requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const items = await itemsCollection();
  const now = new Date();
  const result = await items.insertOne({
    ...req.body,
    created_at: now,
    updated_at: now,
  });
  const item = await items.findOne({ _id: result.insertedId });

  await writeActivityLog({
    req,
    action: 'created_item',
    entityType: 'item',
    entityId: result.insertedId.toString(),
    entityLabel: String(item?.name || item?.title || item?.sku || 'Inventory item'),
    summary: `${req.user?.full_name || 'User'} created inventory item ${String(item?.name || item?.title || item?.sku || result.insertedId.toString())}`,
    details: item ? { ...item, _id: item._id?.toString() } : req.body,
  });
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

  await writeActivityLog({
    req,
    action: 'updated_item',
    entityType: 'item',
    entityId: item._id.toString(),
    entityLabel: String(item.name || item.title || item.sku || 'Inventory item'),
    summary: `${req.user?.full_name || 'User'} updated inventory item ${String(item.name || item.title || item.sku || item._id.toString())}`,
    details: { updates },
  });
  res.json({ ...item, id: item._id.toString(), _id: undefined });
});

app.delete('/api/items/:id', requireAuth, requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const items = await itemsCollection();
  const item = ObjectId.isValid(id) ? await items.findOne({ _id: new ObjectId(id) }) : null;
  await items.deleteOne({ _id: new ObjectId(id) });

  await writeActivityLog({
    req,
    action: 'deleted_item',
    entityType: 'item',
    entityId: id,
    entityLabel: String(item?.name || item?.title || item?.sku || 'Inventory item'),
    summary: `${req.user?.full_name || 'User'} deleted inventory item ${String(item?.name || item?.title || item?.sku || id)}`,
    details: item ? { ...item, _id: item._id?.toString() } : {},
  });
  res.status(204).send();
});

app.post('/api/public/enquiries', async (req: Request, res: Response) => {
  try {
    const payload = normalizePublicEnquiryPayload(req.body || {});
    const customers = await customersCollection();
    const now = new Date();
    const messageSummary = payload.message ? `Enquiry: ${payload.message}` : 'Enquiry submitted from customer landing page';
    const result = await customers.insertOne({
      name: payload.name,
      email: payload.email,
      phone: payload.phone,
      address: payload.address,
      business: payload.business,
      plan: payload.service,
      status: 'New lead',
      balance: 0,
      lastService: messageSummary.slice(0, 180),
      created_at: now,
      updated_at: now,
    });
    const customer = await customers.findOne({ _id: result.insertedId });

    if (customer) {
      await writeActivityLog({
        actor: {
          id: 'customer',
          name: payload.name,
          email: payload.email,
          role: 'customer',
        },
        action: 'submitted_enquiry',
        entityType: 'customer',
        entityId: customer._id?.toString() || '',
        entityLabel: customer.name,
        summary: `${payload.name} submitted a ${payload.service} enquiry`,
        business: customer.business,
        customerId: customer._id?.toString() || '',
        details: {
          customer: payload.name,
          email: payload.email,
          phone: payload.phone,
          address: payload.address,
          business: payload.business,
          service: payload.service,
          message: payload.message,
        },
      });
    }

    res.status(201).json(customer ? publicCustomer(customer) : null);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to submit enquiry.';
    res.status(400).json({ error: message });
  }
});

app.get('/api/customers', requireAuth, async (_req: AuthRequest, res: Response) => {
  const customers = await customersCollection();
  const data = await customers.find({}).sort({ created_at: -1 }).toArray();

  res.json(data.map(publicCustomer));
});

app.post('/api/customers', requireAuth, requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  try {
    const payload = normalizeCustomerPayload(req.body);
    const customers = await customersCollection();
    const now = new Date();
    const result = await customers.insertOne({
      name: payload.name || '',
      email: payload.email || '',
      phone: payload.phone || '',
      address: payload.address || '',
      business: payload.business || '',
      plan: payload.plan || '',
      status: payload.status || 'Active',
      balance: payload.balance || 0,
      lastService: payload.lastService || '',
      created_at: now,
      updated_at: now,
    });
    const customer = await customers.findOne({ _id: result.insertedId });

    if (customer) {
      await writeActivityLog({
        req,
        action: 'created_customer',
        entityType: 'customer',
        entityId: customer._id?.toString() || '',
        entityLabel: customer.name,
        summary: `${req.user?.full_name || 'User'} created customer ${customer.name}`,
        business: customer.business,
        customerId: customer._id?.toString() || '',
        details: {
          customer: customer.name,
          email: customer.email,
          phone: customer.phone,
          address: customer.address,
          business: customer.business,
          status: customer.status,
          balance: customer.balance,
        },
      });
    }
    res.status(201).json(customer ? publicCustomer(customer) : null);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create customer.';
    res.status(400).json({ error: message });
  }
});

app.put('/api/customers/:id', requireAuth, requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid customer id.' });
  }

  try {
    const updates = normalizeCustomerPayload(req.body, true);
    const customers = await customersCollection();

    await customers.updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...updates, updated_at: new Date() } },
    );

    const customer = await customers.findOne({ _id: new ObjectId(id) });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found.' });
    }

    await writeActivityLog({
      req,
      action: 'updated_customer',
      entityType: 'customer',
      entityId: customer._id?.toString() || id,
      entityLabel: customer.name,
      summary: `${req.user?.full_name || 'User'} updated customer ${customer.name}`,
      business: customer.business,
      customerId: customer._id?.toString() || id,
      details: { customer: customer.name, updates, status: customer.status, balance: customer.balance },
    });
    res.json(publicCustomer(customer));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update customer.';
    res.status(400).json({ error: message });
  }
});

app.delete('/api/customers/:id', requireAuth, requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid customer id.' });
  }

  const customers = await customersCollection();
  const customer = await customers.findOne({ _id: new ObjectId(id) });
  const result = await customers.deleteOne({ _id: new ObjectId(id) });

  if (result.deletedCount === 0) {
    return res.status(404).json({ error: 'Customer not found.' });
  }

  await writeActivityLog({
    req,
    action: 'deleted_customer',
    entityType: 'customer',
    entityId: id,
    entityLabel: customer?.name || 'Customer',
    summary: `${req.user?.full_name || 'User'} deleted customer ${customer?.name || id}`,
    business: customer?.business,
    customerId: id,
    details: customer ? { customer: customer.name, email: customer.email, phone: customer.phone, balance: customer.balance } : {},
  });
  res.status(204).send();
});

app.get('/api/services', requireAuth, async (_req: AuthRequest, res: Response) => {
  const services = await servicesCollection();
  const data = await services.find({}).sort({ business: 1, category: 1, name: 1 }).toArray();

  res.json(data.map(publicService));
});

app.get('/api/public/services', async (_req: Request, res: Response) => {
  const services = await servicesCollection();
  const data = await services.find({ status: 'Active' }).sort({ business: 1, category: 1, name: 1 }).toArray();

  res.json(data.map((service) => {
    const business = businessDetailsFor(service.business);

    return publicService({
      ...service,
      contactPhone: business.phone,
      secondaryPhone: business.secondaryPhone,
      email: business.email,
      serviceArea: service.serviceArea || business.serviceArea,
    });
  }));
});

app.post('/api/services', requireAuth, requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  try {
    const payload = normalizeServicePayload(req.body);
    const services = await servicesCollection();
    const now = new Date();
    const result = await services.insertOne({
      name: payload.name || '',
      business: payload.business || '',
      category: payload.category || '',
      description: payload.description || '',
      price: payload.price || 0,
      billing: payload.billing || '',
      status: payload.status || 'Active',
      includes: payload.includes || [],
      trustPoints: payload.trustPoints || [],
      serviceArea: payload.serviceArea || '',
      contactPhone: payload.contactPhone || '',
      secondaryPhone: payload.secondaryPhone || '',
      email: payload.email || '',
      imageUrl: payload.imageUrl || '',
      source: payload.source || 'Manual entry',
      created_at: now,
      updated_at: now,
    });
    const service = await services.findOne({ _id: result.insertedId });

    if (service) {
      await writeActivityLog({
        req,
        action: 'created_service',
        entityType: 'service',
        entityId: service._id?.toString() || '',
        entityLabel: service.name,
        summary: `${req.user?.full_name || 'User'} created service ${service.name}`,
        business: service.business,
        serviceId: service._id?.toString() || '',
        details: {
          service: service.name,
          business: service.business,
          category: service.category,
          price: service.price,
          billing: service.billing,
          status: service.status,
        },
      });
    }
    res.status(201).json(service ? publicService(service) : null);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create service.';
    res.status(400).json({ error: message });
  }
});

app.put('/api/services/:id', requireAuth, requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid service id.' });
  }

  try {
    const updates = normalizeServicePayload(req.body, true);
    const services = await servicesCollection();

    await services.updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...updates, updated_at: new Date() } },
    );

    const service = await services.findOne({ _id: new ObjectId(id) });

    if (!service) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    await writeActivityLog({
      req,
      action: 'updated_service',
      entityType: 'service',
      entityId: service._id?.toString() || id,
      entityLabel: service.name,
      summary: `${req.user?.full_name || 'User'} updated service ${service.name}`,
      business: service.business,
      serviceId: service._id?.toString() || id,
      details: { service: service.name, updates, price: service.price, status: service.status },
    });
    res.json(publicService(service));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update service.';
    res.status(400).json({ error: message });
  }
});

app.delete('/api/services/:id', requireAuth, requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid service id.' });
  }

  const services = await servicesCollection();
  const service = await services.findOne({ _id: new ObjectId(id) });
  const result = await services.deleteOne({ _id: new ObjectId(id) });

  if (result.deletedCount === 0) {
    return res.status(404).json({ error: 'Service not found.' });
  }

  await writeActivityLog({
    req,
    action: 'deleted_service',
    entityType: 'service',
    entityId: id,
    entityLabel: service?.name || 'Service',
    summary: `${req.user?.full_name || 'User'} deleted service ${service?.name || id}`,
    business: service?.business,
    serviceId: id,
    details: service ? { service: service.name, business: service.business, category: service.category, price: service.price } : {},
  });
  res.status(204).send();
});

app.get('/api/invoices', requireAuth, requireRole(['admin', 'manager']), async (_req: AuthRequest, res: Response) => {
  const invoices = await invoicesCollection();
  const data = await invoices.find({}).sort({ created_at: -1 }).toArray();

  res.json(data.map(publicInvoice));
});

app.post('/api/invoices', requireAuth, requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  try {
    const payload = normalizeInvoicePayload(req.body);
    const customers = await customersCollection();
    const services = await servicesCollection();
    const invoices = await invoicesCollection();
    const customer = await customers.findOne({ _id: new ObjectId(payload.customerId) });
    const service = await services.findOne({ _id: new ObjectId(payload.serviceId) });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found.' });
    }

    if (!service) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    const now = new Date();
    const invoiceId = await nextInvoiceId();
    const receivable = Math.max(payload.amount - payload.paid, 0);
    const agreementLink = getAgreementLink(invoiceId);
    const result = await invoices.insertOne({
      invoice_id: invoiceId,
      customerId: payload.customerId,
      customer: customer.name,
      email: customer.email,
      business: service.business,
      serviceId: payload.serviceId,
      service: service.name,
      issued: formatDate(now),
      due: payload.due,
      amount: payload.amount,
      paid: payload.paid,
      receivable,
      status: payload.status,
      agreementLink,
      feedback: '',
      emails: [],
      created_at: now,
      updated_at: now,
    });
    const invoice = await invoices.findOne({ _id: result.insertedId });

    if (invoice) {
      await writeActivityLog({
        req,
        action: 'created_invoice',
        entityType: 'invoice',
        entityId: invoice._id?.toString() || '',
        entityLabel: invoice.invoice_id,
        summary: `${req.user?.full_name || 'User'} created invoice ${invoice.invoice_id} for ${invoice.customer}`,
        business: invoice.business,
        customerId: invoice.customerId,
        invoiceId: invoice.invoice_id,
        serviceId: invoice.serviceId,
        details: {
          invoice: invoice.invoice_id,
          customer: invoice.customer,
          service: invoice.service,
          amount: invoice.amount,
          paid: invoice.paid,
          receivable: invoice.receivable,
          status: invoice.status,
          due: invoice.due,
        },
      });
    }
    res.status(201).json(invoice ? publicInvoice(invoice) : null);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create invoice.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/invoices/:id/send', requireAuth, requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const invoices = await invoicesCollection();
  const invoice = await invoices.findOne({ $or: [{ invoice_id: id }, ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : [])] });

  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  const services = await servicesCollection();
  const service = ObjectId.isValid(invoice.serviceId) ? await services.findOne({ _id: new ObjectId(invoice.serviceId) }) : null;
  const agreementLink = getAgreementLink(invoice.invoice_id);
  const invoiceForEmail = { ...invoice, agreementLink };
  const paymentLines = await invoicePaymentLines(invoice);
  const email = createEmailLog({
    type: 'invoice',
    to: invoice.email,
    subject: `${invoice.business} invoice ${invoice.invoice_id}`,
    body: invoiceEmailText(invoiceForEmail, paymentLines, agreementLink),
  });

  try {
    await sendEmail(email, invoiceEmailHtml(invoiceForEmail, service, paymentLines, agreementLink));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send invoice email.';
    return res.status(500).json({ error: message });
  }

  await invoices.updateOne(
    { _id: invoice._id },
    {
      $set: {
        agreementLink,
        status: invoice.status === 'Draft' ? 'Sent' : invoice.status,
        updated_at: new Date(),
      },
      $push: { emails: email },
    },
  );

  const updatedInvoice = await invoices.findOne({ _id: invoice._id });
  await writeActivityLog({
    req,
    action: 'sent_invoice',
    entityType: 'invoice',
    entityId: invoice._id?.toString() || invoice.invoice_id,
    entityLabel: invoice.invoice_id,
    summary: `${req.user?.full_name || 'User'} sent invoice ${invoice.invoice_id} to ${invoice.customer}`,
    business: invoice.business,
    customerId: invoice.customerId,
    invoiceId: invoice.invoice_id,
    serviceId: invoice.serviceId,
    details: {
      invoice: invoice.invoice_id,
      customer: invoice.customer,
      to: invoice.email,
      subject: email.subject,
      previousStatus: invoice.status,
      nextStatus: invoice.status === 'Draft' ? 'Sent' : invoice.status,
      agreementLink,
    },
  });
  res.json({ invoice: updatedInvoice ? publicInvoice(updatedInvoice) : null, email });
});

app.get('/api/payments', requireAuth, requireRole(['admin', 'manager']), async (_req: AuthRequest, res: Response) => {
  const payments = await paymentsCollection();
  const data = await payments.find({}).sort({ paid_at: -1, created_at: -1 }).toArray();

  res.json(data.map(publicPayment));
});

app.post('/api/payments', requireAuth, requireRole(['admin', 'manager']), async (req: AuthRequest, res: Response) => {
  try {
    const payload = normalizePaymentPayload(req.body);
    const invoices = await invoicesCollection();
    const payments = await paymentsCollection();
    const invoice = await invoices.findOne({
      $or: [
        { invoice_id: payload.invoiceId },
        ...(ObjectId.isValid(payload.invoiceId) ? [{ _id: new ObjectId(payload.invoiceId) }] : []),
      ],
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }

    if (payload.amount > invoice.receivable) {
      return res.status(400).json({ error: 'Payment amount cannot exceed the invoice receivable.' });
    }

    const now = new Date();
    const paymentId = await nextPaymentId();
    const paid = Math.min(invoice.paid + payload.amount, invoice.amount);
    const receivable = Math.max(invoice.amount - paid, 0);
    const result = await payments.insertOne({
      payment_id: paymentId,
      invoiceId: invoice._id?.toString() || '',
      invoice_id: invoice.invoice_id,
      customerId: invoice.customerId,
      customer: invoice.customer,
      email: invoice.email,
      business: invoice.business,
      service: invoice.service,
      method: payload.method,
      amount: payload.amount,
      paid_at: payload.paidAt,
      date: formatDate(payload.paidAt),
      notes: payload.notes,
      created_at: now,
      updated_at: now,
    });

    await invoices.updateOne(
      { _id: invoice._id },
      {
        $set: {
          paid,
          receivable,
          status: receivable === 0 ? 'Paid' : 'Confirmed',
          updated_at: now,
        },
      },
    );

    if (ObjectId.isValid(invoice.customerId)) {
      const customers = await customersCollection();
      await customers.updateOne(
        { _id: new ObjectId(invoice.customerId) },
        {
          $set: {
            balance: receivable,
            status: receivable > 0 ? 'Due' : 'Active',
            lastService: `${formatDate(now)} - ${invoice.service}`,
            updated_at: now,
          },
        },
      );
    }

    const payment = await payments.findOne({ _id: result.insertedId });
    const updatedInvoice = await invoices.findOne({ _id: invoice._id });

    if (payment) {
      await writeActivityLog({
        req,
        action: 'recorded_payment',
        entityType: 'payment',
        entityId: payment._id?.toString() || '',
        entityLabel: payment.payment_id,
        summary: `${req.user?.full_name || 'User'} recorded ${formatMoney(payment.amount)} payment for ${invoice.invoice_id}`,
        business: payment.business,
        customerId: payment.customerId,
        invoiceId: payment.invoice_id,
        paymentId: payment.payment_id,
        details: {
          payment: payment.payment_id,
          invoice: payment.invoice_id,
          customer: payment.customer,
          service: payment.service,
          method: payment.method,
          amount: payment.amount,
          previousPaid: invoice.paid,
          newPaid: paid,
          previousReceivable: invoice.receivable,
          newReceivable: receivable,
          status: receivable === 0 ? 'Paid' : 'Confirmed',
          notes: payment.notes,
        },
      });
    }
    res.status(201).json({
      payment: payment ? publicPayment(payment) : null,
      invoice: updatedInvoice ? publicInvoice(updatedInvoice) : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record payment.';
    res.status(400).json({ error: message });
  }
});

app.get('/api/public/invoices/:invoiceId', async (req: Request, res: Response) => {
  const invoices = await invoicesCollection();
  const invoice = await invoices.findOne({ invoice_id: String(req.params.invoiceId) });

  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  res.json(await publicInvoiceWithPaymentHistory(invoice));
});

app.post('/api/public/invoices/:invoiceId/confirm', async (req: Request, res: Response) => {
  const invoices = await invoicesCollection();
  const invoice = await invoices.findOne({ invoice_id: String(req.params.invoiceId) });

  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  return res.status(405).json({
    error: 'Invoice confirmation is disabled. This invoice link is view only.',
    invoice: await publicInvoiceWithPaymentHistory(invoice),
  });
});

const startServer = async () => {
  const server = app.listen(port, () => {
    console.log(`[server]: Server is running at http://localhost:${port}`);
  });
  const keepAliveInterval = setInterval(() => undefined, 60_000);

  connectMongo()
    .then(async (db) => {
      await db.collection('users').createIndex({ email: 1 }, { unique: true });
      await dropIndexIfExists(db.collection('customers'), 'customer_id_1');
      await db.collection('customers').createIndex({ email: 1 });
      await db.collection('services').createIndex({ business: 1, name: 1 });
      await db.collection('invoices').createIndex({ invoice_id: 1 }, { unique: true });
      await db.collection('invoices').createIndex({ customerId: 1 });
      await db.collection('invoices').createIndex({ status: 1 });
      await db.collection('activity_logs').createIndex({ created_at: -1 });
      await db.collection('activity_logs').createIndex({ action: 1, entityType: 1 });
      await db.collection('activity_logs').createIndex({ business: 1 });
      await db.collection('activity_logs').createIndex({ customerId: 1 });
      await db.collection('activity_logs').createIndex({ 'actor.id': 1 });
      await seedInitialServices();
      console.log(`[mongo]: Connected to database ${db.databaseName}`);
    })
    .catch((error) => {
      console.error(`[mongo]: ${describeStartupError(error)}`);
      console.error('[mongo]: The server is still running; database-backed routes will fail until MONGODB_URI is fixed.');
    });

  process.on('SIGTERM', () => {
    clearInterval(keepAliveInterval);
    server.close(async () => {
      await closeMongo();
      process.exit(0);
    });
  });
};

startServer().catch((error) => {
  console.error(`[server]: ${describeStartupError(error)}`);
  process.exit(1);
});
