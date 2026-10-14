import { Route, Router } from "@solidjs/router";
import { EventPage } from "./pages/EventPage";
import { Manage } from "./pages/Manage";
import { NewEvent } from "./pages/NewEvent";
import { Privacy } from "./pages/Privacy";
import { Terms } from "./pages/Terms";
import { Top } from "./pages/Top";

export function App() {
  return (
    <Router>
      <Route path="/" component={Top} />
      <Route path="/new" component={NewEvent} />
      <Route path="/e/:id" component={EventPage} />
      <Route path="/e/:id/manage" component={Manage} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
    </Router>
  );
}
