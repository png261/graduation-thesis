import { google } from "@ai-sdk/google";

// Simplified provider setup for Gemini integration
// forcing Google provider to avoid type mismatches with Vercel AI SDK

// using gemini-3-flash-preview as requested
export function getLanguageModel(modelId: string) {
  return google(modelId.replace("google/", "")) as any;
}

export function getTitleModel() {
  return google("gemini-2.5-flash-lite") as any;
}

export function getEditorModel() {
  return google("gemini-2.5-flash-lite") as any;
}
