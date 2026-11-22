import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendSuccess, sendError } from '../../utils/apiResponse';
import { getIO } from '../../config/socket';
import { notifyUsers } from '../../utils/inAppNotifications';

export async function listConversations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const allowedRecipients = await getAllowedRecipientIds(req.user!.id, req.user!.role, req.user!.email);
    const conversations = await prisma.conversation.findMany({
      where: { participants: { some: { userId: req.user!.id } } },
      include: {
        participants: { include: { user: { select: { name: true, avatar: true, role: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const visibleConversations = conversations.filter(conversation =>
      conversation.participants.some(participant => participant.userId === req.user!.id) &&
      conversation.participants
        .filter(participant => participant.userId !== req.user!.id)
        .every(participant => allowedRecipients.has(participant.userId))
    );
    const withUnreadCounts = await Promise.all(visibleConversations.map(async conversation => ({
      ...conversation,
      unreadCount: await prisma.message.count({
        where: { conversationId: conversation.id, senderId: { not: req.user!.id }, readAt: null },
      }),
    })));
    return sendSuccess(res, withUnreadCounts);
  } catch (err) { next(err); }
}

export async function listRecipients(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const allowedIds = await getAllowedRecipientIds(req.user!.id, req.user!.role, req.user!.email);
    const users = await prisma.user.findMany({ where: { id: { in: [...allowedIds] } }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } });
    return sendSuccess(res, users);
  } catch (err) { next(err); }
}

export async function createConversation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const recipientId = req.body.recipientId;
    if (typeof recipientId !== 'string' || !recipientId || recipientId === req.user!.id) return sendError(res, 'Choose another user', 400);
    const allowedIds = await getAllowedRecipientIds(req.user!.id, req.user!.role, req.user!.email);
    if (!allowedIds.has(recipientId)) return sendError(res, 'You can only message school contacts connected to your account', 403);
    const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { id: true } });
    if (!recipient) return sendError(res, 'User not found', 404);
    const existing = await prisma.conversation.findFirst({ where: { AND: [
      { participants: { some: { userId: req.user!.id } } },
      { participants: { some: { userId: recipientId } } },
    ] } });
    if (existing) return sendSuccess(res, existing);
    const conversation = await prisma.conversation.create({ data: { participants: { create: [{ userId: req.user!.id }, { userId: recipientId }] } } });
    return sendSuccess(res, conversation, 'Conversation created', 201);
  } catch (err) { next(err); }
}

export async function getMessages(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!(await canAccessConversation(req.params.id, req.user!.id, req.user!.role, req.user!.email))) return sendError(res, 'Conversation not found', 404);
    await prisma.message.updateMany({
      where: { conversationId: req.params.id, senderId: { not: req.user!.id }, readAt: null },
      data: { readAt: new Date() },
    });
    const messages = await prisma.message.findMany({
      where: { conversationId: req.params.id },
      include: { sender: { select: { name: true, avatar: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return sendSuccess(res, messages);
  } catch (err) { next(err); }
}

export async function send(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { conversationId, recipientId, content } = req.body;
    if (typeof content !== 'string' || !content.trim()) return sendError(res, 'Message content is required', 400);
    if (content.length > 5000) return sendError(res, 'Messages must be 5,000 characters or fewer', 400);

    let convId = conversationId;
    if (!convId) {
      if (typeof recipientId !== 'string' || !recipientId || recipientId === req.user!.id) return sendError(res, 'Choose another user', 400);
      const allowedIds = await getAllowedRecipientIds(req.user!.id, req.user!.role, req.user!.email);
      if (!allowedIds.has(recipientId)) return sendError(res, 'You can only message school contacts connected to your account', 403);
      const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { id: true } });
      if (!recipient) return sendError(res, 'User not found', 404);
      // Find or create 1-1 conversation
      const existing = await prisma.conversation.findFirst({
        where: {
          AND: [
            { participants: { some: { userId: req.user!.id } } },
            { participants: { some: { userId: recipientId } } },
          ],
        },
      });

      if (existing) {
        convId = existing.id;
      } else {
        const conv = await prisma.conversation.create({
          data: {
            participants: {
              create: [{ userId: req.user!.id }, { userId: recipientId }],
            },
          },
        });
        convId = conv.id;
      }
    }

    if (!(await canAccessConversation(convId, req.user!.id, req.user!.role, req.user!.email))) return sendError(res, 'Conversation not found', 404);
    const participants = await prisma.conversationParticipant.findMany({ where: { conversationId: convId }, select: { userId: true } });
    const message = await prisma.$transaction(async tx => {
      const saved = await tx.message.create({
        data: { conversationId: convId, senderId: req.user!.id, content: content.trim() },
        include: { sender: { select: { name: true, avatar: true } } },
      });
      await tx.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } });
      return saved;
    });

    await notifyUsers(participants.filter(p => p.userId !== req.user!.id).map(p => p.userId), `New message from ${message.sender.name}`, message.content.slice(0, 240), 'messages');

    // The message and its in-app notification are already persisted; realtime delivery is best-effort.
    try {
      const io = getIO();
      participants.filter(p => p.userId !== req.user!.id).forEach(p => io.to(`user:${p.userId}`).emit('message:new', message));
    } catch { /* Keep a successful database save successful if Socket.IO is unavailable. */ }

    return sendSuccess(res, message, 'Sent', 201);
  } catch (err) { next(err); }
}

