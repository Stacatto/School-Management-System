import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendSuccess, sendPaginated, sendError } from '../../utils/apiResponse';
import { notifyUsers } from '../../utils/inAppNotifications';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const where: any = {};
    let teacherClassIds: string[] | undefined;
    if (req.user?.role === 'TEACHER') {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      const classes = teacher ? await prisma.class.findMany({ where: { OR: [{ teacherId: teacher.id }, { timetable: { some: { teacherId: teacher.id } } }] }, select: { id: true } }) : [];
      teacherClassIds = classes.map(cls => cls.id);
      where.classId = { in: teacherClassIds };
      if (req.query.classId && !teacherClassIds.includes(String(req.query.classId))) return sendError(res, 'You do not teach this class', 403);
    }
    if (req.query.classId) where.classId = req.query.classId;
    if (req.query.subjectId) where.subjectId = req.query.subjectId;
    let studentId: string | undefined;
    if (req.user?.role === 'STUDENT') {
      const student = await prisma.student.findUnique({ where: { userId: req.user.id }, select: { id: true, classId: true } });
      if (!student?.classId) return sendPaginated(res, [], 0, page, limit);
      studentId = student.id;
      where.classId = student.classId;
    }

    const [assignments, total] = await Promise.all([
      prisma.assignment.findMany({
        where, skip: (page - 1) * limit, take: limit,
        include: {
          subject: true,
          class: { select: { id: true, name: true, _count: { select: { students: true } } } },
          createdBy: { select: { name: true } },
          _count: { select: { submissions: true } },
          ...(studentId ? { submissions: { where: { studentId }, select: { id: true, content: true, fileUrl: true, score: true, feedback: true, submittedAt: true } } } : {}),
        },
        orderBy: { dueDate: 'asc' },
      }),
      prisma.assignment.count({ where }),
    ]);
    const scopedAssignments = studentId ? assignments.map(({ submissions, ...assignment }) => ({ ...assignment, mySubmission: submissions[0] ?? null, submitted: Boolean(submissions[0]?.submittedAt) })) : assignments;
    return sendPaginated(res, scopedAssignments, total, page, limit);
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const invalid = await validateAssignment(req.body, req.user!.id);
    if (invalid) return sendError(res, invalid, 400);
    const assignment = await prisma.assignment.create({
      data: {
        title: req.body.title.trim(), description: req.body.description?.trim() || null,
        subjectId: req.body.subjectId, classId: req.body.classId, createdById: req.user!.id,
        dueDate: new Date(req.body.dueDate), totalPoints: Number(req.body.totalPoints), fileUrl: req.body.fileUrl || null,
      },
      include: { subject: true, class: true },
    });
    const students = await prisma.student.findMany({ where: { classId: assignment.classId }, select: { userId: true, parentEmail: true } });
    const parents = await prisma.user.findMany({ where: { email: { in: students.map(student => student.parentEmail).filter((email): email is string => Boolean(email)) }, role: 'PARENT' }, select: { id: true } });
    await notifyUsers([...students.map(student => student.userId), ...parents.map(parent => parent.id)], 'New assignment', `${assignment.title} has been posted for ${assignment.class.name}.`);
    return sendSuccess(res, assignment, 'Assignment created', 201);
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const student = req.user!.role === 'STUDENT' ? await prisma.student.findUnique({ where: { userId: req.user!.id }, select: { classId: true } }) : null;
    const assignment = await prisma.assignment.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        subject: true,
        class: { select: { id: true, name: true, _count: { select: { students: true } } } },
        _count: { select: { submissions: true } },
      },
    });
    if (student && assignment.classId !== student.classId) return sendError(res, 'Assignment not found', 404);
    if (req.user!.role === 'TEACHER' && !(await canManageClass(req.user!.id, assignment.classId))) return sendError(res, 'Assignment not found', 404);
    return sendSuccess(res, assignment);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role === 'TEACHER') {
      const existing = await prisma.assignment.findUnique({ where: { id: req.params.id }, select: { classId: true } });
      if (!existing || !(await canManageClass(req.user!.id, existing.classId))) return sendError(res, 'Assignment not found', 404);
    }
    const invalid = await validateAssignment(req.body, req.user!.id);
    if (invalid) return sendError(res, invalid, 400);
    const assignment = await prisma.assignment.update({ where: { id: req.params.id }, data: {
      title: req.body.title.trim(), description: req.body.description?.trim() || null,
      subjectId: req.body.subjectId, classId: req.body.classId,
      dueDate: new Date(req.body.dueDate), totalPoints: Number(req.body.totalPoints), fileUrl: req.body.fileUrl || null,
    } });
    return sendSuccess(res, assignment);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role === 'TEACHER') {
      const assignment = await prisma.assignment.findUnique({ where: { id: req.params.id }, select: { classId: true } });
      if (!assignment || !(await canManageClass(req.user!.id, assignment.classId))) return sendError(res, 'Assignment not found', 404);
    }
    await prisma.assignment.delete({ where: { id: req.params.id } });
    return sendSuccess(res, null, 'Assignment deleted');
  } catch (err) { next(err); }
}

