// Confirmed existing WeChat environment for backend integration.
// Real device commands remain disabled until authorization/hardware validation.
module.exports = {
  mode: 'live',
  cloudEnv: 'cloud1-d6gs08jbb8aa7a138',
  allowDeviceOperations: false,
  // UI-only entry visibility for the check-in / face-enrollment experience build.
  // This flag is NOT a server-side approval input and never grants device access.
  checkinFaceTestEntry: true
};
