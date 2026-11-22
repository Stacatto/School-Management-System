import { NextFunction, Response } from 'express';
import prisma from '../config/database';
import logger from '../utils/logger';
import { AuthRequest } from './auth';

const auditedMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Record successful writes by authenticated users without storing request bodies. */
export function auditMutations(req: AuthRequest, res: Response, next: NextFunction) {
  const isPaymentVerification = req.method === 'GET' && /\/payments\/flutterwave\/verify\/?$/.test(req.path);
  if (!auditedMethods.has(req.method) && !isPaymentVerification) return next();

  res.once('finish', () => {
    const actor = req.user;
    if (!actor || res.statusCode < 200 || res.statusCode >= 300) return;

    const auditLog = prisma.auditLog;
    if (!auditLog || typeof auditLog.create !== 'function') return;

    const resource = req.path.slice(0, 190);
    const resourceIdMatch = req.path.match(/\/([a-f0-9-]{20,})\/?$/i);

    void auditLog.create({
      data: {
        userId: actor.id,
        action: `${actor.role}:${isPaymentVerification ? 'VERIFY_PAYMENT' : req.method}`,
        resource,
        resourceId: resourceIdMatch?.[1],
      },
    }).catch(error => logger.error('Could not write audit log', { error, resource, action: req.method }));
  });

  next();
}
