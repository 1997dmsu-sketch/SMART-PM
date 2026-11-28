import {
  createOfflineLocalBootstrap, createSyntheticInputSource,
  createSyntheticApprovalSource, createSyntheticEvidenceReceiver,
} from '../../lib/face-readonly-local-bootstrap.mjs';
import { sessionInput, sessionExpectations } from './face-readonly-session-synthetic.mjs';

// Only fabricated memory bytes and code-level fixture callbacks. This file
// never reads a credential, certificate, photo, environment value or path.
export async function localBootstrapFixture({ input = sessionInput(), expectations,
  materials, read, request, receiverOptions = {}, options, isTransportInstalled = () => true } = {}) {
  const expected = expectations ?? await sessionExpectations();
  const supplied = materials ?? { inputBytes: Buffer.from(JSON.stringify(input)), expectations: expected };
  const events = [];
  let readCalls = 0, approvalCalls = 0;
  const source = createSyntheticInputSource({ read: () => {
    readCalls++; events.push('input');
    return read ? read(supplied) : supplied;
  } });
  const approval = createSyntheticApprovalSource({ request: (view, controls) => {
    approvalCalls++; events.push('approval');
    return request ? request(view, controls) : controls.approve(view);
  } });
  const receiver = createSyntheticEvidenceReceiver({
    ...receiverOptions,
    onPhase: phase => {
      events.push(`evidence:${phase.phase}${phase.role ? `:${phase.role}` : ''}`);
      return receiverOptions.onPhase?.(phase);
    },
  });
  const handle = createOfflineLocalBootstrap({ inputSource: source, approvalSource: approval,
    evidenceReceiver: receiver, isTransportInstalled, ...(options ? { options } : {}) });
  return { handle, source, approval, receiver, supplied, input, expected, events,
    get readCalls() { return readCalls; }, get approvalCalls() { return approvalCalls; } };
}
