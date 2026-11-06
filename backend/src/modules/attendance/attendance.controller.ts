import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendSuccess, sendError } from '../../utils/apiResponse';
import { notifyUsers } from '../../utils/inAppNotifications';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { classId, date, studentId } = req.query;
    const where: any = {};
    if (classId) where.classId = classId;
    if (date) where.date = new Date(date as string);
    if (studentId) where.studentId = studentId;

    if (req.user!.role === 'STUDENT') {
      const student = await prisma.student.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
      where.studentId = student?.id || '__no_student__';
    } else if (req.user!.role === 'PARENT') {
      const linked = await prisma.student.findMany({ where: { parentEmail: req.user!.email }, select: { id: true } });
      const linkedIds = linked.map(student => student.id);
      where.studentId = studentId && linkedIds.includes(String(studentId)) ? String(studentId) : { in: linkedIds };
    } else if (req.user!.role === 'TEACHER') {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
      if (!teacher) return sendSuccess(res, []);
      const taughtClasses = await prisma.class.findMany({ where: { OR: [{ teacherId: teacher.id }, { timetable: { some: { teacherId: teacher.id } } }] }, select: { id: true } });
      const ids = taughtClasses.map(cls => cls.id);
      if (classId && !ids.includes(String(classId))) return sendError(res, 'You do not teach this class', 403);
      where.classId = classId ? String(classId) : { in: ids };
    }

    const records = await prisma.attendance.findMany({
      where,
      include: { student: { include: { user: { select: { name: true, avatar: true } } } } },
      orderBy: { date: 'desc' },
      take: 100,
    });
    return sendSuccess(res, records);
  } catch (err) { next(err); }
}

export async function markBulk(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // req.body.records = [{ studentId, status, note }]
    const { classId, date, records } = req.body;
    const attendanceDate = new Date(date);
    const validStatuses = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
    if (typeof classId !== 'string' || !classId || !date || Number.isNaN(attendanceDate.getTime())) return sendError(res, 'Choose a class and valid attendance date', 400);
    if (!Array.isArray(records) || records.length === 0 || records.length > 500) return sendError(res, 'Select at least one student to mark attendance', 400);
    if (records.some((record: any) => typeof record.studentId !== 'string' || !validStatuses.includes(record.status))) return sendError(res, 'Each student needs a valid attendance status', 400);
    const cls = await prisma.class.findUnique({ where: { id: classId }, select: { id: true, teacherId: true, timetable: { where: { teacher: { userId: req.user!.id } }, select: { id: true }, take: 1 } } });
    if (!cls) return sendError(res, 'Class not found', 404);
    if (req.user!.role === 'TEACHER') {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
      if (!teacher || (cls.teacherId !== teacher.id && cls.timetable.length === 0)) return sendError(res, 'You do not teach this class', 403);
    }
    const uniqueRecords = [...new Map(records.map((record: any) => [record.studentId, record])).values()];
    const matchingStudents = await prisma.student.count({ where: { id: { in: uniqueRecords.map((record: any) => record.studentId) }, classId } });
    if (matchingStudents !== uniqueRecords.length) return sendError(res, 'Every selected student must belong to this class', 400);

    const created = await prisma.$transaction(
      uniqueRecords.map((r: any) =>
        prisma.attendance.upsert({
          where: { studentId_date: { studentId: r.studentId, date: attendanceDate } },
          update: { classId, status: r.status, note: typeof r.note === 'string' ? r.note.trim() : null, markedById: req.user!.id },
          create: { studentId: r.studentId, classId, date: attendanceDate, status: r.status, note: typeof r.note === 'string' ? r.note.trim() : null, markedById: req.user!.id },
        })
      )
    );
    const alertRecords = uniqueRecords.filter((record: any) => record.status === 'ABSENT' || record.status === 'LATE');
    if (alertRecords.length) {
      const affected = await prisma.student.findMany({ where: { id: { in: alertRecords.map((record: any) => record.studentId) } }, select: { id: true, userId: true, parentEmail: true } });
      const parentEmails = [...new Set(affected.map(student => student.parentEmail).filter((email): email is string => Boolean(email)))];
      const parents = await prisma.user.findMany({ where: { email: { in: parentEmails }, role: 'PARENT' }, select: { id: true, email: true } });
      const parentByEmail = new Map(parents.map(parent => [parent.email.toLowerCase(), parent.id]));
      await Promise.all(alertRecords.map(async (record: any) => {
        const student = affected.find(item => item.id === record.studentId);
        if (!student) return;
        const recipients = [student.userId, student.parentEmail ? parentByEmail.get(student.parentEmail.toLowerCase()) : undefined].filter((id): id is string => Boolean(id));
        await notifyUsers(recipients, 'Attendance updated', `Attendance was marked ${record.status.toLowerCase()} on ${attendanceDate.toLocaleDateString()}.`);
      }));
    }
    return sendSuccess(res, created, 'Attendance marked');
  } catch (err) { next(err); }
}

export async function summary(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { studentId, from, to } = req.query;
    const where: any = {};
    if (req.user!.role === 'STUDENT') {
      const student = await prisma.student.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
      where.studentId = student?.id || '__no_student__';
    } else if (req.user!.role === 'PARENT') {
      const linked = await prisma.student.findMany({ where: { parentEmail: req.user!.email }, select: { id: true } });
      const linkedIds = linked.map(student => student.id);
      where.studentId = studentId && linkedIds.includes(String(studentId)) ? String(studentId) : { in: linkedIds };
    } else if (req.user!.role === 'TEACHER') {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
      if (!teacher) return sendSuccess(res, {});
      const classes = await prisma.class.findMany({ where: { OR: [{ teacherId: teacher.id }, { timetable: { some: { teacherId: teacher.id } } }] }, select: { id: true } });
      const classIds = classes.map(cls => cls.id);
      if (req.query.classId && !classIds.includes(String(req.query.classId))) return sendError(res, 'You do not teach this class', 403);
      where.classId = req.query.classId ? String(req.query.classId) : { in: classIds };
      if (studentId) where.studentId = studentId;
    } else if (studentId) where.studentId = studentId;
    if (req.query.classId) where.classId = req.query.classId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from as string);
      if (to) where.date.lte = new Date(to as string);
    }

    const grouped = await prisma.attendance.groupBy({
      by: ['status'],
      where,
      _count: { status: true },
    });

    const summary = grouped.reduce((acc: any, g) => {
      acc[g.status.toLowerCase()] = g._count.status;
      return acc;
    }, {});

    return sendSuccess(res, summary);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const validStatuses = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
    if (!validStatuses.includes(req.body.status)) return sendError(res, 'Choose a valid attendance status', 400);
    if (req.user!.role === 'TEACHER') {
      const record = await prisma.attendance.findUnique({ where: { id: req.params.id }, include: { class: { select: { teacherId: true, timetable: { where: { teacher: { userId: req.user!.id } }, select: { id: true }, take: 1 } } } } });
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
      if (!record || !teacher || (record.class.teacherId !== teacher.id && record.class.timetable.length === 0)) return sendError(res, 'Attendance record not found', 404);
    }
    const record = await prisma.attendance.update({
      where: { id: req.params.id },
      data: { status: req.body.status, note: typeof req.body.note === 'string' ? req.body.note.trim() : null, markedById: req.user!.id },
    });
    return sendSuccess(res, record);
  } catch (err) { next(err); }
}
