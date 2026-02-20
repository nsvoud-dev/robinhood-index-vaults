const hre = require("hardhat");

// Robinhood Chain Testnet
const WETH = "0x7943e237c7F95DA44E0301572D358911207852Fa";
const STOCK_TOKENS = [
  "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0", // PLTR
  "0x71178BAc73cBeb415514eB542a8995b82669778d",  // AMD
  "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93",  // NFLX
  "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",  // AMZN
  "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",  // TSLA
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // 1. Deploy MockSwapRouter (updated: has receive() for ETH)
  const MockSwapRouter = await hre.ethers.getContractFactory("MockSwapRouter");
  const router = await MockSwapRouter.deploy(WETH, STOCK_TOKENS);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log("MockSwapRouter deployed to:", routerAddress);

  // 2. Deploy IndexVault with router address
  const IndexVault = await hre.ethers.getContractFactory("IndexVault");
  const vault = await IndexVault.deploy(WETH, "Robinhood Index Vault", "rIDX", routerAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("IndexVault deployed to:", vaultAddress);

  console.log("Index tokens:", await vault.getIndexTokens());
  console.log("Weights (bps):", await vault.getWeightsBps());

  console.log("\n--- Next steps ---");
  console.log("1. Seed the router: npx hardhat run scripts/seedRouter.js --network robinhoodTestnet -- " + routerAddress);
  console.log("2. Set NEXT_PUBLIC_INDEX_VAULT_ADDRESS=" + vaultAddress + " in frontend/.env.local");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
