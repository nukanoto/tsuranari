import { render } from "solid-js/web";
import { Create } from "./Create";
import { EventPage } from "./Event";
import "./global.css";

function App() {
  const match = location.pathname.match(/^\/e\/([A-Za-z0-9]+)$/);
  return (
    <>
      <header class="site-header">
        <a href="/">tsuranari</a>
        <span>日程調整</span>
      </header>
      <main>{match ? <EventPage id={match[1]} /> : <Create />}</main>
    </>
  );
}

const root = document.getElementById("root");
if (root) render(() => <App />, root);
