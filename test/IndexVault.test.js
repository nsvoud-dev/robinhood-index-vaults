const { expect } = require("chai");
const { ethers } = require("hardhat");

const WETH = "0x7943e237c7F95DA44E0301572D358911207852Fa";
const STOCK_TOKENS = [
  "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0",
  "0x71178BAc73cBeb415514eB542a8995b82669778d",
  "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93",
  "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",
  "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
];

describe("IndexVault", function () {
  let vault;
  let router;
  let owner;
  let user;

  before(async function () {
    [owner, user] = await ethers.getSigners();
    const MockSwapRouter = await ethers.getContractFactory("MockSwapRouter");
    router = await MockSwapRouter.deploy(WETH, STOCK_TOKENS);
    await router.waitForDeployment();
    const IndexVault = await ethers.getContractFactory("IndexVault");
    vault = await IndexVault.deploy(WETH, "Robinhood Index Vault", "rIDX", await router.getAddress());
    await vault.waitForDeployment();
  });

  it("Should set correct name and symbol", async function () {
    expect(await vault.name()).to.equal("Robinhood Index Vault");
    expect(await vault.symbol()).to.equal("rIDX");
  });

  it("Should have 5 index tokens and weights 2000 each (20%)", async function () {
    const tokens = await vault.getIndexTokens();
    expect(tokens.length).to.equal(5);
    const weights = await vault.getWeightsBps();
    expect(weights[0]).to.equal(2000);
    expect(weights[1]).to.equal(2000);
    expect(weights[2]).to.equal(2000);
    expect(weights[3]).to.equal(2000);
    expect(weights[4]).to.equal(2000);
  });

  it("Only owner can call rebalanceIndex", async function () {
    await expect(vault.connect(user).rebalanceIndex()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
  });

  it("Only owner can setIndex", async function () {
    await expect(
      vault.connect(user).setIndex([], [], [])
    ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
  });
});
