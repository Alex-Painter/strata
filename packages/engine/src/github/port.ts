/**
 * The engine's only door to the GitHub API. Tests swap in a fake that replays
 * recorded responses, so nothing else in the engine talks to the network.
 */

export interface GitHubPort {
  /** Runs a GraphQL query and returns its `data`. */
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface GitHubPortOptions {
  token: string;
  endpoint?: string;
  fetch?: typeof globalThis.fetch;
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: { type?: string; message: string }[];
}

export function createGitHubPort(options: GitHubPortOptions): GitHubPort {
  const endpoint = options.endpoint ?? "https://api.github.com/graphql";
  const send = options.fetch ?? globalThis.fetch;
  return {
    async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      const response = await send(endpoint, {
        method: "POST",
        headers: {
          authorization: `bearer ${options.token}`,
          "content-type": "application/json",
          "user-agent": "strata",
        },
        body: JSON.stringify({ query, variables }),
      });
      if (!response.ok) {
        throw new GitHubError(await failureMessage(response), response.status);
      }
      const body = (await response.json()) as GraphqlResponse<T>;
      if (body.errors?.length) {
        throw new GitHubError(
          `GitHub GraphQL: ${body.errors.map((error) => error.message).join("; ")}`,
        );
      }
      if (!body.data) throw new GitHubError("GitHub GraphQL did not return data.");
      return body.data;
    },
  };
}

async function failureMessage(response: Response): Promise<string> {
  if (response.status === 401)
    return "GitHub did not accept the token (401). Examine GITHUB_TOKEN.";
  const reset = response.headers.get("x-ratelimit-reset");
  if (response.headers.get("x-ratelimit-remaining") === "0" && reset) {
    const at = new Date(Number(reset) * 1000).toISOString();
    return `GitHub's rate limit stops requests until ${at}.`;
  }
  const text = await response.text().catch(() => "");
  let message = text;
  try {
    message = (JSON.parse(text) as { message?: string }).message ?? text;
  } catch {}
  return `GitHub returned ${response.status}: ${message.slice(0, 300)}`;
}
