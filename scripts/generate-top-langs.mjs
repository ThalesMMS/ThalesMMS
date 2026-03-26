#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const THEMES = {
  default: {
    titleColor: "#2f80ed",
    textColor: "#434d58",
    bgColor: "#fffefe",
    borderColor: "#e4e2e2",
  },
  tokyonight: {
    titleColor: "#70a5fd",
    textColor: "#38bdae",
    bgColor: "#1a1b27",
    borderColor: "#30363d",
  },
};

const GRAPHQL_QUERY = `
  query UserLanguages($login: String!) {
    user(login: $login) {
      repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
        nodes {
          name
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                color
                name
              }
            }
          }
        }
      }
    }
  }
`;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function splitCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getTheme(name) {
  return THEMES[name] ?? THEMES.default;
}

function getTokens() {
  const numberedTokens = Object.keys(process.env)
    .filter((key) => /^PAT_\d+$/.test(key))
    .sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]))
    .map((key) => process.env[key]);

  return [process.env.GITHUB_TOKEN, process.env.GH_TOKEN, process.env.PAT, ...numberedTokens]
    .filter(Boolean)
    .filter((token, index, tokens) => tokens.indexOf(token) === index);
}

async function loadPayloadFromInput(inputPath) {
  const raw = await fs.readFile(inputPath, "utf8");
  return JSON.parse(raw);
}

async function fetchPayload(username) {
  const tokens = getTokens();

  if (!tokens.length) {
    throw new Error(
      "No GitHub token found. Set GITHUB_TOKEN, GH_TOKEN, PAT, or PAT_1 before running the generator.",
    );
  }

  let lastError = null;

  for (const token of tokens) {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: GRAPHQL_QUERY,
        variables: { login: username },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    const message = payload?.message || payload?.errors?.[0]?.message || "";
    const errorType = payload?.errors?.[0]?.type;

    if (
      response.status === 401 ||
      /bad credentials|account was suspended/i.test(message) ||
      errorType === "RATE_LIMITED" ||
      /rate limit/i.test(message)
    ) {
      lastError = new Error(message || `GitHub API request failed with status ${response.status}`);
      continue;
    }

    if (!response.ok) {
      throw new Error(message || `GitHub API request failed with status ${response.status}`);
    }

    return payload;
  }

  throw lastError ?? new Error("GitHub API rate limit exceeded for all configured tokens.");
}

function aggregateLanguages(payload, hiddenLanguages) {
  const repositories = payload?.data?.user?.repositories?.nodes ?? [];
  const hidden = new Set(hiddenLanguages.map((name) => name.toLowerCase()));
  const totals = new Map();

  for (const repository of repositories) {
    for (const edge of repository?.languages?.edges ?? []) {
      const languageName = edge?.node?.name;

      if (!languageName || hidden.has(languageName.toLowerCase())) {
        continue;
      }

      const current = totals.get(languageName) ?? {
        name: languageName,
        color: edge.node.color || "#858585",
        size: 0,
      };

      current.size += Number(edge.size) || 0;
      totals.set(languageName, current);
    }
  }

  return [...totals.values()].sort((a, b) => b.size - a.size);
}

function renderSvg(languages, options) {
  const theme = getTheme(options.theme);
  const visibleLanguages = languages.slice(0, options.langsCount);
  const totalSize = visibleLanguages.reduce((sum, language) => sum + language.size, 0);
  const width = Number(options.cardWidth) || 315;
  const half = Math.ceil(visibleLanguages.length / 2);
  const leftColumn = visibleLanguages.slice(0, half);
  const rightColumn = visibleLanguages.slice(half);
  const longestLabel = visibleLanguages.reduce((max, language) => {
    const pct = totalSize ? ((language.size / totalSize) * 100).toFixed(2) : "0.00";
    const label = `${language.name} ${pct}%`;
    return Math.max(max, label.length);
  }, 0);
  const columnGap = Math.max(150, 20 + longestLabel * 6);
  const rowHeight = 24;
  const barHeight = 8;
  const headerHeight = 32;
  const contentTop = 58;
  const contentRows = Math.max(leftColumn.length, rightColumn.length);
  const height = contentTop + contentRows * rowHeight + 12;

  let offset = 0;
  const segments = visibleLanguages
    .map((language) => {
      const widthPct = totalSize ? (language.size / totalSize) * (width - 50) : 0;
      const segment = `<rect x="${offset.toFixed(2)}" y="0" width="${widthPct.toFixed(
        2,
      )}" height="${barHeight}" fill="${language.color || "#858585"}" />`;
      offset += widthPct;
      return segment;
    })
    .join("");

  const renderLine = (language, index) => {
    const pct = totalSize ? ((language.size / totalSize) * 100).toFixed(2) : "0.00";
    const y = index * rowHeight;

    return `
      <g transform="translate(0 ${y})">
        <circle cx="5" cy="6" r="5" fill="${language.color || "#858585"}" />
        <text x="15" y="10" class="lang">${escapeXml(language.name)} ${pct}%</text>
      </g>
    `;
  };

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="top-langs-title top-langs-desc">
  <title id="top-langs-title">Most Used Languages</title>
  <desc id="top-langs-desc">Auto-generated language usage summary for ${escapeXml(options.username)}.</desc>
  <style>
    .title { font: 600 18px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${theme.titleColor}; }
    .lang { font: 400 11px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${theme.textColor}; }
  </style>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="4.5" fill="${theme.bgColor}" stroke="${theme.borderColor}" />
  <text x="24" y="${headerHeight}" class="title">Most Used Languages</text>
  <g transform="translate(25 42)">
    <rect x="0" y="0" width="${width - 50}" height="${barHeight}" fill="${theme.borderColor}" rx="4" />
    <g clip-path="url(#bar-mask)">
      ${segments}
    </g>
  </g>
  <defs>
    <clipPath id="bar-mask">
      <rect x="25" y="42" width="${width - 50}" height="${barHeight}" rx="4" />
    </clipPath>
  </defs>
  <g transform="translate(25 ${contentTop})">
    <g transform="translate(0 0)">
      ${leftColumn.map(renderLine).join("")}
    </g>
    <g transform="translate(${columnGap} 0)">
      ${rightColumn.map(renderLine).join("")}
    </g>
  </g>
</svg>
`.trimStart();
}

async function main() {
  const username = process.env.TOP_LANGS_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || "ThalesMMS";
  const inputPath = process.env.TOP_LANGS_INPUT;
  const outputPath = process.env.TOP_LANGS_OUTPUT || "assets/top-langs.svg";
  const hiddenLanguages = splitCsv(process.env.TOP_LANGS_HIDE);
  const langsCount = Number(process.env.TOP_LANGS_COUNT || 10);
  const theme = process.env.TOP_LANGS_THEME || "tokyonight";
  const payload = inputPath ? await loadPayloadFromInput(inputPath) : await fetchPayload(username);
  const languages = aggregateLanguages(payload, hiddenLanguages);
  const svg = renderSvg(languages, {
    username,
    langsCount,
    theme,
    cardWidth: 315,
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, svg, "utf8");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
