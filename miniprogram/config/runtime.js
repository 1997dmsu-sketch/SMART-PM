// Preview is local and never calls the old cloud environment.
// For live integration set mode to 'live', cloudEnv to your selected environment,
// and configure the matching AppID in project.config.json.
module.exports = { mode: 'demo', cloudEnv: '', allowDeviceOperations: false };
