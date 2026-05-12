
import { Octokit } from "octokit";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), '.env') });

const cleanToken = (token: string | undefined) => {
  if (!token) return undefined;
  return token.replace(/^['"]|['"]$/g, "");
};

async function testGetFileCount() {
  const rawToken = process.env.GITHUB_TOKEN;
  const token = cleanToken(rawToken);
  console.log("Raw token (first 10 chars):", rawToken?.substring(0, 10));
  console.log("Cleaned token (first 10 chars):", token?.substring(0, 10));
  
  const octokit = new Octokit({ auth: token });
  const owner = "docker";
  const repo = "genai-stack";

  try {
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch;
    console.log("Default branch:", defaultBranch);

    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: defaultBranch,
      recursive: "true",
    });

    const fileCount = data.tree.filter((item: any) => item.type === "blob").length;
    console.log(`Total files in ${owner}/${repo}: ${fileCount}`);
    
    if (fileCount > 0) {
      console.log("Verification SUCCESS: Successfully fetched file count using Trees API.");
    } else {
      console.log("Verification FAILED: File count is 0.");
    }
  } catch (error: any) {
    console.error("Verification FAILED with error:", error.status, error.message);
    if (error.status === 403) {
        console.error("Rate limit still exceeded or invalid token.");
    }
  }
}

testGetFileCount();
