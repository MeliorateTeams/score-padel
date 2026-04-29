export function isEmailVerificationEnabled(envLike: Record<string, unknown> | undefined): boolean {
  const emailBinding = envLike?.EMAIL
  const hasEmailBinding =
    typeof emailBinding === 'object' && emailBinding !== null && 'send' in emailBinding
  const hasSenderAddress = String(envLike?.EMAIL_FROM ?? '').trim().length > 0

  return (
    String(envLike?.EMAIL_VERIFICATION_ENABLED ?? '')
      .trim()
      .toLowerCase() === 'true' &&
    hasEmailBinding &&
    hasSenderAddress
  )
}
