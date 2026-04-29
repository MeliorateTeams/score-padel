export interface SendEmailBinding {
  send(message: {
    to: string | string[]
    from: string | { email: string; name: string }
    subject: string
    html?: string
    text?: string
    replyTo?: string | { email: string; name: string }
    headers?: Record<string, string>
  }): Promise<{ messageId: string }>
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export async function sendVerificationCodeEmail(options: {
  binding?: SendEmailBinding
  fromAddress?: string
  fromName?: string
  to: string
  code: string
  verificationUrl: string
}) {
  const { binding, fromAddress, fromName = 'Score Padel', to, code, verificationUrl } = options

  if (!binding || !fromAddress) {
    throw new Error('EMAIL_CONFIG_MISSING')
  }

  const safeCode = escapeHtml(code)
  const safeVerificationUrl = escapeHtml(verificationUrl)

  await binding.send({
    to,
    from: { email: fromAddress, name: fromName },
    subject: 'Tu codigo de verificacion de Score Padel',
    text: [
      'Tu codigo de verificacion de Score Padel es:',
      code,
      '',
      'Caduca en 15 minutos.',
      `Tambien puedes abrir la pantalla de verificacion aqui: ${verificationUrl}`,
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; background: #fff8f2; color: #1f1712; padding: 32px;">
        <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #f1d6c3; border-radius: 24px; padding: 32px;">
          <p style="margin: 0 0 12px; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: #e85d04; font-weight: 700;">Score Padel</p>
          <h1 style="margin: 0 0 16px; font-size: 28px; line-height: 1.1;">Verifica tu correo</h1>
          <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #5a4d44;">Introduce este codigo en la pantalla de verificacion para activar tu cuenta.</p>
          <div style="margin: 0 0 24px; border-radius: 18px; background: linear-gradient(135deg, #e85d04 0%, #fb923c 50%, #ffba08 100%); padding: 18px 20px; text-align: center; color: #ffffff; font-size: 32px; font-weight: 800; letter-spacing: 0.35em;">${safeCode}</div>
          <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #5a4d44;">El codigo caduca en 15 minutos.</p>
          <a href="${safeVerificationUrl}" style="display: inline-block; padding: 14px 20px; border-radius: 999px; background: #1f1712; color: #ffffff; text-decoration: none; font-weight: 700;">Abrir verificacion</a>
        </div>
      </div>
    `,
  })
}
