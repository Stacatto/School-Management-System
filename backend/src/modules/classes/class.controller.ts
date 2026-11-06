import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendSuccess, sendPaginated, sendError } from '../../utils/apiResponse';
import { withCache, invalidate, invalidatePattern } from '../../utils/cache';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    let where: any = {};
    if (req.user!.role === 'STUDENT') {
      const student = await prisma.student.findUnique({ where: { userId: req.user!.id }, select: { classId: true } });
      where.id = student?.classId || '__no_class__';
    } else if (req.user!.role === 'TEACHER') {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
      where = teacher ? { OR: [{ teacherId: teacher.id }, { timetable: { some: { teacherId: teacher.id } } }] } : { id: '__no_class__' };
    } else if (req.user!.role === 'PARENT') {
      const students = await prisma.student.findMany({ where: { parentEmail: req.user!.email }, select: { classId: true } });
      const classIds = [...new Set(students.map(student => student.classId).filter((id): id is string => Boolean(id)))];
      where.id = { in: classIds };
    }
    const result = await withCache(`classes:list:${req.user!.id}:${page}:${limit}`, 300, async () => {
      const [classes, total] = await Promise.all([
        prisma.class.findMany({
          skip: (page - 1) * limit, take: limit,
          where,
          include: { teacher: { include: { user: { select: { name: true } } } }, subjects: { orderBy: { name: 'asc' } }, _count: { select: { students: true, timetable: true } } },
        }),
        prisma.class.count({ where }),
      ]);
      return { classes, total };
    });
    return sendPaginated(res, result.classes, result.total, page, limit);
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, grade, section, teacherId, academicYear, subjectIds } = req.body;
    if (!name || !grade) return sendError(res, 'name and grade are required', 400);
    if (subjectIds !== undefined && (!Array.isArray(subjectIds) || subjectIds.some((id: unknown) => typeof id !== 'string' || !id))) {
      return sendError(res, 'Choose valid subjects for this class', 400);
    }

    if (teacherId) {
      const teacher = await prisma.teacher.findUnique({ where: { id: teacherId }, select: { id: true } });
      if (!teacher) return sendError(res, 'Invalid teacherId', 400);
    }
    if (subjectIds?.length) {
      const subjects = await prisma.subject.count({ where: { id: { in: [...new Set<string>(subjectIds)] } } });
      if (subjects !== new Set(subjectIds).size) return sendError(res, 'One or more selected subjects could not be found', 400);
    }

    const cls = await prisma.class.create({
      data: {
        name, grade, section,
        teacherId: teacherId || undefined,
        academicYear: academicYear || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
        subjects: subjectIds?.length ? { connect: subjectIds.map((id: string) => ({ id })) } : undefined,
      },
      include: { teacher: { include: { user: { select: { name: true } } } }, subjects: { orderBy: { name: 'asc' } }, _count: { select: { students: true, timetable: true } } },
    });
    await invalidatePattern('classes:*');
    return sendSuccess(res, cls, 'Class created', 201);
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const cls = await withCache(`classes:${req.params.id}`, 300, () =>
      prisma.class.findUnique({
        where: { id: req.params.id },
        include: { teacher: true, subjects: true, _count: { select: { students: true } } },
      })
    );
    if (!cls) return sendError(res, 'No Class found', 404);
    return sendSuccess(res, cls);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, grade, section, teacherId, academicYear, subjectIds } = req.body;
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) return sendError(res, 'Enter a class name', 400);
    if (grade !== undefined && (typeof grade !== 'string' || !grade.trim())) return sendError(res, 'Enter a grade', 400);
    if (teacherId && !(await prisma.teacher.findUnique({ where: { id: teacherId }, select: { id: true } }))) return sendError(res, 'Choose a valid class teacher', 400);
    if (subjectIds !== undefined && (!Array.isArray(subjectIds) || subjectIds.some((id: unknown) => typeof id !== 'string' || !id))) {
      return sendError(res, 'Choose valid subjects for this class', 400);
    }
    if (subjectIds?.length) {
      const uniqueSubjectIds = [...new Set<string>(subjectIds)];
      const subjects = await prisma.subject.count({ where: { id: { in: uniqueSubjectIds } } });
      if (subjects !== uniqueSubjectIds.length) return sendError(res, 'One or more selected subjects could not be found', 400);
    }
    const cls = await prisma.class.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(grade !== undefined ? { grade: grade.trim() } : {}),
        ...(section !== undefined ? { section: section || null } : {}),
        ...(teacherId !== undefined ? { teacherId: teacherId || null } : {}),
        ...(academicYear !== undefined ? { academicYear } : {}),
        ...(subjectIds !== undefined ? { subjects: { set: [...new Set<string>(subjectIds)].map(id => ({ id })) } } : {}),
      },
      include: { teacher: { include: { user: { select: { name: true } } } }, subjects: { orderBy: { name: 'asc' } }, _count: { select: { students: true, timetable: true } } },
    });
    await invalidate(`classes:${req.params.id}`);
    await invalidatePattern('classes:list:*');
    return sendSuccess(res, cls);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.class.delete({ where: { id: req.params.id } });
    await invalidate(`classes:${req.params.id}`);
    await invalidatePattern('classes:list:*');
    return sendSuccess(res, null, 'Class deleted');
  } catch (err) { next(err); }
}

export async function listMy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const teacher = await prisma.teacher.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
    if (!teacher) return sendSuccess(res, []);
    const classes = await prisma.class.findMany({
      where: { teacherId: teacher.id },
      include: { subjects: { orderBy: { name: 'asc' } }, _count: { select: { students: true, timetable: true } } },
    });
    return sendSuccess(res, classes);
  } catch (err) { next(err); }
}

export async function getStudents(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const cls = await prisma.class.findUnique({ where: { id: req.params.id }, select: { id: true, teacherId: true } });
    if (!cls) return sendError(res, 'Class not found', 404);
    if (req.user!.role === 'STUDENT') {
      const student = await prisma.student.findUnique({ where: { userId: req.user!.id }, select: { classId: true } });
      if (student?.classId !== cls.id) return sendError(res, 'Class not found', 404);
    } else if (req.user!.role === 'PARENT') {
      const linked = await prisma.student.findFirst({ where: { parentEmail: req.user!.email, classId: cls.id }, select: { id: true } });
      if (!linked) return sendError(res, 'Class not found', 404);
    } else if (req.user!.role === 'TEACHER') {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
      const teaches = teacher && (cls.teacherId === teacher.id || Boolean(await prisma.timetableSlot.findFirst({ where: { classId: cls.id, teacherId: teacher.id }, select: { id: true } })));
      if (!teaches) return sendError(res, 'Class not found', 404);
    } else if (req.user!.role !== 'ADMIN') return sendError(res, 'Class not found', 404);
    const students = await withCache(`classes:${req.params.id}:students`, 180, () =>
      prisma.student.findMany({
        where: { classId: req.params.id },
        include: { user: { select: { name: true, email: true, avatar: true } } },
        orderBy: { createdAt: 'asc' },
      })
    );
    return sendSuccess(res, students);
  } catch (err) { next(err); }
}

export async function getTimetable(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const timetable = await prisma.timetableSlot.findMany({
      where: { classId: req.params.id },
      include: { subject: true, teacher: true },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return sendSuccess(res, timetable);
  } catch (err) { next(err); }
}

export async function getSubjects(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const cls = await prisma.class.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { subjects: true },
    });
    return sendSuccess(res, cls.subjects);
  } catch (err) { next(err); }
}
