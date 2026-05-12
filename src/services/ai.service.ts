import { llmService } from "./llm.service";
import { type IMessage } from "@/types/llm";

export class AIService {
  /**
   * Summarizes a git diff.
   */
  async summarizeCommit(diff: string): Promise<string> {
    const messages: IMessage[] = [
      {
        role: "system",
        content: `You are an expert programmer, and you are trying to summarize a git diff.
            Reminders about the git diff format:
            For every file, there are a few metadata lines, like (for example):
            \`\`\`
            diff --git a/lib/index.js b/lib/index.js
            index addf691..b7ef603 100644
            --- a/lib/index.js
            +++ b/lib/index.js
            \`\`\`
            This means that \`lib/index.js\` was modified in this commit. Note that this is only an example.
            Then there is a specifier of the lines that were modified.
            A line starting with \`+\` means it was added.
            A line that starting with \`-\` means that line was deleted.
            A line that starts with neither \`+\` nor \`-\` is code given for context and better understanding.
            It is not part of the diff.
            [...]
            EXAMPLE SUMMARY COMMENTS:
            \`\`\`
            * Raised the amount of returned recordings from \`10\` to \`100\` [packages/server/recordings_api.ts], [packages/server/constants.ts]
            * Fixed a typo in the github action name [.github/workflows/gpt-commit-summerizer.yml]
            * Moved the \`octokit\` initialization to a separate file [src/octokit.ts], [src/index.ts]
            * Added an OpenAI API for completions [packages/utils/apis/openai.ts]
            * Lowered numeric tolerance for test files
            \`\`\`
            Most commits will have less comments than this examples list.
            The last comment does not include the file names.
            Because there were more than two relevant files in the hypothetical commit.
            Do not include parts of the example in your summary.
            It is given only as an example of appropriate comments.`,
      },
      {
        role: "user",
        content: `Please summarise the following diff file: \n\n${diff}`,
      },
    ];

    return await llmService.generateCompletion(messages, { 
      fallback: true, // Allow fallback for critical git diff summaries
    });
  }

  /**
   * Summarizes a code file for onboarding.
   */
  async summarizeCode(filename: string, code: string): Promise<string> {
    const messages: IMessage[] = [
      {
        role: "system",
        content: `You are an intelligent senior software engineer who specialises in onboarding junior software engineers onto projects.
        You are onboarding a junior software engineer and explaining to them the purpose of the ${filename} file.`,
      },
      {
        role: "user",
        content: `Here is the code:
        ${code.slice(0, 10000)}
        Give a summary no more than 100 words of the code above`,
      },
    ];

    return await llmService.generateCompletion(messages, { 
      fallback: true,
    });
  }

  /**
   * Generates embeddings for a given summary.
   */
  async generateEmbedding(summary: string): Promise<number[]> {
    return await llmService.generateEmbedding(summary);
  }
}

export const aiService = new AIService();

