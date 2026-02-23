interface CaptchaResponse {
  success?: boolean;
}

const toBool = (value: string | undefined): boolean => (value ?? '').trim().toLowerCase() === 'true';

export class CaptchaVerifierService {
  private readonly secret = (process.env.CAPTCHA_SECRET ?? '').trim();
  private readonly verifyUrl = (process.env.CAPTCHA_VERIFY_URL ?? 'https://hcaptcha.com/siteverify').trim();
  private readonly enabled = toBool(process.env.CAPTCHA_ENABLED) || this.secret.length > 0;

  isEnabled(): boolean {
    return this.enabled;
  }

  async verify(token: string | undefined, sourceIp?: string): Promise<boolean> {
    if (!this.enabled) {
      return true;
    }
    if (!this.secret || !token?.trim()) {
      return false;
    }

    const form = new URLSearchParams();
    form.set('secret', this.secret);
    form.set('response', token.trim());
    if (sourceIp?.trim()) {
      form.set('remoteip', sourceIp.trim());
    }

    try {
      const response = await fetch(this.verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form
      });
      if (!response.ok) {
        return false;
      }
      const payload = (await response.json()) as CaptchaResponse;
      return payload.success === true;
    } catch {
      return false;
    }
  }
}
