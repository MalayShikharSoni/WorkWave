// src/controllers/invitationController.ts
import { Request, Response } from 'express';
import pool from '../config/database';
import socketService from '../services/socketService';

// Simple shape check only; the real check is that the account exists.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// How long an admin must wait to re-invite an employee who declined.
const REINVITE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

class InvitationController {
  // Admin sends an invitation to an employee, identified by exact email.
  // There is deliberately no "browse all employees" endpoint: an admin can only
  // invite someone whose email they already know.
  static async sendInvitation(req: Request, res: Response): Promise<void> {
    try {
      const adminId = req.user.id;
      const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';

      if (!email || email.length > 255 || !EMAIL_PATTERN.test(email)) {
        res.status(400).json({
          success: false,
          error: 'A valid email address is required'
        });
        return;
      }

      // Verify the target user is an active employee
      const employeeCheck = await pool.query(
        'SELECT id, first_name FROM users WHERE LOWER(email) = $1 AND role = $2 AND is_active = true',
        [email, 'employee']
      );

      if (employeeCheck.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: 'No employee account found with that email'
        });
        return;
      }

      const employeeId: number = employeeCheck.rows[0].id;

      // Check if this employee already accepted another admin's invitation.
      // Don't reveal which admin's team they are on.
      const existingTeam = await pool.query(
        `SELECT admin_id FROM team_invitations
         WHERE employee_id = $1 AND status = 'accepted'`,
        [employeeId]
      );

      if (existingTeam.rows.length > 0) {
        const onThisTeam = existingTeam.rows.some(r => r.admin_id === adminId);
        res.status(400).json({
          success: false,
          error: onThisTeam ? 'This employee is already on your team' : 'This employee is already on another team'
        });
        return;
      }

      // Check if an invitation already exists from this admin to this employee
      const existingInvite = await pool.query(
        'SELECT id, status, responded_at FROM team_invitations WHERE admin_id = $1 AND employee_id = $2',
        [adminId, employeeId]
      );

      if (existingInvite.rows.length > 0) {
        const existing = existingInvite.rows[0];
        if (existing.status === 'pending') {
          res.status(400).json({
            success: false,
            error: 'Invitation already sent and is pending'
          });
          return;
        }
        // If previously rejected, allow re-sending by updating the existing record,
        // but only after a cooldown so an employee can't be spammed with re-invites.
        if (existing.status === 'rejected') {
          const respondedAt = existing.responded_at ? new Date(existing.responded_at).getTime() : 0;
          const retryAt = respondedAt + REINVITE_COOLDOWN_MS;
          if (Date.now() < retryAt) {
            res.status(429).json({
              success: false,
              error: `This employee declined your invitation. You can invite them again after ${new Date(retryAt).toDateString()}.`
            });
            return;
          }

          const updated = await pool.query(
            `UPDATE team_invitations 
             SET status = 'pending', responded_at = NULL, created_at = CURRENT_TIMESTAMP
             WHERE id = $1 RETURNING *`,
            [existing.id]
          );
          const invitationData = updated.rows[0];

          // Notify employee
          socketService.emitInvitationReceived(employeeId, invitationData as any);

          res.status(201).json({
            success: true,
            data: invitationData,
            message: 'Invitation re-sent successfully'
          });
          return;
        }
        // If already accepted
        res.status(400).json({
          success: false,
          error: 'This employee is already on your team'
        });
        return;
      }

      // Create the invitation
      const result = await pool.query(
        `INSERT INTO team_invitations (admin_id, employee_id, status)
         VALUES ($1, $2, 'pending') RETURNING *`,
        [adminId, employeeId]
      );

      const invitationData = result.rows[0];

      // Notify employee
      socketService.emitInvitationReceived(employeeId, invitationData as any);

