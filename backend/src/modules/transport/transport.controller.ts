import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { Prisma } from '@prisma/client';
import { sendSuccess, sendError } from '../../utils/apiResponse';

export async function listRoutes(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const routes = await prisma.transportRoute.findMany({
      include: { _count: { select: { students: true } } },
    });
    return sendSuccess(res, routes);
  } catch (err) { next(err); }
}

export async function createRoute(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const route = await prisma.transportRoute.create({ data: req.body });
    return sendSuccess(res, route, 'Route created', 201);
  } catch (err) { next(err); }
}

export async function updateRoute(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const route = await prisma.transportRoute.update({ where: { id: req.params.id }, data: req.body });
    return sendSuccess(res, route);
  } catch (err) { next(err); }
}

export async function assignStudent(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const studentId = req.body.studentId;
    if (typeof studentId !== 'string' || !studentId) return sendError(res, 'Choose a student', 400);

    const result = await prisma.$transaction(async tx => {
      const [route, student] = await Promise.all([
        tx.transportRoute.findUnique({ where: { id: req.params.id } }),
        tx.student.findUnique({ where: { id: studentId }, select: { id: true, transportRouteId: true } }),
      ]);
      if (!route) return { error: 'route-not-found' as const };
      if (!student) return { error: 'student-not-found' as const };
      if (student.transportRouteId === route.id) return { alreadyAssigned: true as const };
      if (student.transportRouteId) return { error: 'student-assigned' as const };

      const assigned = await tx.student.count({ where: { transportRouteId: route.id } });
      if (assigned >= route.capacity) return { error: 'route-full' as const };
      const changed = await tx.student.updateMany({ where: { id: student.id, transportRouteId: null }, data: { transportRouteId: route.id } });
      if (changed.count !== 1) return { error: 'student-assigned' as const };
      return { alreadyAssigned: false as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if ('error' in result) {
      switch (result.error) {
        case 'route-not-found': return sendError(res, 'Route not found', 404);
        case 'student-not-found': return sendError(res, 'Student not found', 404);
        case 'student-assigned': return sendError(res, 'This student is already assigned to another route', 409);
        case 'route-full': return sendError(res, 'This route has reached its capacity', 409);
      }
    }
    return sendSuccess(res, result, result.alreadyAssigned ? 'Student is already on this route' : 'Student assigned to route');
  } catch (err) { next(err); }
}

export async function listRouteStudents(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const route = await prisma.transportRoute.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!route) return sendError(res, 'Route not found', 404);
    const students = await prisma.student.findMany({
      where: { transportRouteId: route.id },
      include: { user: { select: { name: true, email: true } }, class: { select: { name: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return sendSuccess(res, students);
  } catch (err) { next(err); }
}

export async function listUnassignedStudents(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const students = await prisma.student.findMany({
      where: { transportRouteId: null },
      include: { user: { select: { name: true, email: true } }, class: { select: { name: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return sendSuccess(res, students);
  } catch (err) { next(err); }
}

export async function unassignStudent(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await prisma.student.updateMany({
      where: { id: req.params.studentId, transportRouteId: req.params.id },
      data: { transportRouteId: null },
    });
    if (result.count === 0) return sendError(res, 'Student is not assigned to this route', 404);
    return sendSuccess(res, null, 'Student removed from route');
  } catch (err) { next(err); }
}
