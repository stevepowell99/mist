import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("new", "routes/new.ts"),
  route("docs/:id", "routes/docs.$id.tsx"),
  route("gh/import", "routes/gh.import.ts"),
  route("gh/commit", "routes/gh.commit.ts"),
] satisfies RouteConfig;
