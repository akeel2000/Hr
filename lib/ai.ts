import OpenAI from "openai";

const apiKey = process.env.OPENROUTER_API_KEY;

export const hasAiConfig = Boolean(apiKey);

export const ai = apiKey
  ? new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey
    })
  : null;

export function getAiModel(): string {
  return process.env.OPENROUTER_MODEL || "nvidia/nemotron-nano-9b-v2:free";
}
