export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface MailProvider {
  sendMail(options: SendMailOptions): Promise<void>;
}

