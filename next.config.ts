import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NOTE: cacheComponents is intentionally off. This is a data-driven
  // app: pages use `force-dynamic` so every request reads fresh data
  // from Postgres instead of serving a build-time snapshot.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
