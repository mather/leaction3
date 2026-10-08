import { render } from "solid-js/web";
import { App } from "./App";
import { startAnalytics } from "./lib/analytics";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root が見つかりません");

// ルーターが URL を読む前に、?src= を読み取ってアドレスバーから消す
startAnalytics();
render(() => <App />, root);
