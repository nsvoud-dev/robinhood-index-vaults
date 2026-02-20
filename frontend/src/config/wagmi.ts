import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { robinhoodTestnet } from "./chains";

export const config = getDefaultConfig({
  appName: "Robinhood Index Vault",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_ID || "YOUR_PROJECT_ID",
  chains: [robinhoodTestnet],
  ssr: true,
});
