// src/controllers/authController.ts
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/userModel';
import pool from '../config/database';
import cloudinary from '../config/cloudinary';
import streamifier from 'streamifier';
import { validateProfileInput } from '../utils/profileValidation';

// Refresh tokens are stored HASHED so a DB leak does not expose usable bearer
// credentials (previously the raw JWT was stored, effectively plaintext). We use
// SHA-256 (fast, deterministic, unsalted) rather than bcrypt on purpose: a JWT
// refresh token is already long and high-entropy, so the threat is DB-read-and-
// reuse, not offline guessing. Deterministic hashing is also required so the
// refresh/logout endpoints can look a token up by exact value (bcrypt's per-row
// salt would make that lookup impossible without scanning every row).
function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

class AuthController {
  static generateTokens(user: { id: number; email: string; role: string }) {
    const accessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET as string,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.JWT_REFRESH_SECRET as string,
      { expiresIn: '7d' }
    );

    return { accessToken, refreshToken };
  }

  static async register(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, firstName, role } = req.body;

      // Validate role
      const validRoles = ['admin', 'employee'];
      const userRole = validRoles.includes(role) ? role : 'employee';

      // Check if user exists
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        res.status(400).json({
          success: false,
          error: 'Email already registered'
        });
        return;
      }

      // Create user
      const user = await User.create({ email, password, firstName, role: userRole });

      // Generate tokens
      const { accessToken, refreshToken } = AuthController.generateTokens(user);

      // Store refresh token
      await pool.query(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')',
        [user.id, hashRefreshToken(refreshToken)]
      );

      res.status(201).json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            role: user.role
          },
          accessToken,
          refreshToken
        }
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        error: 'Registration failed'
      });
    }
  }

  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;

      // Find user
      const user = await User.findByEmail(email);
      if (!user) {
        res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
        return;
      }

      // Verify password
      const isValid = await User.verifyPassword(password, user.password_hash);
      if (!isValid) {
        res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
        return;
      }

      // Update last login
      await User.updateLastLogin(user.id);

      // Generate tokens
      const { accessToken, refreshToken } = AuthController.generateTokens(user);

      // Store refresh token
      await pool.query(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')',
        [user.id, hashRefreshToken(refreshToken)]
      );

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            role: user.role
          },
          accessToken,
          refreshToken
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        error: 'Login failed'
      });
    }
  }

  static async getMe(req: Request, res: Response): Promise<void> {
    try {
      const result = await pool.query(
        'SELECT id, email, first_name, role, bio, phone, designation, department, linkedin_url, avatar_url, created_at FROM users WHERE id = $1',
        [req.user.id]
      );

      const user = result.rows[0];

      if (!user) {
        res.status(404).json({
          success: false,
          error: 'User not found'
        });
        return;
      }

      res.json({
        success: true,
        data: user
      });
    } catch (error) {
      console.error('Get me error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch user'
      });
    }
  }

  static async refresh(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({
          success: false,
          error: 'Refresh token is required'
        });
        return;
      }

      // Verify the JWT signature and expiry
      let decoded: { id: number };
      try {
        decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET as string) as { id: number };
      } catch {
        res.status(401).json({
          success: false,
          error: 'Invalid or expired refresh token'
        });
        return;
      }

      // Look up the presented token for this user WITHOUT pre-filtering on
      // revoked/expiry, so we can distinguish "reused a rotated-out token"
      // (reuse detection) from "never existed".
      const tokenResult = await pool.query(
        'SELECT id, revoked_at, expires_at FROM refresh_tokens WHERE token = $1 AND user_id = $2',
        [hashRefreshToken(refreshToken), decoded.id]
      );

      if (tokenResult.rows.length === 0) {
        res.status(401).json({
          success: false,
          error: 'Refresh token not found'
        });
        return;
      }

      const stored = tokenResult.rows[0];

      // Reuse detection: the token exists but was already revoked (rotated out
      // or logged out). This is a strong token-theft signal — revoke EVERY
      // active refresh token for this user, forcing re-login on all devices.
      if (stored.revoked_at !== null) {
        await pool.query(
          'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
          [decoded.id]
        );
        console.error(`[SECURITY] refresh token reuse detected for user ${decoded.id} — all sessions revoked`);
        res.status(401).json({
          success: false,
          error: 'Refresh token has been revoked'
        });
        return;
      }

      // DB row is the source of truth for the revocation window.
      if (new Date(stored.expires_at) <= new Date()) {
        res.status(401).json({
          success: false,
          error: 'Refresh token expired'
        });
        return;
      }

      // Fetch the user to include current role/email in the new access token
      const userResult = await pool.query(
        'SELECT id, email, role FROM users WHERE id = $1',
        [decoded.id]
      );

      if (userResult.rows.length === 0) {
        res.status(401).json({
          success: false,
          error: 'User not found'
        });
        return;
      }

      const user = userResult.rows[0];

      // Rotate: mint a brand-new access + refresh token, persist the new refresh
      // token, and revoke the old one (linking it to its replacement). Wrapped in
      // a transaction so the insert-new + revoke-old pair is atomic.
      const { accessToken, refreshToken: newRefreshToken } = AuthController.generateTokens(user);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const insertResult = await client.query(
          `INSERT INTO refresh_tokens (user_id, token, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '7 days') RETURNING id`,
          [user.id, hashRefreshToken(newRefreshToken)]
        );
        const newTokenId = insertResult.rows[0].id;
        await client.query(
          'UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = $1 WHERE id = $2',
          [newTokenId, stored.id]
        );
        await client.query('COMMIT');
      } catch (txError) {
        await client.query('ROLLBACK');
        throw txError;
      } finally {
        client.release();
      }

      res.json({
        success: true,
        data: { accessToken, refreshToken: newRefreshToken }
      });
    } catch (error) {
      console.error('Refresh token error:', error);
      res.status(500).json({
        success: false,
        error: 'Token refresh failed'
      });
    }
  }

  static async logout(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body;

      if (refreshToken) {
        // Revoke (not delete) the specific token, keeping the row so a later
        // reuse of this rotated-out/logged-out token is still detectable.
        await pool.query(
          'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token = $1 AND user_id = $2 AND revoked_at IS NULL',
          [hashRefreshToken(refreshToken), req.user.id]
        );
      } else {
        // If no token provided, revoke ALL active refresh tokens for this user.
        await pool.query(
          'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
          [req.user.id]
        );
      }

      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        error: 'Logout failed'
      });
    }
  }

  static async updateProfile(req: Request, res: Response): Promise<void> {
    try {
      const result = validateProfileInput(req.body ?? {});
      if (result.error !== undefined) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      await User.updateProfile(req.user.id, result.data);

      res.json({
        success: true,
        message: 'Profile updated successfully'
      });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update profile'
      });
    }
  }

  static async uploadAvatar(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: 'No file uploaded' });
        return;
      }

      // Stream to cloudinary
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: 'workwave/avatars' },
        async (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            res.status(500).json({ success: false, error: 'Failed to upload image' });
            return;
          }

          if (result && result.secure_url) {
            await User.updateAvatar(req.user.id, result.secure_url);
            res.json({ success: true, data: { avatar_url: result.secure_url } });
          }
        }
      );

      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);

    } catch (error) {
      console.error('Avatar upload error:', error);
      res.status(500).json({ success: false, error: 'Upload failed' });
    }
  }
}

export default AuthController;
