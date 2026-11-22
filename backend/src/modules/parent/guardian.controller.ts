import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { NextFunction, Request, Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendError, sendSuccess } from '../../utils/apiResponse';

const digest = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export async function createInvitation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const studentId = req.params.id;
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!/^\S+@\S+\.\S+$/.test(email)) return sendError(res, 'Enter a valid guardian email address', 400);
    const student = await prisma.student.findUnique({ where: { id: studentId }, include: { user: { select: { name: true } } } });
    if (!student) return sendError(res, 'Student not found', 404);
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
    if (existing && existing.role !== 'PARENT') return sendError(res, 'That email belongs to a non-parent account', 409);
    if (existing && await prisma.studentGuardian.findUnique({ where: { studentId_parentUserId: { studentId, parentUserId: existing.id } } })) {
      return sendError(res, 'This guardian is already linked to the student', 409);
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.$transaction([
      prisma.guardianInvitation.updateMany({ where: { studentId, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.guardianInvitation.create({ data: { studentId, email, tokenHash: digest(token), expiresAt, createdById: req.user!.id } }),
      prisma.student.update({ where: { id: studentId }, data: { parentEmail: email } }),
    ]);
    const base = (process.env.FRONTEND_URL || '').split(',')[0].replace(/\/$/, '');
    // Keep the one-time token in the URL fragment so web-server access logs never receive it.
    const acceptUrl = `${base || req.get('origin') || ''}/parent/accept#token=${token}`;
    return sendSuccess(res, { email, studentName: student.user.name, expiresAt, acceptUrl }, 'Guardian invitation created', 201);
  } catch (err) { next(err); }
}

export async function acceptInvitation(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, name, password } = req.body;
    if (typeof token !== 'string' || token.length < 32) return sendError(res, 'Invalid or expired invitation', 400);
    const invitation = await prisma.guardianInvitation.findUnique({ where: { tokenHash: digest(token) }, include: { student: { include: { user: { select: { name: true } } } } } });
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) return sendError(res, 'Invalid or expired invitation', 400);
    const email = invitation.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return sendError(res, existing.role === 'PARENT' ? 'This email already has an account. Sign in first, then accept the invitation.' : 'This invitation email belongs to a non-parent account.', 409);
    if (typeof name !== 'string' || name.trim().length < 2 || typeof password !== 'string' || password.length < 12 || password.length > 100) {
      return sendError(res, 'Enter your name and a password with at least 12 characters', 400);
    }
    const hash = await bcrypt.hash(password, 12);
    await prisma.$transaction(async tx => {
      const consumed = await tx.guardianInvitation.updateMany({ where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
      if (consumed.count !== 1) throw new Error('Invitation was already used or expired');
      const parent = await tx.user.create({ data: { name: name.trim(), email, password: hash, role: 'PARENT' } });
      await tx.studentGuardian.create({ data: { studentId: invitation.studentId, parentUserId: parent.id } });
    });
    return sendSuccess(res, { email, studentName: invitation.student.user.name }, 'Guardian account created and linked. You can now sign in.', 201);
  } catch (err) { next(err); }
}

export async function acceptInvitationAsParent(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { token } = req.body;
    if (req.user!.role !== 'PARENT') return sendError(res, 'Sign in with a parent account to accept this invitation', 403);
    if (typeof token !== 'string' || token.length < 32) return sendError(res, 'Invalid or expired invitation', 400);
    const invitation = await prisma.guardianInvitation.findUnique({ where: { tokenHash: digest(token) } });
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) return sendError(res, 'Invalid or expired invitation', 400);
    if (invitation.email.toLowerCase() !== req.user!.email.toLowerCase()) return sendError(res, 'This invitation was sent to a different email address', 403);
    await prisma.$transaction(async tx => {
      const consumed = await tx.guardianInvitation.updateMany({ where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
      if (consumed.count !== 1) throw new Error('Invitation was already used or expired');
      await tx.studentGuardian.create({ data: { studentId: invitation.studentId, parentUserId: req.user!.id } });
    });
    return sendSuccess(res, null, 'Student linked to your parent account');
  } catch (err) { next(err); }
}
