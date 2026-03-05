# Grant Demo Video Script — Robinhood Index Vaults  
**Total runtime: ~2 minutes**

---

| **Visuals** | **Voiceover** |
|-------------|---------------|
| **INTRO (0:00–0:15)** | |
| Open the app in browser. Pan slowly across the dark-themed UI: connect button, vault name, deposit/withdraw sections. | "This is Robinhood Index Vaults — index investing for Robinhood L2. One interface. One basket. No manual swaps." |
| **ONE-CLICK INVESTMENT (0:15–0:45)** | |
| Click Connect Wallet, connect to Robinhood Testnet. Scroll to the deposit section. Type **0.001** in the ETH deposit field. | "I'll deposit zero point zero zero one ETH. Notice there's no need to pick tokens or hit a DEX." |
| Click Deposit. Approve in wallet. Wait for confirmation. Optionally show transaction in block explorer. | "One click — and the vault wraps my ETH to WETH and automatically swaps it into the index: PLTR, AMD, NFLX, AMZN, and TSLA, at equal weights. I just receive vault shares." |
| **TRANSPARENCY (0:45–1:05)** | |
| Point to the pie chart (Recharts) showing the five tokens and their share of the portfolio. Then point to the USD value display. | "Transparency is built in. The pie chart shows exactly how my deposit is allocated across the five tokens. The total value is pulled in real time from CoinGecko — so I always see my position in USD." |
| **SECURE EXIT (1:05–1:45)** | |
| Scroll to Withdraw. Click **Max** so the full balance is selected. Show the amount and the estimated ETH out. | "Exiting is just as simple. I hit Max to withdraw my full position." |
| Click Withdraw. Approve in wallet. Wait for confirmation. Show the wallet receiving ETH. | "Behind this one click, the vault sells my index tokens back to WETH, unwraps to ETH, and sends it to my wallet. We implemented rounding protection and safe ETH transfer logic in Solidity — so users never get stuck on dust or failed sends. The exit is smooth and secure." |
| **CONCLUSION (1:45–2:00)** | |
| Open GitHub repo in browser. Scroll to the **Roadmap** section in the README. | "The MVP is live on Robinhood Testnet and the repo is open. We're ready for a Phase 2 security audit and mainnet launch — and we're applying to the Arbitrum and Robinhood Ecosystem Fund to get there. Thank you." |
| Fade or end card with repo URL or project name. | — |

---

## Timing cheat sheet

| Section | Start | End | Duration |
|---------|-------|-----|----------|
| Intro | 0:00 | 0:15 | 15 s |
| One-Click Investment | 0:15 | 0:45 | 30 s |
| Transparency | 0:45 | 1:05 | 20 s |
| Secure Exit | 1:05 | 1:45 | 40 s |
| Conclusion | 1:45 | 2:00 | 15 s |
| **Total** | | | **2:00** |

---

## Tips

- **Before recording:** Have 0.001+ ETH on Robinhood Testnet and the vault already seeded so deposit and withdraw succeed in one take.
- **Pace:** Speak clearly; it’s fine to be slightly under 2 minutes.
- **Security line:** Emphasize “rounding protection” and “safe ETH transfer in Solidity” — grant reviewers care about this.
