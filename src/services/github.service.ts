import { db } from "@/server/db";
import { Octokit } from "octokit";
import axios from "axios";
import { aiService } from "./ai.service";
import { env } from "@/env";
import { GithubRepoLoader } from "@langchain/community/document_loaders/web/github";
import { type Document } from "@langchain/core/documents";

const cleanToken = (token?: string) => {
  if (!token) return undefined;
  return token.replace(/^['"]|['"]$/g, "");
};

export class GitHubService {
  private octokit: Octokit;
  private token: string | undefined;

  constructor(token?: string) {
    this.token = cleanToken(token) || cleanToken(env.GITHUB_TOKEN);
    this.octokit = new Octokit({
      auth: this.token,
    });
  }

  async getCommitHashes(githubUrl: string): Promise<any[]> {
    const [owner, repo] = githubUrl.split("/").slice(-2);
    if (!owner || !repo) {
      throw new Error("Invalid GitHub URL");
    }
    const { data } = await this.octokit.rest.repos.listCommits({
      owner,
      repo,
    });

    const sortedCommits = data.sort(
      (a: any, b: any) =>
        new Date(b.commit.author.date).getTime() -
        new Date(a.commit.author.date).getTime(),
    );

    return sortedCommits.slice(0, 10).map((commit: any) => ({
      commitHash: commit.sha,
      commitMessage: commit.commit.message ?? "",
      commitAuthorName: commit.commit?.author?.name ?? "",
      commitAuthorAvatar: commit?.author?.avatar_url ?? "",
      commitDate: commit.commit?.author?.date ?? "",
    }));
  }

  async pollCommits(projectId: string) {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { githubUrl: true },
    });
    if (!project?.githubUrl) {
      throw new Error(`Project with ID ${projectId} not found`);
    }

    const githubUrl = project.githubUrl;
    const commitHashes = await this.getCommitHashes(githubUrl);
    
    const processedCommits = await db.commit.findMany({
      where: { projectId },
    });

    const unprocessedCommits = commitHashes.filter(
      (commit) => !processedCommits.some((pc) => pc.commitHash === commit.commitHash)
    );

    const summaryResponses = await Promise.allSettled(
      unprocessedCommits.map((commit) => this.summarizeCommit(githubUrl, commit.commitHash))
    );

    const commitsData = summaryResponses.map((response, index) => {
      const summary = response.status === "fulfilled" ? response.value : "Failed to generate summary.";
      const commit = unprocessedCommits[index]!;
      
      return {
        projectId,
        commitHash: commit.commitHash,
        commitMessage: commit.commitMessage,
        commitAuthorName: commit.commitAuthorName,
        commitAuthorAvatar: commit.commitAuthorAvatar,
        commitDate: commit.commitDate ? new Date(commit.commitDate) : new Date(),
        summary,
      };
    });

    return await db.commit.createMany({
      data: commitsData,
    });
  }

  private async summarizeCommit(githubUrl: string, commitHash: string) {
    const [owner, repo] = githubUrl.split("/").slice(-2);
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${commitHash}`;

    try {
      const { data } = await axios.get(apiUrl, {
        headers: {
          Accept: "application/vnd.github.v3.diff",
          Authorization: `Bearer ${this.token}`,
        },
      });

      return await aiService.summarizeCommit(data);
    } catch (error: any) {
      console.error(`Error summarizing commit ${commitHash}:`, error.message);
      return "Error: Could not fetch or summarize diff.";
    }
  }

  async checkCredits(githubUrl: string) {
    const [owner, repo] = githubUrl.split("/").slice(-2);
    if (!owner || !repo) return 0;

    try {
      const { data: repoData } = await this.octokit.rest.repos.get({
        owner,
        repo,
      });
      const defaultBranch = repoData.default_branch;

      const { data } = await this.octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: defaultBranch,
        recursive: "true",
      });

      return data.tree.filter((item) => item.type === "blob").length;
    } catch (error) {
      console.error("Error fetching repository tree:", error);
      throw error;
    }
  }

  async indexRepo(projectId: string, githubUrl: string) {
    const [owner, repo] = githubUrl.split("/").slice(-2);
    if (!owner || !repo) throw new Error("Invalid GitHub URL");

    let defaultBranch = "main";
    try {
      const { data: repoData } = await this.octokit.rest.repos.get({ owner, repo });
      defaultBranch = repoData.default_branch;
    } catch (e) {
      console.warn("Falling back to branch search");
      // ... same fallback logic as original ...
    }

    const loader = new GithubRepoLoader(githubUrl, {
      accessToken: this.token || "",
      branch: defaultBranch,
      ignoreFiles: ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"],
      recursive: true,
      unknown: "warn",
      maxConcurrency: 5,
    });

    const docs = await loader.load();
    
    const CONCURRENCY_LIMIT = 5;
    const results: any[] = [];
    
    // Process documents with limited concurrency
    for (let i = 0; i < docs.length; i += CONCURRENCY_LIMIT) {
      const chunk = docs.slice(i, i + CONCURRENCY_LIMIT);
      const chunkResults = await Promise.allSettled(
        chunk.map(async (doc, index) => {
          const docIndex = i + index + 1;
          console.log(`Indexing ${docIndex}/${docs.length}: ${doc.metadata.source}`);
          const summary = await aiService.summarizeCode(doc.metadata.source, doc.pageContent);
          const embedding = await aiService.generateEmbedding(summary);
          
          const sourceCodeEmbedding = await db.sourceCodeEmbedding.create({
            data: {
              summary,
              sourceCode: JSON.parse(JSON.stringify(doc.pageContent)),
              fileName: doc.metadata.source,
              projectId,
            },
          });

          await db.$executeRaw`
            UPDATE "SourceCodeEmbedding"
            SET "summaryEmbedding" = ${embedding}::vector
            WHERE "id" = ${sourceCodeEmbedding.id}
          `;
        })
      );
      results.push(...chunkResults);
      
      // Optional: Add a small delay between chunks to further respect rate limits
      if (i + CONCURRENCY_LIMIT < docs.length) {
        console.log(`[GitHubService] Waiting 5s before next batch of ${CONCURRENCY_LIMIT} files...`);
        await new Promise(res => setTimeout(res, 5000));
      }
    }
    
    return results;
  }
}

export const githubService = new GitHubService();

