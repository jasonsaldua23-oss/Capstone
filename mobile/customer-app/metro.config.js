const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const sharedPublicRoot = path.resolve(workspaceRoot, "public");
const config = getDefaultConfig(projectRoot);

// Added: the mobile client reuses the exact customer-web artwork from /public.
config.watchFolders = [...(config.watchFolders || []), sharedPublicRoot];

module.exports = config;
