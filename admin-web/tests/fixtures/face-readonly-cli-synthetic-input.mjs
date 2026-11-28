import { SYNTHETIC_CERT } from './hikvision-synthetic-certificates.mjs';

// Every value is fixed, public test material. No file, environment, URL, or
// command argument is used to discover credentials or a target.
export const SYNTHETIC_CLI_ORIGIN = 'https://synthetic-cli.invalid:8443';
export const SYNTHETIC_CLI_USERNAME = 'SYNTHETIC_CLI_USERNAME_SECRET_MARKER';
export const SYNTHETIC_CLI_PASSWORD = 'SYNTHETIC_CLI_PASSWORD_SECRET_MARKER';
export const SYNTHETIC_CLI_CERTIFICATE_BASE64 = Buffer.from(SYNTHETIC_CERT).toString('base64');
export function syntheticCliInput(overrides = {}) {
  return {
    operation: 'list', mode: 'offline',
    config: {
      mode: 'device', origin: SYNTHETIC_CLI_ORIGIN,
      username: SYNTHETIC_CLI_USERNAME, password: SYNTHETIC_CLI_PASSWORD,
      certificateBase64: SYNTHETIC_CLI_CERTIFICATE_BASE64, developmentTls: true,
    },
    ...overrides,
  };
}
export const SYNTHETIC_SECRET_MARKERS = [
  SYNTHETIC_CLI_ORIGIN, SYNTHETIC_CLI_USERNAME, SYNTHETIC_CLI_PASSWORD,
  SYNTHETIC_CLI_CERTIFICATE_BASE64, 'BEGIN CERTIFICATE', 'BEGIN PRIVATE KEY',
  'SYNTHETIC_PERSON_PASSWORD', 'SYNTHETIC_CARD_NUMBER',
  'SYNTHETIC_PERSON_MODEL_DATA', 'SYNTHETIC_FACE_MODEL_DATA',
  'synthetic-private.invalid', 'SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER',
];
