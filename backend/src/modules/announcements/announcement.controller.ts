import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendSuccess, sendError } from '../../utils/apiResponse';
import { getIO } from '../../config/socket';
import { sendEmail } from '../../utils/email';
import { withCache, invalidatePattern } from '../../utils/cache';
import { notificationCategoryEnabled, notifyUsers } from '../../utils/inAppNotifications';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const role = req.user!.role;
    const requestedAudience = role === 'ADMIN' ? (req.query.audience as string) || '' : role;
    const announcements = await withCache(`announcements:${role}:${req.user!.id}:${requestedAudience}`, 60, async () => {
      const where: any = {};
      where.OR = [{ expiresAt: null }, { expiresAt: { gt: new Date() } }];
      if (role === 'ADMIN') {
        if (requestedAudience) where.audience = { has: requestedAudience };
      } else {
        where.AND = [{ OR: [{ audience: { has: role } }, { authorId: req.user!.id }] }];
      }
      return prisma.announcement.findMany({
        where,
        include: { author: { select: { name: true, role: true, avatar: true } } },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      });
    });
    return sendSuccess(res, announcements);
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { title, content, audience, pinned, expiresAt, sendEmail: doEmail } = req.body;

    const validRoles = ['ADMIN', 'TEACHER', 'STUDENT', 'PARENT'];
    if (typeof title !== 'string' || !title.trim() || title.length > 120 || typeof content !== 'string' || !content.trim() || content.length > 5000) {
      return sendError(res, 'Enter a title and announcement (up to 120 and 5,000 characters)', 400);
    }
    if (!Array.isArray(audience) || !audience.length || audience.some((role: unknown) => !validRoles.includes(String(role)))) {
      return sendError(res, 'Choose at least one valid audience', 400);
    }

    const announcement = await prisma.announcement.create({
      data: { title, content, audience, pinned: pinned ?? false, authorId: req.user!.id, expiresAt: expiresAt ? new Date(expiresAt) : null },
      include: { author: { select: { name: true, role: true } } },
    });

    const users = audience?.length ? await prisma.user.findMany({
      where: { role: { in: audience } },
      select: { id: true, email: true, notificationPreferences: true },
    }) : [];
    const recipients = users.filter(user => notificationCategoryEnabled(user.notificationPreferences, 'announcements'));
    await notifyUsers(recipients.map(user => user.id), 'New announcement', `${title.trim()}: ${content.trim()}`, 'announcements');

    // Deliver in real time only to users who have announcements enabled.
    try {
      const io = getIO();
      recipients.forEach(user => io.to(`user:${user.id}`).emit('announcement:new', announcement));
    } catch { /* The announcement and in-app notice are already saved. */ }

    // Optionally send email broadcast
    if (doEmail && audience?.length) {
      await Promise.allSettled(
        recipients.map(u => sendEmail({ to: u.email, subject: `Notice: ${title.trim()}`, html: `<h2>${escapeHtml(title.trim())}</h2><p>${escapeHtml(content.trim()).replace(/\r?\n/g, '<br>')}</p>` }))
      );
    }

    await invalidatePattern('announcements:*');
    return sendSuccess(res, announcement, 'Announcement created', 201);
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const announcement = await prisma.announcement.findUnique({
      where: { id: req.params.id },
      include: { author: { select: { name: true, role: true, avatar: true } } },
    });
    if (!announcement || (req.user!.role !== 'ADMIN' && announcement.authorId !== req.user!.id && !announcement.audience.includes(req.user!.role))) return sendError(res, 'Announcement not found', 404);
    return sendSuccess(res, announcement);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'ADMIN') {
      const current = await prisma.announcement.findUnique({ where: { id: req.params.id }, select: { authorId: true } });
      if (!current || current.authorId !== req.user!.id) return sendError(res, 'Announcement not found', 404);
    }
    const announcement = await prisma.announcement.update({
      where: { id: req.params.id },
      data: req.body,
    });
    await invalidatePattern('announcements:*');
    return sendSuccess(res, announcement);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.announcement.delete({ where: { id: req.params.id } });
    await invalidatePattern('announcements:*');
    return sendSuccess(res, null, 'Deleted');
  } catch (err) { next(err); }
}

export async function togglePin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const current = await prisma.announcement.findUniqueOrThrow({ where: { id: req.params.id } });
    const updated = await prisma.announcement.update({
      where: { id: req.params.id },
      data: { pinned: !current.pinned },
    });
    return sendSuccess(res, updated, `Announcement ${updated.pinned ? 'pinned' : 'unpinned'}`);
  } catch (err) { next(err); }
}
