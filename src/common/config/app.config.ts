import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV!,
  port: parseInt(process.env.PORT || '3000', 10),
  redisUrl: process.env.REDIS_URL!,
  superAdminEmail: process.env.SUPERADMIN_EMAIL,
}));
