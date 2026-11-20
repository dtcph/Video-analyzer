import "@fontsource-variable/space-grotesk/wght.css";
import "./styles/tokens.css";
import "./styles/main.css";
import { App } from "./app/App";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root element");

new App(root);
