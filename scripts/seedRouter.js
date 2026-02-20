const hre = require("hardhat");

// Router address: pass as CLI arg after -- e.g. npx hardhat run scripts/seedRouter.js --network X -- 0x...
const ROUTER_ADDRESS = process.argv[2] || process.env.ROUTER_ADDRESS;
const ETH_AMOUNT = hre.ethers.parseEther("0.0005"); // 0.0005 ETH for WETH liquidity (Stock -> WETH)

async function main() {
  if (!ROUTER_ADDRESS || !ROUTER_ADDRESS.startsWith("0x")) {
    console.error("Usage: npx hardhat run scripts/seedRouter.js --network robinhoodTestnet -- <ROUTER_ADDRESS>");
    console.error("Or set ROUTER_ADDRESS in env.");
    process.exitCode = 1;
    return;
  }

  const [signer] = await hre.ethers.getSigners();
  console.log("Seeding from account:", signer.address);
  console.log("Router address:", ROUTER_ADDRESS);

  // Send ETH to router (for WETH liquidity when users withdraw Stock -> WETH)
  const tx = await signer.sendTransaction({
    to: ROUTER_ADDRESS,
    value: ETH_AMOUNT,
  });
  await tx.wait();
  console.log("  Sent " + hre.ethers.formatEther(ETH_AMOUNT) + " ETH to router");

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
