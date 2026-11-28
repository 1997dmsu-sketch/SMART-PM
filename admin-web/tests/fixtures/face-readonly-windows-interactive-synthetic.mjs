import path from 'node:path';
import {
  createSyntheticWindowsInteractiveInputAdapter, inspectWindowsPrivateInputAdapter,
} from '../../lib/face-readonly-windows-input.mjs';
import {
  createWindowsPrivateInputPorts, createOfflineLocalBootstrap,
  createWindowsEvidenceReceiver, createSyntheticEvidenceReceiver,
  inspectWindowsEvidenceReceiver, inspectSyntheticEvidenceReceiver,
} from '../../lib/face-readonly-local-bootstrap.mjs';
import { sessionInput, sessionExpectations, SESSION_MODEL } from './face-readonly-session-synthetic.mjs';
import { syntheticBase, reference } from './face-readonly-windows-evidence-synthetic.mjs';
import { safePrivateInput, privateInputError } from './face-readonly-windows-input-synthetic.mjs';

// Fixed fabricated in-memory values only. The synthetic action drives the same
// WinForms controls and event handlers as the interactive helper, without
// displaying a window. No credential/photo file or device is consulted.
export const INTERACTIVE_ACTIONS = Object.freeze(['approve', 'reject', 'unchecked-approve', 'check-uncheck',
  'review-cancel', 'review-close', 'review-none', 'capture-cancel', 'capture-close', 'double-approve']);
export async function interactiveSeed(overrides = {}) {
  const input = sessionInput(), expected = await sessionExpectations();
  return { origin: input.config.origin, username: input.config.username, password: input.config.password,
    certificateBase64: input.config.certificateBase64, expectedModel: SESSION_MODEL, planTemplateNo: '1',
    expectedSpkiPin: expected.expectedSpkiPin, expectedSerialNumber: expected.expectedSerialNumber,
    expectedPlanFingerprint: expected.expectedPlanFingerprint, expectedCount: String(expected.expectedCount),
    targetEmployeeNo: expected.targetEmployeeNo, targetFDID: expected.targetFDID,
    developmentTls: String(input.config.developmentTls), ...overrides };
}
export async function windowsInteractiveFixture({ seed, seedBytes, expectations, action = 'approve', omitAction = false,
  nativeEvidence = false, baseDirectory, evidenceReference, options, installed = true } = {}) {
  const expected = expectations ?? await sessionExpectations();
  const data = seed ?? await interactiveSeed(), bytes = seedBytes ?? Buffer.from(JSON.stringify(data));
  const adapter = createSyntheticWindowsInteractiveInputAdapter({ seedBytes: bytes, ...(omitAction ? {} : { action }) });
  const ports = createWindowsPrivateInputPorts({ adapter }), ref = evidenceReference ?? reference();
  const base = nativeEvidence ? baseDirectory ?? syntheticBase() : undefined;
  const receiver = nativeEvidence ? createWindowsEvidenceReceiver({ baseDirectory: base, reference: ref })
    : createSyntheticEvidenceReceiver({ reference: ref });
  const handle = createOfflineLocalBootstrap({ ...ports, evidenceReceiver: receiver,
    isTransportInstalled: () => installed, ...(options ? { options } : {}) });
  return { adapter, ports, receiver, handle, expected, seed: data, seedBytes: bytes,
    nativeEvidence, reference: ref, baseDirectory: base, directory: base ? path.join(base, ref) : undefined };
}
export function inspectWindowsInteractiveFixture(context) {
  return { input: inspectWindowsPrivateInputAdapter(context.adapter), evidence: context.nativeEvidence
    ? inspectWindowsEvidenceReceiver(context.receiver) : inspectSyntheticEvidenceReceiver(context.receiver) };
}
export function safeInteractiveInput(value, expected) {
  safePrivateInput(value, expected);
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const key of ['seedBytes', 'seedBase64']) {
    if (text.includes(`"${key}"`)) throw new Error('Synthetic interactive input escaped the public boundary');
  }
}
export { privateInputError };
