import { useQuery } from "@tanstack/react-query";
import { Route, Switch } from "wouter";
import { api, HttpError } from "./lib/api";
import { readStaticReport } from "./lib/static-report";
import { ChangesPage } from "./pages/ChangesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./pages/SignInPage";
import { StacksPage } from "./pages/StacksPage";
import { WorkspacePage } from "./pages/WorkspacePage";

const staticReport = readStaticReport();

export function App() {
  // A page written by the CLI renders its embedded report and never calls the API.
  if (staticReport) return <WorkspacePage mode="static" report={staticReport} />;
  return <ServerApp />;
}

function ServerApp() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });

  if (me.isPending) return null;
  if (me.error instanceof HttpError && me.error.status === 401) return <SignInPage />;
  if (me.error) {
    return (
      <p className="p-6 text-muted">Strata cannot connect to its server: {me.error.message}</p>
    );
  }

  return (
    <Switch>
      <Route path="/" component={() => <ChangesPage me={me.data} />} />
      <Route path="/settings">{() => <SettingsPage me={me.data} />}</Route>
      <Route path="/repos/:owner/:name">{() => <StacksPage me={me.data} />}</Route>
      {/* A new id is a new page, so a path picked on the old one stops asking. */}
      <Route path="/changes/:id">
        {(params) => <WorkspacePage key={params.id} mode="server" me={me.data} />}
      </Route>
      <Route>
        <p className="p-6 text-muted">Page not found.</p>
      </Route>
    </Switch>
  );
}
