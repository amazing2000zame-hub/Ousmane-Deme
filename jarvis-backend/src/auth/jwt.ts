import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

interface JWTPayload {
  role: string;
  iat?: number;
  exp?: number;
}

// Paths that do not require authentication
const PUBLIC_PATHS = ['/api/health', '/api/auth/login'];

/**
 * Generate a JWT token with operator role and 7-day expiry.
 */
export function generateToken(): string {
  return jwt.sign({ role: 'operator' }, config.jwtSecret, { expiresIn: '7d' });
}

/**
 * Verify a JWT token. Returns the decoded payload or null if invalid.
 */
export function verifyJWT(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Express middleware that enforces JWT authentication.
 * Skips public paths (health check, login).
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Allow public paths
  if (PUBLIC_PATHS.some((p) => req.path === p)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyJWT(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Attach payload to request for downstream handlers
  (req as Request & { user?: JWTPayload }).user = payload;
  next();
}

/**
 * POST /api/auth/login handler.
 * Accepts { password } and returns a JWT token if the password matches.
 */
export function handleLogin(req: Request, res: Response): void {
  const { password } = req.body as { password?: string };

  if (!password || password !== config.jarvisPassword) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  const token = generateToken();
  res.json({
    token,
    expiresIn: '7d',
  });
}
