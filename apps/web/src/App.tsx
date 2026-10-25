import { useQuery } from "@tanstack/react-query";
import { Route, Switch } from "wouter";
import { api, HttpError } from "./lib/api";
import { readStaticReport } from "./lib/static-report";
import { ChangesPage } from "./pages/ChangesPage";
import { SignInPage } from "./pages/SignInPage";
import { WorkspacePage } from "./pages/WorkspacePage";

const staticReport = readStaticReport();

export function App() {
  // A page written by the CLI renders its embedded report and never calls the API.
  if (staticReport) return <WorkspacePage report={staticReport} mode="static" />;
  return <ServerApp />;
}

function ServerApp() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });

  if (me.isPending) return null;
  if (me.error instanceof HttpError && me.error.status === 401) return <SignInPage />;
  if (me.error) {
    return <p className="p-6 text-muted">Couldn't reach the Strata server: {me.error.message}</p>;
  }

  return (
    <Switch>
      <Route path="/" component={() => <ChangesPage me={me.data} />} />
      <Route path="/changes/:id">
        {() => <WorkspacePage report={null} mode="server" me={me.data} />}
      </Route>
      <Route>
        <p className="p-6 text-muted">Page not found.</p>
      </Route>
    </Switch>
  );
}
