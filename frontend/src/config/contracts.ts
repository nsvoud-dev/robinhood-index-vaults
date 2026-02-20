export const WETH = "0x7943e237c7F95DA44E0301572D358911207852Fa" as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Must be set in .env.local as NEXT_PUBLIC_INDEX_VAULT_ADDRESS (deployed vault address)
const rawVault = process.env.NEXT_PUBLIC_INDEX_VAULT_ADDRESS;
export const INDEX_VAULT_ADDRESS: `0x${string}` | undefined =
  rawVault && rawVault !== ZERO_ADDRESS ? (rawVault as `0x${string}`) : undefined;

// Robinhood Testnet stock token labels (for pie chart and UI)
export const INDEX_TOKEN_LABELS: Record<string, string> = {
  "0x1fbe1a0e43594b3455993b5de5fd0a7a266298d0": "PLTR",
  "0x71178bac73cbeb415514eb542a8995b82669778d": "AMD",
  "0x3b8262a63d25f0477c4dde23f83cfe22cb768c93": "NFLX",
  "0x5884ad2f920c162cfbbacc88c9c51aa75ec09e02": "AMZN",
  "0xc9f9c86933092bbbbfff3ccb4b105a4a94bf3bd4e": "TSLA",
};
