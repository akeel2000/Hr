const CANONICAL_AGENTS = ["Dharshan", "Thileeban", "Sakeer", "Akash", "Aahila"] as const;

const AGENT_ALIASES: Record<string, string> = {
  dharshan: "Dharshan",
  thileeban: "Thileeban",
  dileepan: "Thileeban",
  sakeer: "Sakeer",
  shakeer: "Sakeer",
  akash: "Akash",
  akahs: "Akash",
  aahila: "Aahila"
};

function levenshteinDistance(left: string, right: string): number {
  const matrix = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));

  for (let index = 0; index <= left.length; index += 1) {
    matrix[index][0] = index;
  }

  for (let index = 0; index <= right.length; index += 1) {
    matrix[0][index] = index;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + substitutionCost
      );
    }
  }

  return matrix[left.length][right.length];
}

function normalizedSimilarity(left: string, right: string): number {
  const maxLength = Math.max(left.length, right.length);

  if (!maxLength) {
    return 1;
  }

  return 1 - levenshteinDistance(left, right) / maxLength;
}

export function normalizeAgentName(rawName: string): string {
  const cleaned = String(rawName || "").trim().replace(/\s+/g, " ");
  const lowered = cleaned.toLowerCase();

  if (!cleaned) {
    return "";
  }

  const aliased = AGENT_ALIASES[lowered];

  if (aliased) {
    return aliased;
  }

  let bestMatch = cleaned;
  let bestScore = 0;

  for (const agent of CANONICAL_AGENTS) {
    const score = normalizedSimilarity(lowered, agent.toLowerCase());

    if (score > bestScore) {
      bestScore = score;
      bestMatch = agent;
    }
  }

  return bestScore >= 0.7 ? bestMatch : cleaned;
}

export function isTrackedAgent(name: string): boolean {
  return CANONICAL_AGENTS.includes(name as (typeof CANONICAL_AGENTS)[number]);
}
