const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const sharedPublicRoot = path.resolve(workspaceRoot, "public");
// Added: status, money, item-label and deposit logic is shared with the web customer portal.
const sharedLogicRoot = path.resolve(workspaceRoot, "shared");
const config = getDefaultConfig(projectRoot);

// Added: the mobile client reuses the exact customer-web artwork from /public.
config.watchFolders = [...(config.watchFolders || []), sharedPublicRoot, sharedLogicRoot];

module.exports = config;
