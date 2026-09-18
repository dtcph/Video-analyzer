import { App } from "./app/App";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root element");

new App(root);
