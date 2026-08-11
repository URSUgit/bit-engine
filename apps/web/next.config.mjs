/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@bitprivat/ui", "@bitprivat/shared-types"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "cdn.bitprivat.io" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "yt3.ggpht.com" },
    ],
  },
  // Wagmi + WalletConnect pull in a few optional peer dependencies that are
  // only used in React Native or optional logger pretty-printing. Mark them
  // as externals so webpack stops complaining during the bundle pass.
  webpack: (config, { isServer }) => {
    config.externals.push("pino-pretty", "lokijs", "encoding", "@react-native-async-storage/async-storage");
    if (isServer) {
      // WalletConnect uses IndexedDB internally; suppress the "indexedDB is not defined"
      // errors that appear during Next.js static generation by externalising the storage
      // package on the server. The connector only runs in the browser anyway.
      config.externals.push("@walletconnect/keyvaluestorage");
    }
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
