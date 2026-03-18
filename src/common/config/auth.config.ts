import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET || 'fallback_secret_keep_it_safe',
  jwtExpiresIn: isNaN(Number(process.env.JWT_EXPIRES_IN))
    ? process.env.JWT_EXPIRES_IN || '15m'
    : Number(process.env.JWT_EXPIRES_IN),
  jwtRefreshSecret:
    process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret_keep_it_safe',
  jwtRefreshExpiresIn: isNaN(Number(process.env.JWT_REFRESH_EXPIRES_IN))
    ? process.env.JWT_REFRESH_EXPIRES_IN || '7d'
    : Number(process.env.JWT_REFRESH_EXPIRES_IN),
}));
