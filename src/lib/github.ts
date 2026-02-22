import { db } from "@/server/db";
import { Octokit } from "octokit";
import { aISummariseCommit } from "./gemini";
import axios from "axios";

export const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const githubUrl = "https://github.com/docker/genai-stack";

type Response = {
  commitHash: string;
  commitMessage: string;
  commitAuthorName: string;
  commitAuthorAvatar: string;
  commitDate: string;
};

export const getCommitHashes = async (
  githubUrl: string,
): Promise<Response[]> => {
  const [owner, repo] = githubUrl.split("/").slice(-2);
  if (!owner || !repo) {
    throw new Error("Invalid GitHub URL");
  }
  const { data } = await octokit.rest.repos.listCommits({
    owner,
    repo,
  });

  const sortedCommits = data.sort(
    (a: any, b: any) =>
      new Date(b.commit.author.date).getTime() -
      new Date(a.commit.author.date).getTime(),
  ) as any[];

  return sortedCommits.slice(0, 10).map((commit: any) => ({
    commitHash: commit.sha as string,
    commitMessage: commit.commit.message ?? "",
    commitAuthorName: commit.commit?.author?.name ?? "",
    commitAuthorAvatar: commit?.author?.avatar_url ?? "",
    commitDate: commit.commit?.author?.date ?? "",
  }));
};
export const pollCommits = async (projectId: string) => {
  const { project, githubUrl } = await fetchProjectGithubUrl(projectId);
  const commitHashes = await getCommitHashes(githubUrl);
  const unporcessedCommits = await filterUnprocessedCommits(
    projectId,
    commitHashes,
  );
  const summaryResponses = await Promise.allSettled(
    unporcessedCommits.map((commit) => {
      return summariseCommit(githubUrl, commit.commitHash);
    }),
  );

  summaryResponses.forEach((response, index) => {
    if (response.status === "rejected") {
      console.error(`Error processing commit ${index}:`, response.reason);
    }
  });
  const summaries = summaryResponses.map((response) => {
    if (response.status === "fulfilled") {
      return response.value;
    }
    return "";
  });

  const commits = await db.commit.createMany({
    data: summaries.map((summary, index) => {
      console.log(`processing commit ${index}`);

      return {
        projectId,
        commitHash: unporcessedCommits[index]?.commitHash ?? "",
        commitMessage: unporcessedCommits[index]?.commitMessage ?? "",
        commitAuthorName: unporcessedCommits[index]?.commitAuthorName ?? "",
        commitAuthorAvatar: unporcessedCommits[index]?.commitAuthorAvatar ?? "",
        commitDate: unporcessedCommits[index]?.commitDate ? new Date(unporcessedCommits[index].commitDate) : new Date(),
        summary,
      };
    }),
  });
  return commits;
};

async function summariseCommit(githubUrl: string, commitHash: string) {
  const [owner, repo] = githubUrl.split("/").slice(-2);
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${commitHash}`;

  const { data } = await axios.get(apiUrl, {
    headers: {
      Accept: "application/vnd.github.v3.diff",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    },
  });

  return (await aISummariseCommit(data)) || "";
}

async function fetchProjectGithubUrl(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      githubUrl: true,
    },
  });
  if (!project?.githubUrl) {
    throw new Error(`Project with ID ${projectId} not found`);
  }
  return { project, githubUrl: project?.githubUrl };
}

async function filterUnprocessedCommits(
  projectId: string,
  commitHashes: Response[],
) {
  const processedCommits = await db.commit.findMany({
    where: { projectId },
  });

  const unprocessedCommits = commitHashes.filter(
    (commit) =>
      !processedCommits.some(
        (processedCommit) => processedCommit.commitHash === commit.commitHash,
      ),
  );

  return unprocessedCommits;
}
