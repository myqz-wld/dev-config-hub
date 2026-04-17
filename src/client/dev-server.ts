import index from "./index.html";

Bun.serve({
  port: 3456,
  routes: { "/": index },
  development: { hmr: true, console: true },
});

console.log("Frontend dev server: http://localhost:3456");
