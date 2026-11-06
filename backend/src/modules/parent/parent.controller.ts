import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendSuccess, sendError } from '../../utils/apiResponse';

// Parents are linked to students via parentEmail matching their user email
async function getLinkedStudents(parentEmail: string) {
  return prisma.student.findMany({
    where: { parentEmail },
    include: {
      user: { select: { name: true, email: true, avatar: true } },
      class: { include: { teacher: { include: { user: { select: { name: true } } } } } },
    },
  });
}

async function getAccessibleChild(req: AuthRequest, studentId: string) {
  return prisma.student.findFirst({
    where: req.user!.role === 'ADMIN' ? { id: studentId } : { id: studentId, parentEmail: req.user!.email },
    include: {
      user: { select: { name: true, email: true, avatar: true } },
      class: { include: { teacher: { include: { user: { select: { name: true } } } } } },
    },
  });
}

export async function getChildren(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const children = await getLinkedStudents(req.user!.email);
    return sendSuccess(res, children);
  } catch (err) { next(err); }
}

export async function getChildOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { studentId } = req.params;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const student = await getAccessibleChild(req, studentId);
    if (!student) return sendError(res, 'Student not found for this parent account', 404);
    const [attendanceSummary, recentGrades, pendingFees, upcomingAssignments] = await Promise.all([
      prisma.attendance.groupBy({ by: ['status'], where: { studentId }, _count: { status: true } }),
      prisma.examResult.findMany({ where: { studentId }, include: { exam: { include: { subject: true } } }, orderBy: { createdAt: 'desc' }, take: 5 }),
      prisma.feeAssignment.findMany({ where: { studentId }, include: { fee: true }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }] }),
      student.classId ? prisma.assignment.findMany({ where: { classId: student.classId, dueDate: { gte: today } }, include: { subject: true, submissions: { where: { studentId }, select: { id: true, submittedAt: true } } }, orderBy: { dueDate: 'asc' }, take: 5 }) : Promise.resolve([]),
    ]);

    const attendance = attendanceSummary.reduce((acc: any, g) => { acc[g.status] = g._count.status; return acc; }, {});
    const normalizedGrades = recentGrades.map(result => ({ ...result, percentage: result.exam.totalMarks ? (result.score / result.exam.totalMarks) * 100 : 0 }));
    const avgGrade = normalizedGrades.length ? (normalizedGrades.reduce((sum, result) => sum + result.percentage, 0) / normalizedGrades.length).toFixed(1) : null;
    const remainingFees = pendingFees.reduce((sum, assignment) => sum + Math.max(0, assignment.amount - assignment.amountPaid), 0);
    const unpaidCount = pendingFees.filter(assignment => assignment.amountPaid < assignment.amount).length;
    const upcoming = upcomingAssignments.map(assignment => ({ ...assignment, submitted: Boolean(assignment.submissions[0]?.submittedAt) }));

    return sendSuccess(res, { student, attendance, avgGrade, recentGrades: normalizedGrades, pendingFees: { _sum: { amount: remainingFees }, _count: unpaidCount }, upcomingAssignments: upcoming, feeAssignments: pendingFees });
  } catch (err) { next(err); }
}

export async function getChildAttendance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!(await getAccessibleChild(req, req.params.studentId))) return sendError(res, 'Student not found for this parent account', 404);
    const records = await prisma.attendance.findMany({
      where: { studentId: req.params.studentId },
      orderBy: { date: 'desc' },
      take: 90,
    });
    return sendSuccess(res, records);
  } catch (err) { next(err); }
}

export async function getChildGrades(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!(await getAccessibleChild(req, req.params.studentId))) return sendError(res, 'Student not found for this parent account', 404);
    const grades = await prisma.examResult.findMany({
      where: { studentId: req.params.studentId },
      include: { exam: { include: { subject: true, class: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return sendSuccess(res, grades.map(result => ({ ...result, percentage: result.exam.totalMarks ? (result.score / result.exam.totalMarks) * 100 : 0 })));
  } catch (err) { next(err); }
}

export async function getChildFees(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!(await getAccessibleChild(req, req.params.studentId))) return sendError(res, 'Student not found for this parent account', 404);
    const [assignments, payments] = await Promise.all([
      prisma.feeAssignment.findMany({ where: { studentId: req.params.studentId }, include: { fee: true }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }] }),
      prisma.feePayment.findMany({ where: { studentId: req.params.studentId }, include: { fee: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    return sendSuccess(res, { assignments, payments });
  } catch (err) { next(err); }
}

export async function getChildAssignments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const student = await getAccessibleChild(req, req.params.studentId);
    if (!student) return sendError(res, 'Student not found for this parent account', 404);
    const assignments = await prisma.assignment.findMany({
      where: { classId: student.classId ?? undefined },
      include: {
        subject: true,
        submissions: { where: { studentId: req.params.studentId } },
      },
      orderBy: { dueDate: 'asc' },
    });
    return sendSuccess(res, assignments.map(assignment => ({ ...assignment, mySubmission: assignment.submissions[0] ?? null, submitted: Boolean(assignment.submissions[0]?.submittedAt) })));
  } catch (err) { next(err); }
}

export async function getChildTimetable(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const student = await getAccessibleChild(req, req.params.studentId);
    if (!student) return sendError(res, 'Student not found for this parent account', 404);
    const timetable = await prisma.timetableSlot.findMany({
      where: { classId: student.classId ?? undefined },
      include: { subject: true, teacher: { include: { user: { select: { name: true } } } } },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return sendSuccess(res, timetable);
  } catch (err) { next(err); }
}
