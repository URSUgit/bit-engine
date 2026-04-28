import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@bitprivat/ui", "@bitprivat/shared-types"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "cdn.bitprivat.io" },
    ],
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: process.env.APP_URL ?? "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Authorization,Content-Type" },
        ],
      },
    ];
  },
};

export default nextConfig;