      res.status(201).json({
        success: true,
        data: invitationData,
        message: 'Invitation sent successfully'
      });
    } catch (error) {
      console.error('Send invitation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send invitation'
      });
    }
  }

  // Employee accepts or rejects an invitation
  static async respondToInvitation(req: Request, res: Response): Promise<void> {
    try {
      const employeeId = req.user.id;
      const id = req.params.id as string;
      const { status } = req.body;

      // Validate status
      if (!['accepted', 'rejected'].includes(status)) {
        res.status(400).json({
          success: false,
          error: 'Status must be "accepted" or "rejected"'
        });
        return;
      }

      // Get the invitation
      const invitation = await pool.query(
        'SELECT * FROM team_invitations WHERE id = $1 AND employee_id = $2',
        [id, employeeId]
      );

      if (invitation.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: 'Invitation not found'
        });
        return;
      }

      if (invitation.rows[0].status !== 'pending') {
        res.status(400).json({
          success: false,
          error: 'This invitation has already been responded to'
        });
        return;
      }

      // If accepting, check the employee isn't already on another team
      if (status === 'accepted') {
        const existingTeam = await pool.query(
          `SELECT ti.admin_id, u.first_name as admin_name 
           FROM team_invitations ti 
           JOIN users u ON ti.admin_id = u.id
           WHERE ti.employee_id = $1 AND ti.status = 'accepted'`,
          [employeeId]
        );

        if (existingTeam.rows.length > 0) {
          res.status(400).json({
            success: false,
            error: `You are already on ${existingTeam.rows[0].admin_name}'s team. You cannot join another team.`
          });
          return;
        }
      }

      // Update the invitation
      const result = await pool.query(
        `UPDATE team_invitations 
         SET status = $1, responded_at = CURRENT_TIMESTAMP
         WHERE id = $2 RETURNING *`,
        [status, id]
      );

      const invitationData = result.rows[0];

      // Notify admin
      socketService.emitInvitationResponded(invitationData.admin_id, invitationData.id, status);

      res.json({
        success: true,
        data: invitationData,
        message: `Invitation ${status} successfully`
      });
    } catch (error) {
      console.error('Respond to invitation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to respond to invitation'
      });
    }
  }

  // Employee gets their pending invitations
  static async getMyInvitations(req: Request, res: Response): Promise<void> {
    try {
      const employeeId = req.user.id;

      const result = await pool.query(
        `SELECT ti.id, ti.status, ti.created_at,
                u.id as admin_id, u.first_name as admin_name, u.email as admin_email
         FROM team_invitations ti
         JOIN users u ON ti.admin_id = u.id
         WHERE ti.employee_id = $1 AND ti.status = 'pending'
         ORDER BY ti.created_at DESC`,
        [employeeId]
      );

      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      console.error('Get my invitations error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch invitations'
      });
    }
  }

  // Admin gets their team members (accepted invitations)
  static async getTeamMembers(req: Request, res: Response): Promise<void> {
    try {
      const adminId = req.user.id;

      const result = await pool.query(
        `SELECT u.id, u.first_name, u.email, ti.created_at as joined_at
         FROM team_invitations ti
         JOIN users u ON ti.employee_id = u.id
         WHERE ti.admin_id = $1 AND ti.status = 'accepted' AND u.is_active = true
         ORDER BY u.first_name`,
        [adminId]
      );

      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      console.error('Get team members error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch team members'
      });
    }
  }

  // Admin gets their pending (sent) invitations
  static async getPendingInvitations(req: Request, res: Response): Promise<void> {
    try {
      const adminId = req.user.id;

      const result = await pool.query(
        `SELECT ti.id, ti.status, ti.created_at,
                u.id as employee_id, u.first_name, u.email
         FROM team_invitations ti
         JOIN users u ON ti.employee_id = u.id
         WHERE ti.admin_id = $1 AND ti.status = 'pending'
         ORDER BY ti.created_at DESC`,
        [adminId]
      );

      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      console.error('Get pending invitations error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch pending invitations'
      });
    }
  }
}

export default InvitationController;
