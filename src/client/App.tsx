import { createRouter } from "@solidjs/router";
import { EventPage } from "./pages/EventPage";
import { Manage } from "./pages/Manage";
import { NewEvent } from "./pages/NewEvent";
import { Privacy } from "./pages/Privacy";
import { Terms } from "./pages/Terms";
import { Top } from "./pages/Top";

const Router = createRouter({
  routes: [
    { path: "/", component: Top },
    { path: "/new", component: NewEvent },
    { path: "/e/:id", component: EventPage },
    { path: "/e/:id/manage", component: Manage },
    { path: "/terms", component: Terms },
    { path: "/privacy", component: Privacy },
  ],
});

export function App() {
  return <Router />;
}
