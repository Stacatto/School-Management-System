import { Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendSuccess, sendError } from '../../utils/apiResponse';
import { notifyUsers } from '../../utils/inAppNotifications';
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
      prisma.student.findMany({ where: { id: { in: uniqueStudentIds } }, select: { id: true, userId: true, parentEmail: true } }),
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
    const parentEmails = [...new Set(students.map(student => student.parentEmail).filter((email): email is string => Boolean(email)))];
    const parents = await prisma.user.findMany({ where: { email: { in: parentEmails }, role: 'PARENT' }, select: { id: true } });
    await notifyUsers([...students.map(student => student.userId), ...parents.map(parent => parent.id)], 'Fee assigned', `${fee.name} has been assigned to your account.`, 'fees');
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
      const payment = await prisma.feePayment.findFirst({
        where: { stripePaymentIntentId: intent.id },
        select: { id: true, amount: true },
      });
      if (payment && intent.currency === 'usd' && intent.amount_received === Math.round(payment.amount * 100)) {
        await settleOnlineFeePayment(payment.id);
      }
    }

    return res.json({ received: true });
  } catch (err) { next(err); }
}

// ─── Student and parent online fee payments ────────────────────────────────

async function getPayableAssignment(req: AuthRequest, studentId: string, feeId: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter a payment amount greater than zero' as const, status: 400 };
  if (req.user!.role !== 'STUDENT' && req.user!.role !== 'PARENT') return { error: 'Only the student or linked parent can pay this fee' as const, status: 403 };

  const student = req.user!.role === 'STUDENT'
    ? await prisma.student.findUnique({ where: { userId: req.user!.id }, select: { id: true } })
    : await prisma.student.findFirst({ where: { id: studentId, parentEmail: req.user!.email }, select: { id: true } });
  if (!student || student.id !== studentId) return { error: 'You cannot pay fees for this student' as const, status: 403 };

  const assignment = await prisma.feeAssignment.findUnique({
    where: { feeId_studentId: { feeId, studentId } },
    select: { id: true, amount: true, amountPaid: true },
  });
  if (!assignment) return { error: 'No matching fee is assigned to this student' as const, status: 404 };

  const remaining = Math.max(0, assignment.amount - assignment.amountPaid);
  if (Math.round(amount * 100) > Math.round(remaining * 100)) {
    return { error: 'Payment exceeds the remaining fee balance' as const, status: 409 };
  }
  return { assignment, student };
}

async function canPayForStudent(req: AuthRequest, studentId: string) {
  if (req.user!.role === 'STUDENT') {
    const student = await prisma.student.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
    return student?.id === studentId;
  }
  if (req.user!.role === 'PARENT') {
    const student = await prisma.student.findFirst({ where: { id: studentId, parentEmail: req.user!.email }, select: { id: true } });
    return Boolean(student);
  }
  return false;
}

async function settleOnlineFeePayment(paymentId: string) {
  return prisma.$transaction(async tx => {
    const payment = await tx.feePayment.findUnique({
      where: { id: paymentId },
      select: { id: true, amount: true, status: true, feeAssignmentId: true },
    });
    if (!payment || payment.status === 'PAID') return false;

    const claimed = await tx.feePayment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'PAID' },
    });
    if (claimed.count !== 1) return false;

    if (payment.feeAssignmentId) {
      const assignment = await tx.feeAssignment.findUnique({
        where: { id: payment.feeAssignmentId },
        select: { amount: true, amountPaid: true },
      });
      if (!assignment || Math.round((assignment.amountPaid + payment.amount) * 100) > Math.round(assignment.amount * 100)) {
        throw new Error('Verified payment exceeds the assigned fee balance');
      }
      const updated = await tx.feeAssignment.updateMany({
        where: { id: payment.feeAssignmentId, amountPaid: assignment.amountPaid },
        data: { amountPaid: { increment: payment.amount } },
      });
      if (updated.count !== 1) throw new Error('Fee balance changed during payment reconciliation');
    }
    return true;
  });
}

