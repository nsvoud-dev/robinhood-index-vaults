const hre = require("hardhat");

const MOCK_SWAP_ROUTER = "0x31ecd0d9cEd7AB0744A96acC8e3432576fc8e691"
const AMOUNT = hre.ethers.parseEther("1"); // 1 token per stock (18 decimals)

const STOCK_TOKENS = [
  "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0", // PLTR
  "0x71178BAc73cBeb415514eB542a8995b82669778d",  // AMD
  "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93",  // NFLX
  "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",  // AMZN
  "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",  // TSLA
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log("Funding from account:", signer.address);
  console.log("Funding NEW router at", MOCK_SWAP_ROUTER);

  const router = await hre.ethers.getContractAt("MockSwapRouter", MOCK_SWAP_ROUTER);

  for (let i = 0; i < STOCK_TOKENS.length; i++) {
    const tokenAddress = STOCK_TOKENS[i];
    const token = new hre.ethers.Contract(tokenAddress, ERC20_ABI, signer);

    const balance = await token.balanceOf(signer.address);
    if (balance < AMOUNT) {
      console.log(`  Token ${i + 1} (${tokenAddress}): balance ${hre.ethers.formatEther(balance)} < 1, skip`);
      continue;
    }

    const approveTx = await token.approve(MOCK_SWAP_ROUTER, AMOUNT);
    await approveTx.wait();
    console.log(`  Token ${i + 1}: approved 1 unit`);

    const fundTx = await router.fund(tokenAddress, AMOUNT);
    await fundTx.wait();
    console.log(`  Token ${i + 1}: funded 1 unit`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
