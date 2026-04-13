export const APP_NAME_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export function validateAppName(name: string): void {
  if (!APP_NAME_REGEX.test(name) || name.length > 63) {
    throw new Error(`Invalid app name "${name}". Use lowercase letters, numbers, and hyphens only (e.g. "my-app").`);
  }
}

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

export function validateDomain(domain: string): void {
  if (!DOMAIN_REGEX.test(domain) || domain.length > 253 || domain.includes('..')) {
    throw new Error(`Invalid domain "${domain}". Must be a valid hostname.`);
  }
}

const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateEnvKey(key: string): void {
  if (!ENV_KEY_REGEX.test(key)) {
    throw new Error(`Invalid env var name "${key}". Must match [A-Za-z_][A-Za-z0-9_]*.`);
  }
}

const EMAIL_REGEX = /^[^\s;'"\\`$]+@[^\s;'"\\`$]+$/;

export function validateEmail(email: string): void {
  if (!EMAIL_REGEX.test(email) || email.length > 254) {
    throw new Error(`Invalid email "${email}".`);
  }
}
