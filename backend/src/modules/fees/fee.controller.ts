import { Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendSuccess, sendError } from '../../utils/apiResponse';
import { getIO } from '../../config/socket';
import {
  createPayPalOrder as ppCreate,
  capturePayPalOrder as ppCapture,
  initFlutterwavePayment,
  verifyFlutterwavePayment,
} from '../../utils/payments';

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const fees = await prisma.fee.findMany({ orderBy: { createdAt: 'desc' } });
    return sendSuccess(res, fees);
  } catch (err) { next(err); }
}

export async function listAssignments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const assignments = await prisma.feeAssignment.findMany({
      include: {
        fee: true,
        student: { include: { user: { select: { name: true, email: true } }, class: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });
    return sendSuccess(res, assignments);
  } catch (err) { next(err); }
}

export async function listMyAssignments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const student = await prisma.student.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
    if (!student) return sendSuccess(res, []);
    const assignments = await prisma.feeAssignment.findMany({
      where: { studentId: student.id },
      include: { fee: true, payments: { where: { status: 'PAID' }, select: { amount: true, createdAt: true, method: true } } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });
    return sendSuccess(res, assignments);
  } catch (err) { next(err); }
}

export async function assignFee(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { feeId, studentIds } = req.body;
    if (typeof feeId !== 'string' || !feeId || !Array.isArray(studentIds) || studentIds.length === 0 || studentIds.some((id: unknown) => typeof id !== 'string' || !id)) {
      return sendError(res, 'Choose a fee and at least one student', 400);
    }

    const uniqueStudentIds = [...new Set<string>(studentIds)];
    const [fee, students] = await Promise.all([
      prisma.fee.findUnique({ where: { id: feeId } }),
      prisma.student.findMany({ where: { id: { in: uniqueStudentIds } }, select: { id: true } }),
    ]);
    if (!fee) return sendError(res, 'Fee structure not found', 404);
    if (students.length !== uniqueStudentIds.length) return sendError(res, 'One or more students could not be found', 400);

    const assignments = await prisma.$transaction(uniqueStudentIds.map(studentId =>
      prisma.feeAssignment.upsert({
        where: { feeId_studentId: { feeId, studentId } },
        update: {},
        create: { feeId, studentId, amount: fee.amount, dueDate: fee.dueDate },
      })
    ));
    return sendSuccess(res, assignments, `Fee assigned to ${assignments.length} student${assignments.length === 1 ? '' : 's'}`, 201);
  } catch (err) { next(err); }
}

export async function removeAssignment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const assignment = await prisma.feeAssignment.findUnique({ where: { id: req.params.id }, select: { id: true, amountPaid: true } });
    if (!assignment) return sendError(res, 'Fee assignment not found', 404);
    if (assignment.amountPaid > 0) return sendError(res, 'A fee with payments recorded cannot be removed', 409);
    await prisma.feeAssignment.delete({ where: { id: assignment.id } });
    return sendSuccess(res, null, 'Fee assignment removed');
  } catch (err) { next(err); }
}

export async function recordAssignmentPayment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const amount = Number(req.body.amount);
    const method = req.body.method;
    if (!Number.isFinite(amount) || amount <= 0) return sendError(res, 'Enter a payment amount greater than zero', 400);
    if (!['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY'].includes(method)) return sendError(res, 'Choose a supported payment method', 400);

    const result = await prisma.$transaction(async tx => {
      const assignment = await tx.feeAssignment.findUnique({ where: { id: req.params.id }, include: { fee: true, student: { select: { id: true, userId: true } } } });
      if (!assignment) return { error: 'not-found' as const };
      const updated = await tx.feeAssignment.updateMany({
        where: { id: assignment.id, amountPaid: { lte: assignment.amount - amount } },
        data: { amountPaid: { increment: amount } },
      });
      if (updated.count !== 1) return { error: 'overpayment' as const };

      const payment = await tx.feePayment.create({
        data: { studentId: assignment.studentId, feeId: assignment.feeId, feeAssignmentId: assignment.id, amount, method, status: 'PAID' },
        include: { student: { include: { user: { select: { name: true } } } }, fee: true },
      });
      return { payment, assignment: { ...assignment, amountPaid: assignment.amountPaid + amount } };
    });

    if ('error' in result) {
      if (result.error === 'not-found') return sendError(res, 'Fee assignment not found', 404);
      return sendError(res, 'Payment exceeds the remaining balance', 409);
    }
    return sendSuccess(res, result, 'Payment recorded');
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, amount, dueDate, description, academicYear } = req.body;
    const fee = await prisma.fee.create({ data: { name, amount: Number(amount), dueDate: dueDate ? new Date(dueDate) : null, description: description || null, academicYear } });
    return sendSuccess(res, fee, 'Fee structure created', 201);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, amount, dueDate, description, academicYear } = req.body;
    const fee = await prisma.fee.update({
      where: { id: req.params.id },
      data: { name, amount: Number(amount), dueDate: dueDate ? new Date(dueDate) : null, description: description || null, academicYear },
    });
    return sendSuccess(res, fee, 'Fee structure updated');
  } catch (err) { next(err); }
}