export async function submit(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const student = await prisma.student.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
    if (!student) return sendSuccess(res, null, 'Student not found', 404);
    const assignment = await prisma.assignment.findUnique({ where: { id: req.params.id }, select: { id: true, classId: true } });
    const enrolledStudent = await prisma.student.findUnique({ where: { id: student.id }, select: { classId: true } });
    if (!assignment || !enrolledStudent || assignment.classId !== enrolledStudent.classId) return sendError(res, 'Assignment not found for your class', 404);
    if (typeof req.body.content !== 'string' || !req.body.content.trim()) return sendError(res, 'Enter your submission before saving', 400);
    if (req.body.content.length > 10000) return sendError(res, 'Submission text must be 10,000 characters or less', 400);

    const submission = await prisma.assignmentSubmission.upsert({
      where: { assignmentId_studentId: { assignmentId: req.params.id, studentId: student.id } },
      update: { content: req.body.content.trim(), submittedAt: new Date() },
      create: { assignmentId: req.params.id, studentId: student.id, content: req.body.content.trim(), submittedAt: new Date() },
    });
    return sendSuccess(res, submission, 'Submitted');
  } catch (err) { next(err); }
}

export async function listSubmissions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const assignment = await prisma.assignment.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        class: {
          include: {
            students: { include: { user: { select: { name: true, email: true, avatar: true } } } },
          },
        },
        submissions: {
          include: { student: { include: { user: { select: { name: true, avatar: true } } } } },
          orderBy: { submittedAt: 'desc' },
        },
      },
    });
    if (req.user!.role === 'TEACHER' && !(await canManageClass(req.user!.id, assignment.classId))) return sendError(res, 'Assignment not found', 404);

    const submittedIds = new Set(assignment.submissions.map(s => s.studentId));
    const allStudents = assignment.class?.students ?? [];

    const pending = allStudents
      .filter(s => !submittedIds.has(s.id))
      .map(s => ({ studentId: s.id, studentName: s.user?.name, admissionNo: s.admissionNo, status: 'PENDING' }));

    return sendSuccess(res, {
      submitted: assignment.submissions,
      pending,
      totalStudents: allStudents.length,
      submittedCount: assignment.submissions.length,
      pendingCount: pending.length,
    });
  } catch (err) { next(err); }
}

export async function gradeSubmission(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const score = Number(req.body.score);
    const assignment = await prisma.assignment.findUnique({ where: { id: req.params.id }, select: { id: true, totalPoints: true, classId: true } });
    if (!assignment) return sendError(res, 'Assignment not found', 404);
    if (req.user!.role === 'TEACHER' && !(await canManageClass(req.user!.id, assignment.classId))) return sendError(res, 'Assignment not found', 404);
    if (!Number.isFinite(score) || score < 0 || score > assignment.totalPoints) return sendError(res, `Score must be between 0 and ${assignment.totalPoints}`, 400);
    const submissionExists = await prisma.assignmentSubmission.findFirst({ where: { id: req.params.subId, assignmentId: assignment.id }, select: { id: true } });
    if (!submissionExists) return sendError(res, 'Submission not found for this assignment', 404);
    const submission = await prisma.assignmentSubmission.update({
      where: { id: req.params.subId },
      data: { score, feedback: typeof req.body.feedback === 'string' ? req.body.feedback.trim() : null, gradedAt: new Date() },
      include: { student: { include: { user: { select: { name: true } } } } },
    });
    return sendSuccess(res, submission, 'Graded');
  } catch (err) { next(err); }
}

async function validateAssignment(body: any, userId: string): Promise<string | null> {
  if (typeof body.title !== 'string' || !body.title.trim()) return 'Enter an assignment title';
  if (typeof body.classId !== 'string' || !body.classId || typeof body.subjectId !== 'string' || !body.subjectId) return 'Choose a class and subject';
  const dueDate = new Date(body.dueDate);
  if (!body.dueDate || Number.isNaN(dueDate.getTime())) return 'Choose a valid due date';
  const totalPoints = Number(body.totalPoints ?? 100);
  if (!Number.isInteger(totalPoints) || totalPoints < 1) return 'Total points must be a positive whole number';
  const cls = await prisma.class.findUnique({ where: { id: body.classId }, include: { subjects: { select: { id: true } } } });
  if (!cls) return 'Class not found';
  if (!cls.subjects.some(subject => subject.id === body.subjectId)) return 'Add this subject to the class before creating the assignment';
  if (!(await prisma.subject.findUnique({ where: { id: body.subjectId }, select: { id: true } }))) return 'Subject not found';
  if (!(await canManageClass(userId, cls.id, body.subjectId))) return 'You can only assign work to a class and subject you teach';
  return null;
}

async function canManageClass(userId: string, classId: string, subjectId?: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, teacher: { select: { id: true } } } });
  if (user?.role === 'ADMIN') return true;
  if (user?.role !== 'TEACHER' || !user.teacher) return false;
  const cls = await prisma.class.findUnique({ where: { id: classId }, select: { teacherId: true } });
  if (cls?.teacherId === user.teacher.id) return true;
  return Boolean(await prisma.timetableSlot.findFirst({ where: { classId, teacherId: user.teacher.id, ...(subjectId ? { subjectId } : {}) }, select: { id: true } }));
}
