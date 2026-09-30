import { render } from "solid-js/web";
import { App } from "./App";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root が見つかりません");

render(() => <App />, root);
