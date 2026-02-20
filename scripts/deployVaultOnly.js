const hre = require("hardhat");

// Deploy only IndexVault using existing MockSwapRouter. Router is NOT redeployed.
// Usage: npx hardhat run scripts/deployVaultOnly.js --network robinhoodTestnet

const WETH = "0x7943e237c7F95DA44E0301572D358911207852Fa";
const ROUTER_ADDRESS = "0x31ecd0d9cEd7AB0744A96acC8e3432576fc8e691";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying vault with account:", deployer.address);
  console.log("Using existing router:", ROUTER_ADDRESS);

  const IndexVault = await hre.ethers.getContractFactory("IndexVault");
  const vault = await IndexVault.deploy(WETH, "Robinhood Index Vault", "rIDX", ROUTER_ADDRESS);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("IndexVault deployed to:", vaultAddress);

  console.log("\n--- Next step ---");
  console.log("Set NEXT_PUBLIC_INDEX_VAULT_ADDRESS=" + vaultAddress + " in frontend/.env.local and restart the dev server.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
