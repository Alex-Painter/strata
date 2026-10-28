import { Logo } from "../components/Icon";

const AUTH_ERRORS: Record<string, string> = {
  not_allowed: "That GitHub account is not on this Strata's allowlist.",
  invalid_state: "The sign-in expired or stopped. Try again.",
  github_error: "GitHub did not complete the sign-in. Try again.",
};

export function SignInPage() {
  const error = new URLSearchParams(window.location.search).get("auth_error");
  return (
    <main className="flex h-full items-center justify-center p-4">
      <div className="grid w-80 justify-items-center gap-5 rounded-lg border border-line bg-surface px-6 pt-8 pb-6 text-center">
        <Logo />
        <div className="grid gap-1">
          <h1 className="h1">Strata</h1>
          <p className="text-muted">Review the system change, not only the diff.</p>
        </div>
        {error && (
          <p className="alert w-full text-left">{AUTH_ERRORS[error] ?? "The sign-in failed."}</p>
        )}
        <a href="/auth/login" className="btn primary h-8 w-full justify-center">
          Sign in with GitHub
        </a>
      </div>
    </main>
  );
}
