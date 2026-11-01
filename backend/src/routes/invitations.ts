// src/routes/invitations.ts
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import InvitationController from '../controllers/invitationController';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// Per-admin cap on invitations, so an account can't be used to spam employees.
// Keyed by the authenticated user id (not IP). In-memory: resets on restart.
const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `invite:${req.user.id}`,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: 'Too many invitations sent. Please try again in an hour.'
    });
  }
});

// All routes require authentication
router.use(authenticate);

// Admin routes
router.post('/send', requireRole('admin'), inviteLimiter, InvitationController.sendInvitation);
router.get('/team', requireRole('admin'), InvitationController.getTeamMembers);
router.get('/pending', requireRole('admin'), InvitationController.getPendingInvitations);

// Employee routes
router.get('/my-invitations', InvitationController.getMyInvitations);
router.put('/respond/:id', InvitationController.respondToInvitation);

export default router;
