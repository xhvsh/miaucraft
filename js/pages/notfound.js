import { initNav } from "../lib/nav.js";

const pathEl = document.getElementById("missingPath");
if (pathEl) pathEl.textContent = window.location.pathname;

await initNav("404");