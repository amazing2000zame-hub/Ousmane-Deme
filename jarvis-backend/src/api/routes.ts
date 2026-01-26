import { Router } from 'express';
import { healthRouter } from './health.js';
import { authMiddleware, handleLogin } from '../auth/jwt.js';

const router = Router();

// Public routes (no auth required)
router.use('/api/health', healthRouter);
router.post('/api/auth/login', handleLogin);

// Auth middleware for all other /api/* routes
router.use('/api', authMiddleware);

// Protected routes will be added here by later plans
// e.g., router.use('/api/cluster', clusterRouter);

export { router };
