import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET!,
  jwtExpiresIn: isNaN(Number(process.env.JWT_EXPIRES_IN))
    ? process.env.JWT_EXPIRES_IN || '15m'
    : Number(process.env.JWT_EXPIRES_IN),
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,
  jwtRefreshExpiresIn: isNaN(Number(process.env.JWT_REFRESH_EXPIRES_IN))
    ? process.env.JWT_REFRESH_EXPIRES_IN || '7d'
    : Number(process.env.JWT_REFRESH_EXPIRES_IN),
}));

