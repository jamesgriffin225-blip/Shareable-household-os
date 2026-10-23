/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This app lives in a subdirectory of a repo that also holds an unrelated
  // Next project. Pin the root or the bundler walks up and picks up the other
  // one's PostCSS config.
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  // The dashboard is a long-lived tab on a wall-mounted tablet. Anything it
  // caches for longer than a few seconds is a stale household.
  headers: async () => [
    {
      source: "/api/:path*",
      headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
    },
  ],
};

module.exports = nextConfig;
