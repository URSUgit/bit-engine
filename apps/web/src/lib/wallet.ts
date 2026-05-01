import { createConfig, http, cookieStorage, createStorage, type Config } from "wagmi";
import { mainnet, arbitrum, polygon, optimism, base } from "wagmi/chains";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export const wagmiConfig: Config = createConfig({
  chains: [mainnet, arbitrum, polygon, optimism, base],
  connectors: [
    injected(),
    walletConnect({
      projectId,
      metadata: {
        name: "BitPrivat",
        description: "Professional crypto trading platform",
        url: "https://app.bitprivat.io",
        icons: ["https://app.bitprivat.io/icon.png"],
      },
    }),
    coinbaseWallet({
      appName: "BitPrivat",
      appLogoUrl: "https://app.bitprivat.io/icon.png",
    }),
  ],
  storage: createStorage({ storage: cookieStorage }),
  transports: {
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [polygon.id]: http(),
    [optimism.id]: http(),
    [base.id]: http(),
  },
  ssr: true,
});
