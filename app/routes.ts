import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("new", "routes/new.ts"),
  route("docs/:id", "routes/docs.$id.tsx"),
  route("docs/:id/folder", "routes/docs.$id.folder.ts"),
  route("slides/:id", "routes/slides.$id.tsx"),
  route("gh/import", "routes/gh.import.ts"),
  route("drive/import", "routes/drive.import.ts"),
  route("drive/asset", "routes/drive.asset.ts"),
  route("drive/search", "routes/drive.search.ts"),
  route("drive/bib", "routes/drive.bib.ts"),
] satisfies RouteConfig;
