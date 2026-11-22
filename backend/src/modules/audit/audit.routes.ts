import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { authorize } from '../../middleware/rbac';
import * as ctrl from './audit.controller';

const router = Router();
router.use(authenticate, authorize('ADMIN'));
router.get('/', ctrl.list);

export default router;
