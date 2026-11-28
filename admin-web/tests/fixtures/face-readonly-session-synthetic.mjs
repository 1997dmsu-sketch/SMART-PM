import { createHash, X509Certificate } from 'node:crypto';
import { loadAllDayPlan } from '../../lib/face-access-plan.mjs';
import { syntheticCliInput, SYNTHETIC_SECRET_MARKERS } from './face-readonly-cli-synthetic-input.mjs';
import { SYNTHETIC_CERT } from './hikvision-synthetic-certificates.mjs';
import {
  createSyntheticResponseMap, jsonReply, textReply, SYNTHETIC_PATHS,
} from './face-readonly-fake-transport.mjs';

// Fixed public synthetic material only. This fixture never reads a file, an
// environment variable or a real device. It does not install a fake Host.
export const SESSION_TARGET = 'SYNTHFACE9';
export const SESSION_SERIAL = 'SYNTHETIC_SESSION_SERIAL_SECRET_MARKER';
export const SESSION_MODEL = 'DS-K1T671BM';
export const SESSION_SECRET_MARKERS = [...SYNTHETIC_SECRET_MARKERS, SESSION_SERIAL];
export const sessionInput = overrides => syntheticCliInput(overrides);

export function sessionPeople(count = 9) {
  return Array.from({ length: count }, (_, index) => ({
    employeeNo: index === 8 ? SESSION_TARGET : `SYNTHFACE${index + 1}`,
    name: `合成人员${index + 1}`, doorRight: '1',
    RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
    Valid: { enable: false, beginTime: '1970-01-01T00:00:00', endTime: '1970-01-01T00:00:00' },
    numOfFace: 99, password: 'SYNTHETIC_PERSON_PASSWORD', cardNo: 'SYNTHETIC_CARD_NUMBER',
    faceURL: 'https://synthetic-private.invalid/person.jpg', modelData: 'SYNTHETIC_PERSON_MODEL_DATA',
  }));
}

export function sessionResponses({ count = 9, model = SESSION_MODEL, serial = SESSION_SERIAL, deviceXml,
  targetFace = 'yes', libraries, people = sessionPeople(count) } = {}) {
  const responses = createSyntheticResponseMap({ model, people });
  responses.set(`GET ${SYNTHETIC_PATHS.device}`, textReply(deviceXml
    ?? `<DeviceInfo><model>${model}</model><firmwareVersion>V3.3.180</firmwareVersion><serialNumber>${serial}</serialNumber></DeviceInfo>`,
  200, { 'content-type': 'application/xml' }));
  if (libraries) responses.set(`GET ${SYNTHETIC_PATHS.libraries}`, jsonReply({ FDLib: structuredClone(libraries) }));
  responses.set(`POST ${SYNTHETIC_PATHS.faces}`, request => {
    const isTarget = request.json.FPID === SESSION_TARGET && request.json.faceLibType === 'blackFD' && request.json.FDID === '1';
    const selected = isTarget ? targetFace : 'yes';
    if (selected === 'absent') return jsonReply({ totalMatches: 0, numOfMatches: 0, responseStatusStrg: 'NO MATCH', MatchList: [] });
    const row = { FPID: selected === 'other-fpid' ? 'SYNTHOTHER' : request.json.FPID,
      faceURL: 'https://synthetic-private.invalid/face.jpg', modelData: 'SYNTHETIC_FACE_MODEL_DATA' };
    if (selected !== 'missing') row.isInLibrary = selected;
    const rows = selected === 'duplicate' ? [{ ...row, isInLibrary: 'yes' }, { ...row, isInLibrary: 'yes' }] : [row];
    return jsonReply({ totalMatches: rows.length, numOfMatches: rows.length, responseStatusStrg: 'OK', MatchList: rows });
  });
  return responses;
}

// Derive the expected plan from an in-memory JSON reader, independently from
// Host/SDK transport. No TLS or HTTP call occurs while preparing expectations.
const expectedPlan = loadAllDayPlan(async path => {
  const response = createSyntheticResponseMap().get(`GET ${path}`);
  if (!response || typeof response === 'function') throw new Error('Synthetic plan fixture is incomplete');
  return JSON.parse(response.body.toString('utf8'));
});
const expectedPin = createHash('sha256').update(new X509Certificate(SYNTHETIC_CERT).publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
export async function sessionExpectations(overrides = {}) {
  return { expectedSpkiPin: expectedPin, expectedSerialNumber: SESSION_SERIAL,
    expectedPlanFingerprint: (await expectedPlan).fingerprint, expectedCount: 9,
    targetEmployeeNo: SESSION_TARGET, targetFDID: '1', ...overrides };
}
