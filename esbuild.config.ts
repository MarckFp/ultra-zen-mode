import * as esbuild from "esbuild";
import { builtinModules } from "module";

const prod: boolean = process.argv[2] === "production";

void (async (): Promise<void> => {
  const context: esbuild.BuildContext = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: [
      "obsidian",
      "electron",
      "@codemirror/autocomplete",
      "@codemirror/collab",
      "@codemirror/commands",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/search",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
      ...builtinModules,
    ],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    minify: prod,
    outfile: "main.js",
  });

  if (prod) {
    await context.rebuild();
    process.exit(0);
  } else {
    await context.watch();
  }
})();
