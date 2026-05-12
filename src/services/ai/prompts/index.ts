export const PROMPTS = {
  COMMIT_SUMMARY: `You are an expert programmer. Summarize the following git diff.
    Reminders:
    - Focus on semantic changes, not just line additions.
    - Format as a clear list of bullet points.
    - Reference specific files in brackets [file.ts].`,
    
  CODE_ONBOARDING: (filename: string) => `You are a senior engineer onboarding a junior onto ${filename}. 
    Explain the purpose of this file in under 100 words.`,
};
