import * as nodemailer from 'nodemailer';
import {
  MailProvider,
  SendMailOptions,
} from '../interfaces/mail-provider.interface.js';
import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type smtpConfig from '../../config/smtp.config.js';

export class SmtpMailProvider implements MailProvider {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(SmtpMailProvider.name);
  private fromAddress: string;

  constructor(config: ConfigType<typeof smtpConfig>) {
    this.fromAddress = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465, // true for 465, false for other ports
      auth: {
        user: config.user,
        pass: config.pass,
      },
      // Fast fail options for synchronous execution
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
    });
  }

  async sendMail(options: SendMailOptions): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      this.logger.log(`Email sent successfully to ${options.to}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to send email to ${options.to}: ${errorMessage}`,
        errorStack,
      );
      throw error; // Rethrow so the caller knows it failed
    }
  }
}
