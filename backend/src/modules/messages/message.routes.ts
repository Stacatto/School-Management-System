import { Router } from 'express';
import * as ctrl from './message.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/conversations', ctrl.listConversations);
router.get('/recipients', ctrl.listRecipients);
router.post('/conversations', ctrl.createConversation);
router.get('/conversations/:id/messages', ctrl.getMessages);
router.post('/send', ctrl.send);

export default router;
