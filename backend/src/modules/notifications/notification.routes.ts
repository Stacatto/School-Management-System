import { Router } from 'express';
import * as ctrl from './notification.controller';
import { authenticate } from '../../middleware/auth';
import { authorize } from '../../middleware/rbac';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.get('/preferences', ctrl.getPreferences);
router.put('/preferences', ctrl.updatePreferences);
router.post('/broadcast', authorize('ADMIN'), ctrl.broadcast);
router.put('/:id/read', ctrl.markRead);
router.put('/read-all', ctrl.markAllRead);

export default router;
