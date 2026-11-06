import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendSuccess, sendError } from '../../utils/apiResponse';
import { withCache, invalidatePattern } from '../../utils/cache';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const classId = (req.query.classId as string) || '';
    const teacherId = (req.query.teacherId as string) || '';
    const slots = await withCache(`timetable:${classId}:${teacherId}`, 600, async () => {
      const where: any = {};
      if (classId) where.classId = classId;
      if (teacherId) where.teacherId = teacherId;
      return prisma.timetableSlot.findMany({
        where,
        include: { subject: true, teacher: { include: { user: { select: { name: true } } } }, class: true },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
    });
    return sendSuccess(res, slots);
  } catch (err) { next(err); }
}

export async function listMy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const teacher = await prisma.teacher.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
    if (!teacher) return sendSuccess(res, []);
    const slots = await withCache(`timetable:my:${teacher.id}`, 600, () =>
      prisma.timetableSlot.findMany({
        where: { teacherId: teacher.id },
        include: { subject: true, class: true },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      })
    );
    return sendSuccess(res, slots);
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const invalid = await validateSlot(req.body);
    if (invalid) return sendError(res, invalid, 400);
    const conflict = await findConflict(req.body);
    if (conflict) return sendError(res, conflict, 409);
    const { classId, subjectId, teacherId, dayOfWeek, startTime, endTime, room } = req.body;
    const slot = await prisma.timetableSlot.create({ data: { classId, subjectId, teacherId, dayOfWeek, startTime, endTime, room: room || null } });
    await invalidatePattern('timetable:*');
    return sendSuccess(res, slot, 'Slot created', 201);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const invalid = await validateSlot(req.body);
    if (invalid) return sendError(res, invalid, 400);
    const conflict = await findConflict(req.body, req.params.id);
    if (conflict) return sendError(res, conflict, 409);
    const { classId, subjectId, teacherId, dayOfWeek, startTime, endTime, room } = req.body;
    const slot = await prisma.timetableSlot.update({ where: { id: req.params.id }, data: { classId, subjectId, teacherId, dayOfWeek, startTime, endTime, room: room || null } });
    await invalidatePattern('timetable:*');
    return sendSuccess(res, slot);
  } catch (err) { next(err); }
}

const validDays = new Set(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']);
const validTime = /^([01]\d|2[0-3]):[0-5]\d$/;

async function validateSlot(body: any): Promise<string | null> {
  if (!body.classId || !body.subjectId || !body.teacherId) return 'Choose a class, subject, and teacher';
  if (!validDays.has(body.dayOfWeek)) return 'Choose a valid day';
  if (typeof body.startTime !== 'string' || !validTime.test(body.startTime) || typeof body.endTime !== 'string' || !validTime.test(body.endTime) || body.endTime <= body.startTime) return 'Enter a valid start and end time';
  const [classRow, subject, teacher] = await Promise.all([
    prisma.class.findUnique({ where: { id: body.classId }, select: { id: true } }),
    prisma.subject.findUnique({ where: { id: body.subjectId }, select: { id: true } }),
    prisma.teacher.findUnique({ where: { id: body.teacherId }, select: { id: true } }),
  ]);
  if (!classRow || !subject || !teacher) return 'The selected class, subject, or teacher no longer exists';
  return null;
}

async function findConflict(body: any, ignoreId?: string): Promise<string | null> {
  const slots = await prisma.timetableSlot.findMany({
    where: { dayOfWeek: body.dayOfWeek, ...(ignoreId ? { id: { not: ignoreId } } : {}), OR: [
      { classId: body.classId },
      { teacherId: body.teacherId },
      ...(body.room?.trim() ? [{ room: body.room.trim() }] : []),
    ] },
    select: { classId: true, teacherId: true, room: true, startTime: true, endTime: true },
  });
  const overlapping = slots.filter(slot => body.startTime < slot.endTime && body.endTime > slot.startTime);
  if (overlapping.some(slot => slot.classId === body.classId)) return 'This class already has a period at that time';
  if (overlapping.some(slot => slot.teacherId === body.teacherId)) return 'This teacher is already scheduled at that time';
  if (body.room?.trim() && overlapping.some(slot => slot.room?.toLowerCase() === body.room.trim().toLowerCase())) return 'This room is already in use at that time';
  return null;
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.timetableSlot.delete({ where: { id: req.params.id } });
    await invalidatePattern('timetable:*');
    return sendSuccess(res, null, 'Slot deleted');
  } catch (err) { next(err); }
}
