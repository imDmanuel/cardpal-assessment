import { Module, Global } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { MailService } from './mail.service.js';
import { SmtpMailProvider } from './providers/smtp-mail.provider.js';
import smtpConfig from '../config/smtp.config.js';

@Global()
@Module({
  providers: [
    {
      provide: 'MAIL_PROVIDER',
      useFactory: (config: ConfigType<typeof smtpConfig>) => {
        // Here we could check process.env.MAIL_DRIVER to return a different provider like ResendMailProvider
        return new SmtpMailProvider(config);
      },
      inject: [smtpConfig.KEY],
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