export async function createPayPalOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { studentId, feeId } = req.body;
    const amount = Number(req.body.amount);
    if (typeof studentId !== 'string' || !studentId || typeof feeId !== 'string' || !feeId) {
      return sendError(res, 'Choose a student and assigned fee', 400);
    }
    const payable = await getPayableAssignment(req, studentId, feeId, amount);
    if ('error' in payable) return sendError(res, payable.error, payable.status);

    const order = await ppCreate(amount, 'USD', { studentId, feeId, feeAssignmentId: payable.assignment.id });
    await prisma.feePayment.create({
      data: {
        studentId, feeId, amount, method: 'PAYPAL', paypalOrderId: order.id,
        feeAssignmentId: payable.assignment.id, status: 'PENDING',
      },
    });

    const approvalUrl = order.links.find((l: any) => l.rel === 'approve')?.href;
    return sendSuccess(res, { orderId: order.id, approvalUrl });
  } catch (err) { next(err); }
}

export async function capturePayPalOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { orderId } = req.body;
    if (typeof orderId !== 'string' || !orderId) return sendError(res, 'Payment order is required', 400);
    const payment = await prisma.feePayment.findFirst({
      where: { paypalOrderId: orderId },
      select: { id: true, studentId: true, amount: true, status: true },
    });
    if (!payment) return sendError(res, 'Payment order not found', 404);
    if (!(await canPayForStudent(req, payment.studentId))) return sendError(res, 'You cannot capture this payment', 403);
    if (payment.status === 'PAID') return sendSuccess(res, { status: 'PAID' }, 'Payment already recorded');

    const result = await ppCapture(orderId);
    const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
    if (
      result.status !== 'COMPLETED' ||
      capture?.status !== 'COMPLETED' ||
      capture?.amount?.currency_code !== 'USD' ||
      Math.round(Number(capture?.amount?.value) * 100) !== Math.round(payment.amount * 100)
    ) return sendError(res, 'Payment amount could not be verified', 402);

    await settleOnlineFeePayment(payment.id);
    return sendSuccess(res, { status: 'PAID' }, 'Payment captured');
  } catch (err) { next(err); }
}

export async function initFlutterwave(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { studentId, feeId } = req.body;
    const amount = Number(req.body.amount);
    if (typeof studentId !== 'string' || !studentId || typeof feeId !== 'string' || !feeId) {
      return sendError(res, 'Choose a student and assigned fee', 400);
    }
    const payable = await getPayableAssignment(req, studentId, feeId, amount);
    if ('error' in payable) return sendError(res, payable.error, payable.status);

    const payer = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { email: true, name: true, phone: true },
    });
    if (!payer) return sendError(res, 'Payment account not found', 404);

    const txRef = `SMS-${uuidv4()}`;
    const currency = 'USD';
    const result = await initFlutterwavePayment({
      amount, currency, email: payer.email, name: payer.name, phone: payer.phone || undefined, txRef,
      redirectUrl: `${process.env.FRONTEND_URL}/fees/verify?ref=${txRef}`,
      meta: { studentId, feeId, feeAssignmentId: payable.assignment.id },
    });

    await prisma.feePayment.create({
      data: {
        studentId, feeId, amount, method: 'FLUTTERWAVE', flutterwaveRef: txRef,
        feeAssignmentId: payable.assignment.id, status: 'PENDING',
      },
    });

    return sendSuccess(res, { paymentLink: result.link, txRef });
  } catch (err) { next(err); }
}

export async function verifyFlutterwave(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const transactionId = req.query.transactionId;
    if (typeof transactionId !== 'string' || !transactionId) return sendError(res, 'Payment transaction is required', 400);
    const result = await verifyFlutterwavePayment(transactionId);
    if (result.status !== 'successful') return sendError(res, 'Payment not successful', 402);

    const payment = typeof result.tx_ref === 'string'
      ? await prisma.feePayment.findFirst({
          where: { flutterwaveRef: result.tx_ref },
          select: { id: true, studentId: true, amount: true, status: true },
        })
      : null;
    if (!payment) return sendError(res, 'Payment record not found', 404);
    if (!(await canPayForStudent(req, payment.studentId))) return sendError(res, 'You cannot verify this payment', 403);
    if (
      result.currency !== 'USD' ||
      Math.round(Number(result.amount) * 100) !== Math.round(payment.amount * 100)
    ) return sendError(res, 'Payment amount could not be verified', 402);

    await prisma.feePayment.update({
      where: { id: payment.id },
      data: { transactionRef: transactionId },
    });
    await settleOnlineFeePayment(payment.id);
    return sendSuccess(res, { status: 'PAID' }, 'Payment verified');
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
