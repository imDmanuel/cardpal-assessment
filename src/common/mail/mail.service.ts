import { Injectable, Inject, Logger } from '@nestjs/common';
import type { MailProvider } from './interfaces/mail-provider.interface.js';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject('MAIL_PROVIDER')
    private readonly mailProvider: MailProvider,
  ) {}

  async sendOtpEmail(email: string, otp: string): Promise<void> {
    const subject = 'Your CardPal Verification Code';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
        <h2 style="color: #333; text-align: center;">Welcome to CardPal!</h2>
        <p style="color: #555; font-size: 16px;">Please use the following One-Time Password (OTP) to verify your email address. This code is valid for 10 minutes.</p>
        <div style="background-color: #f4f4f4; padding: 15px; text-align: center; border-radius: 5px; margin: 20px 0;">
          <strong style="font-size: 24px; letter-spacing: 5px; color: #000;">${otp}</strong>
        </div>
        <p style="color: #888; font-size: 14px; text-align: center;">If you did not request this code, please ignore this email.</p>
      </div>
    `;

    try {
      await this.mailProvider.sendMail({
        to: email,
        subject,
        html,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to send OTP email to ${email}: ${errorMessage}`,
        errorStack,
      );
      throw new Error('Email delivery failed. Please try again later.');
    }
  }
}