export async function listPayments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const payments = await prisma.feePayment.findMany({
      include: { student: true, fee: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return sendSuccess(res, payments);
  } catch (err) { next(err); }
}

export async function listMyPayments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const student = await prisma.student.findUnique({
      where: { userId: req.user!.id },
      select: { id: true },
    });
    if (!student) return sendSuccess(res, []);

    const payments = await prisma.feePayment.findMany({
      where: { studentId: student.id },
      include: { fee: true },
      orderBy: { createdAt: 'desc' },
    });
    return sendSuccess(res, payments);
  } catch (err) { next(err); }
}

export async function recordPayment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { studentId, feeId, amount, method } = req.body;

    let stripePaymentIntentId: string | undefined;
    if (method === 'STRIPE') {
      const intent = await getStripe().paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: 'usd',
        metadata: { studentId, feeId },
      });
      stripePaymentIntentId = intent.id;
    }

    const payment = await prisma.feePayment.create({
      data: { studentId, feeId, amount, method, stripePaymentIntentId, status: method === 'STRIPE' ? 'PENDING' : 'PAID' },
      include: { student: true },
    });

    try { getIO().to(`user:${studentId}`).emit('fee:payment', payment); } catch { /* socket not init */ }

    return sendSuccess(res, payment, 'Payment recorded', 201);
  } catch (err) { next(err); }
}

export async function stripeWebhook(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const sig = req.headers['stripe-signature'] as string;
    const event = getStripe().webhooks.constructEvent(
      (req as any).rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      await prisma.feePayment.updateMany({
        where: { stripePaymentIntentId: intent.id },
        data: { status: 'PAID' },
      });
    }

    return res.json({ received: true });
  } catch (err) { next(err); }
}

// ─── PayPal ──────────────────────────────────────────────────────────────────

export async function createPayPalOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { studentId, feeId, amount } = req.body;
    const order = await ppCreate(amount, 'USD', { studentId, feeId });

    await prisma.feePayment.create({
      data: { studentId, feeId, amount, method: 'PAYPAL', paypalOrderId: order.id, status: 'PENDING' },
    });

    const approvalUrl = order.links.find((l: any) => l.rel === 'approve')?.href;
    return sendSuccess(res, { orderId: order.id, approvalUrl });
  } catch (err) { next(err); }
}

export async function capturePayPalOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { orderId } = req.body;
    const result = await ppCapture(orderId);

    if (result.status === 'COMPLETED') {
      await prisma.feePayment.updateMany({ where: { paypalOrderId: orderId }, data: { status: 'PAID' } });
      return sendSuccess(res, { status: 'PAID' }, 'Payment captured');
    }

    return sendError(res, 'Payment not completed', 402);
  } catch (err) { next(err); }
}

export async function paypalWebhook(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { event_type, resource } = req.body;
    if (event_type === 'CHECKOUT.ORDER.APPROVED') {
      await prisma.feePayment.updateMany({
        where: { paypalOrderId: resource.id },
        data: { status: 'PAID' },
      });
    }
    return res.json({ received: true });
  } catch (err) { next(err); }
}

// ─── Flutterwave ─────────────────────────────────────────────────────────────

export async function initFlutterwave(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { studentId, feeId, amount, currency = 'NGN', email, name, phone } = req.body;
    const txRef = `SMS-${uuidv4()}`;

    const result = await initFlutterwavePayment({
      amount, currency, email, name, phone, txRef,
      redirectUrl: `${process.env.FRONTEND_URL}/fees/verify?ref=${txRef}`,
      meta: { studentId, feeId },
    });

    await prisma.feePayment.create({
      data: { studentId, feeId, amount, method: 'FLUTTERWAVE', flutterwaveRef: txRef, status: 'PENDING' },
    });

    return sendSuccess(res, { paymentLink: result.link, txRef });
  } catch (err) { next(err); }
}

export async function verifyFlutterwave(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { transactionId } = req.query as { transactionId: string };
    const result = await verifyFlutterwavePayment(transactionId);

    if (result.status === 'successful') {
      const meta = result.meta;
      await prisma.feePayment.updateMany({
        where: { flutterwaveRef: result.tx_ref },
        data: { status: 'PAID', transactionRef: transactionId },
      });
      return sendSuccess(res, { status: 'PAID' }, 'Payment verified');
    }

    return sendError(res, 'Payment not successful', 402);
  } catch (err) { next(err); }
}

export async function getStatement(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'ADMIN') {
      const student = await prisma.student.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
      if (!student || student.id !== req.params.studentId) return sendError(res, 'Not authorized to view this statement', 403);
    }
    const payments = await prisma.feePayment.findMany({
      where: { studentId: req.params.studentId },
      include: { fee: true },
      orderBy: { createdAt: 'desc' },
    });
    const totalPaid = payments.filter(p => p.status === 'PAID').reduce((s, p) => s + p.amount, 0);
    const totalPending = payments.filter(p => p.status === 'PENDING').reduce((s, p) => s + p.amount, 0);
    return sendSuccess(res, { payments, totalPaid, totalPending });
  } catch (err) { next(err); }
}
