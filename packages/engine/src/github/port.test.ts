import { describe, expect, it } from "vitest";
import { createGitHubPort, GitHubError } from "./port.js";

function fetchReturning(response: Response, seen: Request[] = []): typeof fetch {
  return async (input, init) => {
    seen.push(new Request(input, init));
    return response;
  };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

describe("createGitHubPort", () => {
  it("posts the query with the token and returns data", async () => {
    const seen: Request[] = [];
    const port = createGitHubPort({
      token: "t0ken",
      fetch: fetchReturning(json({ data: { ok: 1 } }), seen),
    });

    await expect(port.graphql("query { ok }", { a: 1 })).resolves.toEqual({ ok: 1 });
    const [request] = seen as [Request];
    expect(request.url).toBe("https://api.github.com/graphql");
    expect(request.headers.get("authorization")).toBe("bearer t0ken");
    expect(await request.json()).toEqual({ query: "query { ok }", variables: { a: 1 } });
  });

  it("turns GraphQL errors into a GitHubError", async () => {
    const port = createGitHubPort({
      token: "t",
      fetch: fetchReturning(json({ errors: [{ message: "Field 'x' doesn't exist" }] })),
    });
    await expect(port.graphql("q", {})).rejects.toThrow(/Field 'x' doesn't exist/);
  });

  it("explains a bad token and a spent rate limit, without echoing the token", async () => {
    const bad = createGitHubPort({
      token: "secret-token",
      fetch: fetchReturning(new Response("", { status: 401 })),
    });
    const error = await bad.graphql("q", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(String(error)).toMatch(/rejected the token/);
    expect(String(error)).not.toMatch(/secret-token/);

    const limited = createGitHubPort({
      token: "t",
      fetch: fetchReturning(
        new Response("{}", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1793000000" },
        }),
      ),
    });
    await expect(limited.graphql("q", {})).rejects.toThrow(/rate limit is used up until 2026/);
  });
});
