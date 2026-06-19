// Paged.js ships no TypeScript types. Declare the minimal surface we use (the
// Previewer's preview() pagination call). See app/lib/print-paged.client.ts.
declare module "pagedjs" {
  export class Previewer {
    constructor();
    preview(
      content: string | Node,
      stylesheets?: Array<string | Record<string, string>>,
      renderTo?: Element,
    ): Promise<unknown>;
  }
}
