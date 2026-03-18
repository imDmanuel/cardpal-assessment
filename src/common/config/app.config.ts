import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV!,
  port: parseInt(process.env.PORT || '3000', 10),
  redisUrl: process.env.REDIS_URL!,
  superAdminEmail: process.env.SUPERADMIN_EMAIL,
  adminEmail: process.env.ADMIN_EMAIL || 'admin@cardpal.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin123!',
  seedAdmin: process.env.SEED_ADMIN === 'true' || true, // Default to true for dev ease
}));
