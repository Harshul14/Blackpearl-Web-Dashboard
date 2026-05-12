
import { Octokit } from "octokit";

const cleanToken = (token) => {
  if (!token) return undefined;
  return token.replace(/^['"]|['"]$/g, "");
};

async function testGetFileCount() {
  const token = cleanToken(process.env.GITHUB_TOKEN);
  console.log("Token cleaned (first 4 chars):", token?.substring(0, 4));
  
  if (!token) {
    console.error("GITHUB_TOKEN not found in environment.");
    return;
  }

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

    const fileCount = data.tree.filter((item) => item.type === "blob").length;
    console.log(`Total files in ${owner}/${repo}: ${fileCount}`);
    
    if (fileCount > 0) {
      console.log("Verification SUCCESS: Successfully fetched file count using Trees API.");
    } else {
      console.log("Verification FAILED: File count is 0.");
    }
  } catch (error) {
    console.error("Verification FAILED with error:", error.status, error.message);
  }
}

testGetFileCount();
