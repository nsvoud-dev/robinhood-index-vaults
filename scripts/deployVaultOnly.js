const hre = require("hardhat");

// Deploy only IndexVault using existing MockSwapRouter. Router is NOT redeployed.
// Usage: npx hardhat run scripts/deployVaultOnly.js --network robinhoodTestnet

const WETH = "0x7943e237c7F95DA44E0301572D358911207852Fa";
const ROUTER_ADDRESS = "0x31ecd0d9cEd7AB0744A96acC8e3432576fc8e691";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Using existing router:", ROUTER_ADDRESS);
  console.log("");
  console.log("=== Deployer (this account will be the vault OWNER) ===");
  console.log("  Address:", deployer.address);
  console.log("  (Only this wallet can call Set threshold, Record snapshot, Rebalance, etc.)");
  console.log("");

  const IndexVault = await hre.ethers.getContractFactory("IndexVault");
  const vault = await IndexVault.deploy(WETH, "Robinhood Index Vault", "rIDX", ROUTER_ADDRESS);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  const ownerAddress = await vault.getOwner();
  console.log("IndexVault deployed to:", vaultAddress);
  console.log("Vault owner (getOwner):", ownerAddress);
  console.log("Owner matches deployer:", ownerAddress.toLowerCase() === deployer.address.toLowerCase() ? "YES" : "NO");
  console.log("");
  console.log("--- Next step ---");
  console.log("Set NEXT_PUBLIC_INDEX_VAULT_ADDRESS=" + vaultAddress + " in frontend/.env.local and restart the dev server.");
  console.log("Connect with the same wallet (" + deployer.address + ") to use Set threshold.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
