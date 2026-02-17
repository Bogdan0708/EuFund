import nodemailer from 'nodemailer';
import logger from '@/lib/logger';

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM || smtpUser || 'FondEU <no-reply@fondeu.local>';

const transporter = smtpUser && smtpPass
  ? nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: false,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  })
  : null;

export async function sendEmail({ to, subject, html, text }: SendEmailInput): Promise<boolean> {
  if (!smtpUser || !smtpPass) {
    logger.warn({ to, subject }, '[email:send] SMTP_USER/SMTP_PASS missing, skipping email delivery');
    return false;
  }

  if (!transporter) {
    logger.warn({ to, subject }, '[email:send] SMTP transporter unavailable, skipping email delivery');
    return false;
  }

  try {
    await transporter.sendMail({
      from: smtpFrom,
      to,
      subject,
      html,
      text,
    });

    logger.info({ to, subject }, '[email:send] Email sent');
    return true;
  } catch (error) {
    logger.error({ error, to, subject }, '[email:send] Failed to send email');
    return false;
  }
}
