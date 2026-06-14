const { execFileSync } = require("node:child_process");
const path = require("node:path");

function findCodeSigningIdentity() {
  if (process.env.DANMAKU_CODESIGN_IDENTITY) {
    return process.env.DANMAKU_CODESIGN_IDENTITY;
  }

  if (process.env.CSC_NAME) {
    return process.env.CSC_NAME;
  }

  const output = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
  });
  const identityPattern = /"([^"]+)"/g;
  const identities = [...output.matchAll(identityPattern)].map((match) => match[1]);
  const match =
    identities.find((identity) => identity.includes("Developer ID Application")) ??
    identities.find((identity) => identity.includes("Apple Development")) ??
    identities[0];

  if (!match) {
    throw new Error(
      "No usable macOS code signing identity found. Set DANMAKU_CODESIGN_IDENTITY or install a local code signing certificate.",
    );
  }

  return match;
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const identity = findCodeSigningIdentity();
  console.log(`Signing ${appPath} with "${identity}"`);
  execFileSync("codesign", ["--force", "--deep", "--sign", identity, appPath], {
    stdio: "inherit",
  });
};