async function getAllowedRecipientIds(userId: string, role: string, email: string): Promise<Set<string>> {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', id: { not: userId } }, select: { id: true } });
  const allowed = new Set(admins.map(user => user.id));
  if (role === 'ADMIN') {
    const users = await prisma.user.findMany({ where: { id: { not: userId } }, select: { id: true } });
    return new Set(users.map(user => user.id));
  }

  let classIds: string[] = [];
  if (role === 'TEACHER') {
    const teacher = await prisma.teacher.findUnique({ where: { userId }, select: { id: true } });
    if (teacher) {
      const classes = await prisma.class.findMany({
        where: { OR: [{ teacherId: teacher.id }, { timetable: { some: { teacherId: teacher.id } } }] },
        select: { id: true },
      });
      classIds = classes.map(cls => cls.id);
      const students = await prisma.student.findMany({ where: { classId: { in: classIds } }, select: { userId: true, parentEmail: true } });
      students.forEach(student => allowed.add(student.userId));
      const parentEmails = [...new Set(students.map(student => student.parentEmail).filter((value): value is string => Boolean(value)))];
      const parents = parentEmails.length ? await prisma.user.findMany({ where: { email: { in: parentEmails }, role: 'PARENT' }, select: { id: true } }) : [];
      parents.forEach(parent => allowed.add(parent.id));
    }
    return allowed;
  }

  if (role === 'STUDENT') {
    const student = await prisma.student.findUnique({ where: { userId }, select: { classId: true } });
    if (student?.classId) classIds = [student.classId];
  } else if (role === 'PARENT') {
    const students = await prisma.student.findMany({ where: { parentEmail: email }, select: { classId: true } });
    classIds = [...new Set(students.map(student => student.classId).filter((value): value is string => Boolean(value)))];
  }

  if (classIds.length) {
    const [classes, slots] = await Promise.all([
      prisma.class.findMany({ where: { id: { in: classIds }, teacherId: { not: null } }, select: { teacherId: true } }),
      prisma.timetableSlot.findMany({ where: { classId: { in: classIds } }, select: { teacherId: true } }),
    ]);
    const teacherIds = [...new Set([...classes.map(cls => cls.teacherId), ...slots.map(slot => slot.teacherId)].filter((value): value is string => Boolean(value)))];
    if (teacherIds.length) {
      const teachers = await prisma.teacher.findMany({ where: { id: { in: teacherIds } }, select: { userId: true } });
      teachers.forEach(teacher => { if (teacher.userId !== userId) allowed.add(teacher.userId); });
    }
  }

  return allowed;
}

async function canAccessConversation(conversationId: string, userId: string, role: string, email: string): Promise<boolean> {
  const participants = await prisma.conversationParticipant.findMany({ where: { conversationId }, select: { userId: true } });
  if (!participants.some(participant => participant.userId === userId)) return false;
  const otherIds = participants.map(participant => participant.userId).filter(id => id !== userId);
  if (!otherIds.length) return false;
  const allowed = await getAllowedRecipientIds(userId, role, email);
  return otherIds.every(id => allowed.has(id));
}
