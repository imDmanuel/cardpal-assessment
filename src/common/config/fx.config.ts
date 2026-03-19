import { registerAs } from '@nestjs/config';

export default registerAs('fx', () => ({
  apiKey: process.env.FX_API_KEY,
  apiUrl: process.env.FX_API_URL,
}));

