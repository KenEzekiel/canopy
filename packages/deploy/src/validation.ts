export const APP_NAME_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export function validateAppName(name: string): void {
  if (!APP_NAME_REGEX.test(name) || name.length > 63) {
    throw new Error(`Invalid app name "${name}". Use lowercase letters, numbers, and hyphens only (e.g. "my-app").`);
  }
}
