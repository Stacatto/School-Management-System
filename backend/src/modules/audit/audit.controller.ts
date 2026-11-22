import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendPaginated } from '../../utils/apiResponse';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit) || 25)));
    const where = {
      ...(typeof req.query.resource === 'string' ? { resource: { contains: req.query.resource } } : {}),
      ...(typeof req.query.actorId === 'string' ? { userId: req.query.actorId } : {}),
    };
    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return sendPaginated(res, entries, total, page, limit);
  } catch (error) { next(error); }
}
