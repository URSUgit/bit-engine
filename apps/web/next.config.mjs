/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@bitprivat/ui", "@bitprivat/shared-types"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "cdn.bitprivat.io" },
    ],
  },
  // Wagmi + WalletConnect pull in a few optional peer dependencies that are
  // only used in React Native or optional logger pretty-printing. Mark them
  // as externals so webpack stops complaining during the bundle pass.
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding", "@react-native-async-storage/async-storage");
    return config;
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
