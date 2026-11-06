import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendSuccess, sendPaginated, sendError } from '../../utils/apiResponse';
import { notifyUsers } from '../../utils/inAppNotifications';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const where: any = {};
    if (req.user!.role === 'STUDENT') {
      const student = await prisma.student.findUnique({ where: { userId: req.user!.id }, select: { classId: true } });
      if (!student?.classId) return sendPaginated(res, [], 0, page, limit);
      where.classId = student.classId;
    } else if (req.user!.role === 'TEACHER') {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
      const classes = teacher ? await prisma.class.findMany({ where: { OR: [{ teacherId: teacher.id }, { timetable: { some: { teacherId: teacher.id } } }] }, select: { id: true } }) : [];
      where.classId = { in: classes.map(cls => cls.id) };
    }
    const [exams, total] = await Promise.all([
      prisma.exam.findMany({
        skip: (page - 1) * limit, take: limit,
        include: { subject: true, class: true },
        where,
        orderBy: { examDate: 'desc' },
      }),
      prisma.exam.count({ where }),
    ]);
    return sendPaginated(res, exams, total, page, limit);
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const invalid = await validateExam(req.body, req.user!.id);
    if (invalid) return sendError(res, invalid, 400);
    const exam = await prisma.exam.create({ data: examData(req.body) });
    return sendSuccess(res, exam, 'Exam created', 201);
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: { subject: true, class: true },
    });
    if (!exam) return sendError(res, 'No Exam found', 404);
    if (req.user!.role === 'STUDENT') {
      const student = await prisma.student.findUnique({ where: { userId: req.user!.id }, select: { classId: true } });
      if (!student?.classId || student.classId !== exam.classId) return sendError(res, 'Exam not found', 404);
    }
    if (req.user!.role === 'TEACHER' && !(await teacherCanTeach(req.user!.id, exam.classId))) return sendError(res, 'Exam not found', 404);
    return sendSuccess(res, exam);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role === 'TEACHER') {
      const existing = await prisma.exam.findUnique({ where: { id: req.params.id }, select: { classId: true } });
      if (!existing || !(await teacherCanTeach(req.user!.id, existing.classId))) return sendError(res, 'Exam not found', 404);
    }
    const invalid = await validateExam(req.body, req.user!.id);
    if (invalid) return sendError(res, invalid, 400);
    const exam = await prisma.exam.update({ where: { id: req.params.id }, data: examData(req.body) });
    return sendSuccess(res, exam);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.exam.delete({ where: { id: req.params.id } });
    return sendSuccess(res, null, 'Exam deleted');
  } catch (err) { next(err); }
}

export async function addResults(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // req.body.results = [{ studentId, score, grade, remarks }]
    const { results } = req.body;
    if (!Array.isArray(results) || results.length === 0 || results.length > 1000) return sendError(res, 'Add at least one student result', 400);
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id }, select: { id: true, title: true, classId: true, totalMarks: true } });
    if (!exam) return sendError(res, 'Exam not found', 404);
    if (req.user!.role === 'TEACHER' && !(await teacherCanTeach(req.user!.id, exam.classId))) return sendError(res, 'You cannot enter results for this class', 403);
    const uniqueResults = [...new Map(results.map((result: any) => [result.studentId, result])).values()];
    if (uniqueResults.some((result: any) => typeof result.studentId !== 'string' || !Number.isFinite(Number(result.score)) || Number(result.score) < 0 || Number(result.score) > exam.totalMarks)) {
      return sendError(res, `Each score must be between 0 and ${exam.totalMarks}`, 400);
    }
    const enrolledStudents = await prisma.student.findMany({ where: { id: { in: uniqueResults.map((result: any) => result.studentId) }, classId: exam.classId }, select: { id: true, userId: true, parentEmail: true } });
    if (enrolledStudents.length !== uniqueResults.length) return sendError(res, 'Every result must belong to a student in the exam class', 400);
    const saved = await prisma.$transaction(
      uniqueResults.map((r: any) =>
        prisma.examResult.upsert({
          where: { examId_studentId: { examId: req.params.id, studentId: r.studentId } },
          update: { score: Number(r.score), grade: r.grade || null, remarks: r.remarks || null },
          create: { examId: req.params.id, studentId: r.studentId, score: Number(r.score), grade: r.grade || null, remarks: r.remarks || null },
        })
      )
    );
    const parentEmails = [...new Set(enrolledStudents.map(student => student.parentEmail).filter((email): email is string => Boolean(email)))];
    const parents = await prisma.user.findMany({ where: { email: { in: parentEmails }, role: 'PARENT' }, select: { id: true } });
    await notifyUsers([...enrolledStudents.map(student => student.userId), ...parents.map(parent => parent.id)], 'Exam results available', `Results for ${exam.title} have been recorded. Sign in to SchoolMS to view the scores.`);
    return sendSuccess(res, saved, 'Results saved');
  } catch (err) { next(err); }
}

