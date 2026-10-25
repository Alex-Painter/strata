const AUTH_ERRORS: Record<string, string> = {
  not_allowed: "That GitHub account isn't on this Strata's allowlist.",
  invalid_state: "Sign-in expired or was interrupted. Try again.",
  github_error: "GitHub didn't complete the sign-in. Try again.",
};

export function SignInPage() {
  const error = new URLSearchParams(window.location.search).get("auth_error");
  return (
    <main className="flex h-full items-center justify-center">
      <div className="w-80 rounded-lg border border-line bg-surface p-6 text-center">
        <h1 className="mb-1 text-lg font-semibold">Strata</h1>
        <p className="mb-5 text-muted">Review the system change, not just the diff.</p>
        {error && (
          <p className="mb-4 rounded bg-del px-3 py-2 text-left">
            {AUTH_ERRORS[error] ?? "Sign-in failed."}
          </p>
        )}
        <a
          href="/auth/login"
          className="inline-block w-full rounded-md bg-accent px-3 py-2 font-medium text-white hover:opacity-90"
        >
          Sign in with GitHub
        </a>
      </div>
    </main>
  );
}
