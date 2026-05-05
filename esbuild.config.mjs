import * as esbuild from "esbuild";
import { exec } from "child_process";

const isServe = process.argv.includes("--serve");
const defaultPort = Number(process.env.PORT ?? 3000);

// Function to pack the ZIP file
function packZip() {
  exec("node .vscode/pack-zip.js", (err, stdout, stderr) => {
    if (err) {
      console.error("Error packing zip:", err);
      return;
    }
    console.log(stdout.trim());
  });
}

// Custom plugin to pack ZIP after build or rebuild
const zipPlugin = {
  name: "zip-plugin",
  setup(build) {
    build.onEnd(() => {
      packZip();
    });
  },
};

// Base build configuration
let buildConfig = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: true,
  logLevel: "info",
  color: true,
  outdir: "dist",
  plugins: [zipPlugin],
};

// Main function to handle both serve and production builds
(async function () {
  if (isServe) {
    console.log("Starting development server...");

    // Watch and Serve Mode
    const ctx = await esbuild.context(buildConfig);

    await ctx.watch();
    let port = defaultPort;
    let served = false;

    for (let attempt = 0; attempt < 10 && !served; attempt += 1) {
      try {
        const result = await ctx.serve({
          servedir: ".",
          host: "0.0.0.0",
          port,
        });
        served = true;
        console.log(`Dev server listening on http://${result.host}:${result.port}`);
      } catch (error) {
        if (error?.message?.includes("bind: Only one usage of each socket address")) {
          port += 1;
          continue;
        }

        throw error;
      }
    }

    if (!served) {
      throw new Error(`Unable to start dev server on ports ${defaultPort}-${port - 1}`);
    }

  } else {
    console.log("Building for production...");
    await esbuild.build(buildConfig);
    console.log("Production build complete.");
  }
})();
