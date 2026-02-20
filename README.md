# Robinhood Index Vaults

[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-363636?logo=solidity)](https://soliditylang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=next.js)](https://nextjs.org/)
[![Hardhat](https://img.shields.io/badge/Hardhat-2.19-FFC107?logo=ethereum)](https://hardhat.org/)
[![Robinhood Chain](https://img.shields.io/badge/Robinhood%20Chain-Testnet-00C805)](https://robinhood.com/crypto)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Tokenized index funds on Robinhood L2.** Deposit ETH, receive a single vault share (rIDX) representing a diversified basket of stock tokens—PLTR, AMD, NFLX, AMZN, TSLA—with one click.

---

## Vision

Traditional index funds give retail investors broad exposure without picking single stocks. **Robinhood Index Vaults** brings that experience on-chain: users deposit **ETH** (or WETH) and receive **vault shares** backed by a configurable basket of tokens. The protocol handles wrapping, swapping, and rebalancing so users get a simple “invest in the index” flow on the **Robinhood Chain** (Arbitrum Orbit) testnet today—and mainnet after audit and launch.

We aim to be the go-to **index vault** for the Robinhood & Arbitrum ecosystem, combining familiar UX with ERC-4626 composability and security best practices.

---

## Key Features

| Feature | Description |
|--------|-------------|
| **Automated multi-token swaps** | Deposit ETH → wrap to WETH → split and swap into index tokens (PLTR, AMD, NFLX, AMZN, TSLA) according to configurable weights (e.g. 20% each). No manual DEX steps. |
| **Real-time pricing via CoinGecko** | Frontend fetches ETH/USD from CoinGecko API to display portfolio value in USD and improve UX. |
| **Secure ETH withdrawals with rounding protection** | Withdraw burns shares and returns **ETH** (not WETH). Contract uses `receive()` for ETH handling and **safe transfer logic**: sends `min(actualBalance, wethOut)` so rounding or swap dust never cause over-transfer or revert. |

Additional capabilities:

- **ERC-4626 vault** — Standard asset/shares interface; compatible with integrators and future DeFi Lego.
- **Slippage protection** — `deposit(assets, receiver, minSharesOut)` and `depositEth(minSharesOut)` guard against unfavorable execution.
- **Owner rebalance** — `rebalanceIndex()` sells index tokens back to WETH and re-swaps to target weights.
- **Configurable index** — Owner can update tokens and weights (basis points) via `setIndex()`.

---

## Technical Architecture

### Vault (ERC-4626) and MockSwapRouter

- **IndexVault** is an [ERC-4626](https://eips.ethereum.org/EIPS/eip-4626) tokenized vault whose **asset** is **WETH**. It:
  - **Deposits:** Accepts ETH (wraps to WETH) or WETH, then swaps WETH into the index tokens via a Uniswap V3–style router.
  - **Withdrawals:** Converts vault “assets” (WETH-equivalent value) back to WETH by selling index tokens proportionally, then unwraps WETH to ETH and sends ETH to the user.
  - **Shares:** Users hold **rIDX** shares; `totalAssets()` is the sum of WETH balance plus index token balances valued in WETH (using a fixed conversion rate for the mock router).

- **MockSwapRouter** implements the same interface as a Uniswap V3–style `ISwapRouter` (e.g. `exactInputSingle`). It uses a fixed rate (1 WETH = 100 “stock” tokens) for testing on Robinhood Testnet. The vault is agnostic to the router implementation; swapping mainnet to a real DEX is a config change.

Flow:

1. **Deposit:** User sends ETH or approves WETH → vault wraps (if ETH) → vault calls `swapRouter.exactInputSingle` per index token with weight-based portions → vault mints shares to user.
2. **Withdraw:** User burns shares → vault computes assets to return → vault sells index tokens to router for WETH (router may need WETH liquidity; it can hold ETH via `receive()` and wrap) → vault unwraps WETH → vault sends ETH to user with rounding-safe logic.

### Security Features

- **`receive()` for ETH handling**  
  Both **IndexVault** and **MockSwapRouter** implement `receive() external payable {}`. The vault needs it to accept ETH when it unwraps WETH during withdraw and then sends ETH to the user. The router uses it to accept ETH and wrap to WETH so it can pay out WETH when users withdraw (stock → WETH swaps).

- **Safe transfer logic in `withdraw()`**  
  When withdrawing in ETH, the vault unwraps WETH and sends ETH to the user. To avoid sending more than the contract holds (e.g. due to rounding or dust), it uses:
  - `uint256 actualBalance = address(this).balance;`
  - `Address.sendValue(payable(msg.sender), actualBalance < wethOut ? actualBalance : wethOut);`  
  So the user always receives the minimum of requested amount and actual balance, preventing over-transfer and failed sends.

- **ReentrancyGuard** on all state-changing entrypoints (deposit, withdraw, redeem, rebalance).
- **OpenZeppelin** `SafeERC20`, `Address`, and `Math` for safe transfers and rounding.
- **Weights validation** in `setIndex()`: sum of basis points must equal 10,000.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 14, React 18, TypeScript, Tailwind CSS, Recharts |
| **Web3** | Wagmi 2, Viem 2, RainbowKit |
| **Smart contracts** | Solidity 0.8.20, OpenZeppelin Contracts 5.x, Hardhat 2.19 |
| **Testing / tooling** | Hardhat (Nomic Foundation toolbox), dotenv |

---

## Installation & Deployment

### Prerequisites

- Node.js 18+
- npm or yarn
- A wallet with testnet ETH on [Robinhood Chain Testnet](https://robinhood.com/crypto) (chain ID 46630)

### 1. Clone and install

```bash
git clone <your-repo-url>
cd "Index Vaults"
npm install
cd frontend && npm install && cd ..
```

### 2. Environment variables

**Root (for Hardhat scripts):**

Create a `.env` in the project root:

```env
# Private key of deployer (no 0x prefix or with 0x both work)
PRIVATE_KEY=your_private_key_here
```

**Frontend:**

Create `frontend/.env.local`:

```env
# Deployed IndexVault address (after deploy)
NEXT_PUBLIC_INDEX_VAULT_ADDRESS=0xYourDeployedVaultAddress
```

### 3. Compile contracts

```bash
npm run compile
```

### 4. Deploy to Robinhood Testnet

Full deploy (MockSwapRouter + IndexVault):

```bash
npm run deploy
```

Or with Hardhat explicitly:

```bash
npx hardhat run scripts/deploy.js --network robinhoodTestnet
```

Note the printed **MockSwapRouter** and **IndexVault** addresses.

### 5. Seed the router (required for withdrawals)

The MockSwapRouter must hold stock tokens (for WETH → stock) and WETH (for stock → WETH). After deploy:

**a) Send ETH to the router** (so it can wrap to WETH and pay users on withdraw):

```bash
npx hardhat run scripts/seedRouter.js --network robinhoodTestnet -- <ROUTER_ADDRESS>
```

**b) Fund the router with stock tokens** (so it can give tokens when users deposit):

```bash
npx hardhat run scripts/fundRouter.js --network robinhoodTestnet
```

Update the `MOCK_SWAP_ROUTER` address in `scripts/fundRouter.js` if you used a different deploy.

### 6. Run the frontend

Set `NEXT_PUBLIC_INDEX_VAULT_ADDRESS` in `frontend/.env.local` to the deployed vault address, then:

```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), connect your wallet (Robinhood Testnet), and use Deposit / Withdraw.

### Optional: Deploy only the vault

If the router is already deployed:

```bash
npx hardhat run scripts/deployVaultOnly.js --network robinhoodTestnet
```

Update the `ROUTER_ADDRESS` inside `scripts/deployVaultOnly.js` to your existing router.

---

## Project structure

```
├── contracts/
│   ├── IndexVault.sol          # ERC-4626 vault (WETH asset, rIDX shares)
│   ├── MockSwapRouter.sol      # Uniswap V3–style mock router (testnet)
│   ├── interfaces/
│   │   ├── ISwapRouter.sol
│   │   └── IWETH.sol
├── scripts/
│   ├── deploy.js               # Deploy router + vault
│   ├── deployVaultOnly.js      # Deploy vault only (existing router)
│   ├── seedRouter.js           # Send ETH to router
│   └── fundRouter.js           # Fund router with stock tokens
├── frontend/                   # Next.js app (Wagmi, RainbowKit, Tailwind)
│   ├── src/
│   │   ├── app/
│   │   ├── abis/
│   │   └── config/
│   └── .env.local              # NEXT_PUBLIC_INDEX_VAULT_ADDRESS
├── hardhat.config.js
└── README.md
```

---

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1** | **Done** | MVP on Robinhood Testnet: ERC-4626 vault, MockSwapRouter, deposit/withdraw in ETH, frontend with CoinGecko pricing and pie chart. |
| **Phase 2** | Planned | Mainnet launch and security audit. Grant target **$5,000–$15,000** for audit and deployment. Replace MockSwapRouter with production DEX (e.g. Uniswap V3 or native Robinhood L2 DEX). |
| **Phase 3** | Future | Governance tokens and community-managed indices: vote on index composition and weights; optionally multiple vaults per strategy. |

---

## License

MIT.

---

*Built for the [Arbitrum & Robinhood Ecosystem Fund](https://arbitrum.foundation/). We are serious about DeFi, security, and bringing index-fund simplicity to Robinhood Chain.*
