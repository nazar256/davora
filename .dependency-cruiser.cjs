/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true }
    },
    {
      name: "no-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true }
    },
    {
      name: "shared-does-not-depend-on-apps",
      severity: "error",
      from: { path: "^packages/shared/src" },
      to: { path: "^apps/" }
    },
    {
      name: "web-does-not-depend-on-worker",
      severity: "error",
      from: { path: "^apps/web/src" },
      to: { path: "^apps/worker/src" }
    },
    {
      name: "worker-does-not-depend-on-web",
      severity: "error",
      from: { path: "^apps/worker/src" },
      to: { path: "^apps/web/src" }
    }
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    includeOnly: "^(apps/(web|worker)/src|packages/shared/src)",
    tsConfig: { fileName: "tsconfig.base.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"]
    },
    reporterOptions: {
      text: { highlightFocused: false }
    }
  }
};
