type EmailLocale = 'ro' | 'en';

type EmailTemplate = {
  subject: string;
  html: string;
};

function baseTemplate(title: string, greeting: string, intro: string, ctaLabel: string, ctaUrl: string, footer: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#2563EB;padding:16px 24px;color:#FFFFFF;font-size:20px;font-weight:700;">
                FondEU
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h1 style="margin:0 0 16px;font-size:22px;color:#111827;">${title}</h1>
                <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">${greeting}</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">${intro}</p>
                <a href="${ctaUrl}" style="display:inline-block;background:#2563EB;color:#FFFFFF;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:8px;">${ctaLabel}</a>
                <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#6B7280;">${footer}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

export function welcomeEmail(name: string, verificationUrl: string, locale: EmailLocale = 'ro'): EmailTemplate {
  if (locale === 'en') {
    return {
      subject: 'Welcome to FondEU - Verify your email',
      html: baseTemplate(
        'Welcome to FondEU',
        `Hi ${name},`,
        'Thank you for creating your account. Please verify your email address to activate your profile and continue using the platform.',
        'Verify email',
        verificationUrl,
        'If you did not create this account, you can safely ignore this email.',
      ),
    };
  }

  return {
    subject: 'Bun venit pe FondEU - Confirmă adresa de email',
    html: baseTemplate(
      'Bun venit pe FondEU',
      `Salut, ${name}!`,
      'Îți mulțumim că ți-ai creat cont. Te rugăm să confirmi adresa de email pentru a activa profilul și a continua în platformă.',
      'Confirmă emailul',
      verificationUrl,
      'Dacă nu ai creat acest cont, poți ignora acest mesaj.',
    ),
  };
}

export function passwordResetEmail(name: string, resetUrl: string, locale: EmailLocale = 'ro'): EmailTemplate {
  if (locale === 'en') {
    return {
      subject: 'FondEU password reset request',
      html: baseTemplate(
        'Reset your password',
        `Hi ${name},`,
        'We received a request to reset your password. Use the button below to set a new one.',
        'Reset password',
        resetUrl,
        'If you did not request this, you can ignore this email. Your password will stay unchanged.',
      ),
    };
  }

  return {
    subject: 'Solicitare resetare parolă FondEU',
    html: baseTemplate(
      'Resetare parolă',
      `Salut, ${name}!`,
      'Am primit o solicitare pentru resetarea parolei. Folosește butonul de mai jos pentru a seta o parolă nouă.',
      'Resetează parola',
      resetUrl,
      'Dacă nu ai făcut tu această solicitare, ignoră acest email. Parola ta rămâne neschimbată.',
    ),
  };
}
