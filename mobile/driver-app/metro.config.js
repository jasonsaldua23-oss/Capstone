const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
// The OTP expiry and resend timings live in shared/customer-logic so the driver app,
// the customer app and the web portal expire codes on one schedule. Metro only
// resolves modules inside the project root unless the folder is watched, and without
// this the import fails and the whole bundle blanks.
const sharedLogicRoot = path.resolve(workspaceRoot, "shared");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders || []), sharedLogicRoot];

module.exports = config;
