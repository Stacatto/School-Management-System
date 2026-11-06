import { Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendSuccess, sendError } from '../../utils/apiResponse';
import { getIO } from '../../config/socket';
import { sendEmail, sendSMS } from '../../utils/email';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]!));
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return sendSuccess(res, notifications);
  } catch (err) {
    // Handle environments where migrations are pending to avoid hard dashboard failure.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021') {
      return sendSuccess(res, []);
    }
    next(err);
  }
}

export async function broadcast(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { title, message, roles, channels = [] } = req.body;
    const validRoles = ['ADMIN', 'TEACHER', 'STUDENT', 'PARENT'];
    const validChannels = ['socket', 'email', 'sms'];
    if (typeof title !== 'string' || !title.trim() || title.length > 120 || typeof message !== 'string' || !message.trim() || message.length > 2000) {
      return sendError(res, 'Enter a title and message (up to 120 and 2,000 characters)', 400);
    }
    if (!Array.isArray(roles) || roles.length === 0 || roles.some((role: unknown) => !validRoles.includes(String(role)))) {
      return sendError(res, 'Choose at least one valid recipient group', 400);
    }
    if (!Array.isArray(channels) || channels.some((channel: unknown) => !validChannels.includes(String(channel)))) {
      return sendError(res, 'Choose a valid delivery channel', 400);
    }
    const users = await prisma.user.findMany({
      where: { role: { in: roles } },
      select: { id: true, email: true, phone: true, role: true },
    });

    // Create in-app notifications
    await prisma.notification.createMany({
      data: users.map((u) => ({ userId: u.id, title: title.trim(), message: message.trim() })),
    });

    // Push via Socket.IO
    if (channels.includes('socket')) {
      try {
        const io = getIO();
        users.forEach(user => io.to(`user:${user.id}`).emit('notification', { title: title.trim(), message: message.trim() }));
      } catch { /* The in-app notification is already persisted. */ }
    }

    // Email
    if (channels?.includes('email')) {
      const safeTitle = escapeHtml(title.trim());
      const safeMessage = escapeHtml(message.trim()).replace(/\r?\n/g, '<br>');
      await Promise.allSettled(users.map((u) => sendEmail({ to: u.email, subject: title.trim(), html: `<h2>${safeTitle}</h2><p>${safeMessage}</p>` })));
    }

    // SMS
    if (channels?.includes('sms')) {
      await Promise.allSettled(users.filter(u => u.phone).map((u) => sendSMS(u.phone!, message)));
    }

    return sendSuccess(res, null, `Notification sent to ${users.length} users`);
  } catch (err) { next(err); }
}

export async function markRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.user!.id }, data: { read: true } });
    if (!result.count) return sendError(res, 'Notification not found', 404);
    return sendSuccess(res, null, 'Marked as read');
  } catch (err) { next(err); }
}

export async function markAllRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.notification.updateMany({ where: { userId: req.user!.id, read: false }, data: { read: true } });
    return sendSuccess(res, null, 'All notifications marked as read');
  } catch (err) { next(err); }
}
