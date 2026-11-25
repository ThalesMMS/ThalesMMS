const { writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const { generatePublicCard } = require("../api/top-langs");

async function main() {
  const username = process.env.GITHUB_REPOSITORY_OWNER || "ThalesMMS";
  const svg = await generatePublicCard(username);
  await writeFile(join(__dirname, "../assets/top-langs.svg"), `${svg}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
