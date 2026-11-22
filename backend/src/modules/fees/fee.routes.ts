import { Router } from 'express';
import * as ctrl from './fee.controller';
import { authenticate } from '../../middleware/auth';
import { authorize } from '../../middleware/rbac';

const router = Router();
// Stripe authenticates this endpoint with its signed webhook payload.
router.use(authenticate);

router.get('/', ctrl.list);
router.get('/assignments', authorize('ADMIN'), ctrl.listAssignments);
router.get('/my-assignments', ctrl.listMyAssignments);
router.post('/assignments', authorize('ADMIN'), ctrl.assignFee);
router.delete('/assignments/:id', authorize('ADMIN'), ctrl.removeAssignment);
router.post('/assignments/:id/payments', authorize('ADMIN'), ctrl.recordAssignmentPayment);
router.get('/my', ctrl.listMyPayments);
router.post('/', authorize('ADMIN'), ctrl.create);
router.put('/:id', authorize('ADMIN'), ctrl.update);
router.get('/payments', authorize('ADMIN'), ctrl.listPayments);
router.post('/payments', authorize('ADMIN'), ctrl.recordPayment);
router.post('/payments/stripe-webhook', ctrl.stripeWebhook);
router.post('/payments/paypal/create', authorize('STUDENT', 'PARENT'), ctrl.createPayPalOrder);
router.post('/payments/paypal/capture', authorize('STUDENT', 'PARENT'), ctrl.capturePayPalOrder);
router.post('/payments/flutterwave/init', authorize('STUDENT', 'PARENT'), ctrl.initFlutterwave);
router.get('/payments/flutterwave/verify', authorize('STUDENT', 'PARENT'), ctrl.verifyFlutterwave);
router.get('/payments/:studentId/statement', ctrl.getStatement);

export default router;