export async function getResults(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id }, select: { classId: true } });
    if (!exam) return sendError(res, 'Exam not found', 404);
    if (req.user!.role === 'TEACHER' && !(await teacherCanTeach(req.user!.id, exam.classId))) return sendError(res, 'Exam not found', 404);
    const results = await prisma.examResult.findMany({
      where: { examId: req.params.id },
      include: { student: { include: { user: { select: { name: true } } } } },
      orderBy: { score: 'desc' },
    });
    return sendSuccess(res, results);
  } catch (err) { next(err); }
}

export async function getMyResults(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const student = await prisma.student.findUnique({
      where: { userId: req.user!.id },
      select: { id: true },
    });
    if (!student) return sendSuccess(res, []);

    const results = await prisma.examResult.findMany({
      where: { studentId: student.id },
      include: { exam: { include: { subject: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return sendSuccess(res, results.map(result => ({ ...result, percentage: result.exam.totalMarks ? (result.score / result.exam.totalMarks) * 100 : 0 })));
  } catch (err) { next(err); }
}

export async function generateReportCard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { studentId } = req.query;
    if (typeof studentId !== 'string' || !studentId) return sendError(res, 'Choose a student', 400);
    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, classId: true } });
    if (!student) return sendError(res, 'Student not found', 404);
    if (req.user!.role === 'TEACHER' && (!student.classId || !(await teacherCanTeach(req.user!.id, student.classId)))) return sendError(res, 'Student not found', 404);
    const results = await prisma.examResult.findMany({
      where: { studentId: studentId as string },
      include: { exam: { include: { subject: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const percentages = results.map(result => result.exam.totalMarks ? (result.score / result.exam.totalMarks) * 100 : 0);
    const total = results.reduce((sum, r) => sum + r.score, 0);
    const average = percentages.length ? (percentages.reduce((sum, value) => sum + value, 0) / percentages.length).toFixed(2) : 0;

    return sendSuccess(res, { results: results.map((result, index) => ({ ...result, percentage: percentages[index] })), average, total });
  } catch (err) { next(err); }
}

function examData(body: any) {
  return {
    title: body.title.trim(), description: typeof body.description === 'string' ? body.description.trim() || null : null,
    subjectId: body.subjectId, classId: body.classId, examDate: new Date(body.examDate),
    duration: Number(body.duration), totalMarks: Number(body.totalMarks), passMark: Number(body.passMark),
  };
}

async function validateExam(body: any, userId: string): Promise<string | null> {
  if (typeof body.title !== 'string' || !body.title.trim()) return 'Enter an exam title';
  if (!body.classId || !body.subjectId) return 'Choose a class and subject';
  const examDate = new Date(body.examDate);
  if (!body.examDate || Number.isNaN(examDate.getTime())) return 'Choose a valid exam date and time';
  const duration = Number(body.duration), totalMarks = Number(body.totalMarks), passMark = Number(body.passMark);
  if (!Number.isInteger(duration) || duration < 1 || !Number.isInteger(totalMarks) || totalMarks < 1 || !Number.isFinite(passMark) || passMark < 0 || passMark > totalMarks) return 'Check the exam duration and mark limits';
  const cls = await prisma.class.findUnique({ where: { id: body.classId }, include: { subjects: { select: { id: true } } } });
  if (!cls) return 'Class not found';
  if (!cls.subjects.some(subject => subject.id === body.subjectId)) return 'Add this subject to the class before scheduling the exam';
  if (!(await prisma.subject.findUnique({ where: { id: body.subjectId }, select: { id: true } }))) return 'Subject not found';
  if (body.duration === undefined || body.totalMarks === undefined || body.passMark === undefined) return 'Enter duration, total marks, and pass mark';
  const teacher = await prisma.teacher.findUnique({ where: { userId }, select: { id: true } });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === 'TEACHER' && (!teacher || !(await teacherCanTeach(userId, cls.id, body.subjectId)))) return 'You can only schedule exams for a class and subject you teach';
  return null;
}

async function teacherCanTeach(userId: string, classId: string, subjectId?: string): Promise<boolean> {
  const teacher = await prisma.teacher.findUnique({ where: { userId }, select: { id: true } });
  if (!teacher) return false;
  const cls = await prisma.class.findUnique({ where: { id: classId }, select: { teacherId: true } });
  if (cls?.teacherId === teacher.id) return true;
  return Boolean(await prisma.timetableSlot.findFirst({ where: { classId, teacherId: teacher.id, ...(subjectId ? { subjectId } : {}) }, select: { id: true } }));
}
