import path from 'node:path';
import {
  createSyntheticWindowsConfirmation, createWindowsPrivateInputAdapter, inspectWindowsPrivateInputAdapter,
} from '../../lib/face-readonly-windows-input.mjs';
import {
  createWindowsPrivateInputPorts, createOfflineLocalBootstrap,
  createWindowsEvidenceReceiver, createSyntheticEvidenceReceiver,
  inspectWindowsEvidenceReceiver, inspectSyntheticEvidenceReceiver,
} from '../../lib/face-readonly-local-bootstrap.mjs';
import { sessionInput, sessionExpectations, SESSION_SECRET_MARKERS } from './face-readonly-session-synthetic.mjs';
import { syntheticBase, reference } from './face-readonly-windows-evidence-synthetic.mjs';

// Only fabricated memory bytes, fake confirmation events, and new synthetic
// evidence directories. No supplied credential/photo/config path is read.
export async function windowsInputFixture({ input = sessionInput(), expectations,
  inputBytes, expectationsBytes, decision = 'approve', omitConfirmation = false, nativeEvidence = false,
  baseDirectory, evidenceReference, options, installed = true } = {}) {
  const expected = expectations ?? await sessionExpectations();
  const body = inputBytes ?? Buffer.from(JSON.stringify(input));
  const independent = expectationsBytes ?? Buffer.from(JSON.stringify(expected));
  const adapter = createWindowsPrivateInputAdapter({ inputBytes: body, expectationsBytes: independent,
    ...(omitConfirmation ? {} : { confirmationEvent: createSyntheticWindowsConfirmation({ decision }) }) });
  const ports = createWindowsPrivateInputPorts({ adapter });
  const ref = evidenceReference ?? reference();
  const base = nativeEvidence ? baseDirectory ?? syntheticBase() : undefined;
  const receiver = nativeEvidence ? createWindowsEvidenceReceiver({ baseDirectory: base, reference: ref })
    : createSyntheticEvidenceReceiver({ reference: ref });
  const handle = createOfflineLocalBootstrap({ ...ports, evidenceReceiver: receiver,
    isTransportInstalled: () => installed, ...(options ? { options } : {}) });
  return { adapter, ports, receiver, handle, expected, body, independent, input,
    nativeEvidence, reference: ref, baseDirectory: base, directory: base ? path.join(base, ref) : undefined };
}
export function inspectWindowsInputFixture(context) {
  return { input: inspectWindowsPrivateInputAdapter(context.adapter), evidence: context.nativeEvidence
    ? inspectWindowsEvidenceReceiver(context.receiver) : inspectSyntheticEvidenceReceiver(context.receiver) };
}
export function safePrivateInput(value, expected) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const privateValues = [...SESSION_SECRET_MARKERS, 'SYNTHETIC_PRIVATE_HELPER_OUTPUT_MARKER',
    expected?.expectedSpkiPin, expected?.expectedSerialNumber].filter(Boolean);
  for (const marker of privateValues) {
    for (const forbidden of [marker, Buffer.from(marker).toString('base64')]) {
      if (text.includes(forbidden)) throw new Error('Synthetic private input escaped the public boundary');
    }
  }
  if (/BEGIN (?:CERTIFICATE|PRIVATE KEY)|S-\d-\d+(?:-\d+)+|\n\s+at /.test(text)) throw new Error('Untrusted native detail escaped the public boundary');
  for (const key of ['inputBase64', 'expectationsBase64', 'inputBytes', 'expectationsBytes',
    'captureId', 'challenge', 'viewBase64', 'origin', 'username', 'password', 'certificateBase64',
    'expectedSpkiPin', 'expectedSerialNumber', 'authorization']) {
    if (text.includes(`"${key}"`)) throw new Error('Private protocol field escaped the public boundary');
  }
}
export function privateInputError(error) {
  safePrivateInput({ code: error?.code, message: error?.message });
  return typeof error?.code === 'string' && /^(?:WINDOWS_INPUT_|LOCAL_|INPUT_|SESSION_|COMMAND_)/.test(error.code);
}
