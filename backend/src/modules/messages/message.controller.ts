import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendSuccess, sendError } from '../../utils/apiResponse';
import { getIO } from '../../config/socket';

export async function listConversations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { participants: { some: { userId: req.user!.id } } },
      include: {
        participants: { include: { user: { select: { name: true, avatar: true, role: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return sendSuccess(res, conversations);
  } catch (err) { next(err); }
}

export async function listRecipients(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const users = await prisma.user.findMany({ where: { id: { not: req.user!.id } }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } });
    return sendSuccess(res, users);
  } catch (err) { next(err); }
}

export async function createConversation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const recipientId = req.body.recipientId;
    if (typeof recipientId !== 'string' || !recipientId || recipientId === req.user!.id) return sendError(res, 'Choose another user', 400);
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
    const participant = await prisma.conversationParticipant.findFirst({ where: { conversationId: req.params.id, userId: req.user!.id } });
    if (!participant) return sendError(res, 'Conversation not found', 404);
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

    let convId = conversationId;
    if (!convId) {
      if (typeof recipientId !== 'string' || !recipientId || recipientId === req.user!.id) return sendError(res, 'Choose another user', 400);
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

    const participants = await prisma.conversationParticipant.findMany({ where: { conversationId: convId }, select: { userId: true } });
    if (!participants.some(p => p.userId === req.user!.id)) return sendError(res, 'Conversation not found', 404);
    const message = await prisma.message.create({
      data: { conversationId: convId, senderId: req.user!.id, content: content.trim() },
      include: { sender: { select: { name: true, avatar: true } } },
    });

    await prisma.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } });

    // Real-time delivery
    participants.filter(p => p.userId !== req.user!.id).forEach(p => getIO().to(`user:${p.userId}`).emit('message:new', message));

    return sendSuccess(res, message, 'Sent', 201);
  } catch (err) { next(err); }
}
