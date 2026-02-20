"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { parseEther, formatEther, formatUnits } from "viem";
import { useState, useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { INDEX_VAULT_ABI } from "@/abis/IndexVault";
import { INDEX_VAULT_ADDRESS, INDEX_TOKEN_LABELS } from "@/config/contracts";

const COLORS = ["#00C805", "#00A804", "#006B03", "#004D02", "#003301"];
const TICKERS = ["PLTR", "AMD", "NFLX", "AMZN", "TSLA"];
const TARGET_WEIGHT_PCT = 20;
const RIDX_DECIMALS = 18;
const COINGECKO_ETH_URL = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";
const ETH_PRICE_POLL_MS = 30_000;

function normalizeAmountInput(value: string): string {
  if (value.startsWith(".")) return "0" + value;
  return value;
}

function safeParseEther(value: string): bigint | null {
  if (!value || value.trim() === "") return null;
  const normalized = normalizeAmountInput(value.trim());
  try {
    const wei = parseEther(normalized);
    return wei;
  } catch {
    return null;
  }
}

async function fetchEthPrice(): Promise<number | null> {
  try {
    const res = await fetch(COINGECKO_ETH_URL);
    const data = await res.json();
    const price = data?.ethereum?.usd;
    return typeof price === "number" ? price : null;
  } catch {
    return null;
  }
}

export default function Home() {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const [investAmount, setInvestAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [ethPriceUsd, setEthPriceUsd] = useState<number | null>(null);

  const { data: totalAssets, refetch: refetchTotalAssets } = useReadContract({
    address: INDEX_VAULT_ADDRESS,
    abi: INDEX_VAULT_ABI,
    functionName: "totalAssets",
  });

  const { data: indexTokens } = useReadContract({
    address: INDEX_VAULT_ADDRESS,
    abi: INDEX_VAULT_ABI,
    functionName: "getIndexTokens",
  });

  const { data: indexBalances, refetch: refetchIndexBalances } = useReadContract({
    address: INDEX_VAULT_ADDRESS,
    abi: INDEX_VAULT_ABI,
    functionName: "getIndexBalances",
  });

  const { data: userShares, refetch: refetchUserShares } = useReadContract({
    address: INDEX_VAULT_ADDRESS,
    abi: INDEX_VAULT_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      refetchInterval: 3000,
      enabled: Boolean(address && INDEX_VAULT_ADDRESS),
    },
  });

  const { data: totalSupply, refetch: refetchTotalSupply } = useReadContract({
    address: INDEX_VAULT_ADDRESS,
    abi: INDEX_VAULT_ABI,
    functionName: "totalSupply",
  });

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: hash ?? undefined });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const price = await fetchEthPrice();
      if (!cancelled && price != null) setEthPriceUsd(price);
    };
    load();
    const interval = setInterval(load, ETH_PRICE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!isSuccess) return;
    setInvestAmount("");
    setWithdrawAmount("");
    const refetchAll = () => {
      refetchTotalAssets();
      refetchUserShares(); // rIDX (balanceOf) for current user
      refetchTotalSupply();
      refetchIndexBalances();
    };
    queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string) === "readContract" });
    refetchAll();
    const t1 = setTimeout(refetchAll, 800);
    const t2 = setTimeout(refetchAll, 2500);
    const t3 = setTimeout(refetchAll, 5000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [isSuccess, queryClient, refetchTotalAssets, refetchUserShares, refetchTotalSupply, refetchIndexBalances]);

  const pieData = TICKERS.map((ticker) => ({
    name: ticker,
    value: TARGET_WEIGHT_PCT,
  }));

  const totalAssetsStr = totalAssets != null ? formatEther(totalAssets) : "0";
  const userSharesStr = userShares != null ? formatUnits(userShares, RIDX_DECIMALS) : "0";
  const totalSupplyStr = totalSupply != null ? formatEther(totalSupply) : "0";

  const totalAssetsNum = Number(totalAssetsStr);
  const userSharesNum = Number(userSharesStr);
  const totalSupplyNum = Number(totalSupplyStr);

  const pricePerEth = ethPriceUsd;
  const portfolioValueUsd = pricePerEth != null ? totalAssetsNum * pricePerEth : null;
  const userEstValueUsd =
    pricePerEth != null && totalSupplyNum > 0
      ? (userSharesNum / totalSupplyNum) * totalAssetsNum * pricePerEth
      : null;

  const investAmountWei = safeParseEther(investAmount);
  const isInvestValid = investAmountWei !== null && investAmountWei > 0n;

  const withdrawSharesWei = safeParseEther(withdrawAmount);
  const userSharesBn = userShares ?? 0n;
  const isWithdrawValid =
    withdrawSharesWei !== null &&
    withdrawSharesWei > 0n &&
    withdrawSharesWei <= userSharesBn;

  const hasVaultAddress = Boolean(INDEX_VAULT_ADDRESS);

  const handleInvest = () => {
    console.log("Index vault contract address:", INDEX_VAULT_ADDRESS ?? "undefined");
    if (!INDEX_VAULT_ADDRESS) return;
    if (!isInvestValid || investAmountWei === null) return;
    writeContract({
      address: INDEX_VAULT_ADDRESS,
      abi: INDEX_VAULT_ABI,
      functionName: "depositEth",
      args: [0n], // minSharesOut: 0 = no slippage protection; set higher to require minimum shares
      value: investAmountWei,
    });
  };

  const handleWithdraw = () => {
    if (!INDEX_VAULT_ADDRESS || !isWithdrawValid || withdrawSharesWei === null) return;
    writeContract({
      address: INDEX_VAULT_ADDRESS,
      abi: INDEX_VAULT_ABI,
      functionName: "withdraw",
      args: [withdrawSharesWei],
    });
  };

  const setWithdrawMax = () => setWithdrawAmount(userSharesStr);

  return (
    <div className="relative flex min-h-screen flex-col">
      <header className="border-b border-[#333] bg-[#0a0a0a]/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-[#e5e5e5]">Robinhood</span>
            <span className="rounded bg-[#00C805] px-2 py-0.5 text-xs font-medium text-black">
              Index Vault
            </span>
          </div>
          <ConnectButton />
        </div>
      </header>

      <main className="relative z-0 mx-auto max-w-6xl px-4 py-8">
        {!isConnected ? (
          <div className="rounded-2xl border border-[#333] bg-[#1a1a1a] p-12 text-center">
            <p className="mb-4 text-[#a3a3a3]">Connect your wallet to view the vault and invest.</p>
            <ConnectButton />
          </div>
        ) : (
          <>
            <div className="mb-8 grid gap-6 sm:grid-cols-2">
              <section className="rounded-2xl border border-[#333] bg-[#1a1a1a] p-6 shadow-lg shadow-black/20">
                <h2 className="mb-2 text-sm font-medium text-[#a3a3a3]">Vault balance</h2>
                <p className="text-3xl font-bold text-[#00C805]">
                  {totalAssetsNum.toFixed(4)} ETH
                </p>
                {address && (
                  <p className="mt-2 text-sm text-[#a3a3a3]">
                    Your shares: <span className="text-[#e5e5e5]">{userSharesNum.toFixed(6)} rIDX</span>
                  </p>
                )}
                {address && (
                  <p className="mt-1 text-xs text-[#737373]">
                    Est. value: {userEstValueUsd != null ? `$${userEstValueUsd.toFixed(2)}` : "—"} <span className="text-[#525252]">(your shares × ETH price)</span>
                  </p>
                )}
              </section>
              <section className="rounded-2xl border border-[#333] bg-[#1a1a1a] p-6 shadow-lg shadow-black/20">
                <h2 className="mb-2 text-sm font-medium text-[#a3a3a3]">Total Portfolio Value</h2>
                <p className="text-3xl font-bold text-[#00C805]">
                  {portfolioValueUsd != null
                    ? `$${portfolioValueUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : "—"}
                </p>
                <p className="mt-2 text-xs text-[#737373]">
                  1 ETH = {pricePerEth != null ? `$${pricePerEth.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
                </p>
              </section>
            </div>

            <section className="mb-8 rounded-2xl border border-[#333] bg-[#1a1a1a] p-6 shadow-lg shadow-black/20">
              <h2 className="mb-4 text-sm font-medium text-[#a3a3a3]">Index composition</h2>
              <p className="mb-4 text-xs text-[#737373]">Target allocation: 20% each — PLTR, AMD, NFLX, AMZN, TSLA</p>
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center">
                <div className="flex h-full w-full max-w-md flex-col items-center justify-center">
                  <div className="h-56 w-56 shrink-0 sm:h-64 sm:w-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={44}
                          outerRadius={72}
                          paddingAngle={2}
                          dataKey="value"
                          isAnimationActive={true}
                        >
                          {pieData.map((_, index) => (
                            <Cell key={TICKERS[index]} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number) => `${value}%`}
                          contentStyle={{
                            backgroundColor: "#1a1a1a",
                            border: "1px solid #333",
                            borderRadius: "8px",
                            color: "#fff",
                          }}
                          labelStyle={{ color: "#fff" }}
                          itemStyle={{ color: "#fff" }}
                        />
                        <Legend
                          layout="horizontal"
                          verticalAlign="bottom"
                          align="center"
                          wrapperStyle={{ paddingTop: "12px" }}
                          formatter={(value) => <span style={{ color: "#fff" }}>{value}</span>}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-[#333] bg-[#1a1a1a] p-6 shadow-lg shadow-black/20">
              <h2 className="mb-4 text-sm font-medium text-[#a3a3a3]">Invest & Withdraw</h2>
              <p className="mb-4 text-sm text-[#737373]">
                Deposit ETH or withdraw your rIDX shares to receive ETH back (index is sold via router, WETH unwrapped to ETH).
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[#a3a3a3]">Amount (ETH)</label>
                  <input
                    type="text"
                    placeholder="0.0"
                    value={investAmount}
                    onChange={(e) => setInvestAmount(normalizeAmountInput(e.target.value))}
                    className="w-40 rounded-lg border border-[#333] bg-[#0a0a0a] px-3 py-2 text-[#e5e5e5] placeholder:text-[#525252] focus:border-[#00C805] focus:outline-none focus:ring-1 focus:ring-[#00C805]"
                  />
                </div>
                <button
                  onClick={handleInvest}
                  disabled={isPending || isConfirming || !isInvestValid || !hasVaultAddress}
                  title={!hasVaultAddress ? "Contract address not found" : undefined}
                  className="rounded-lg bg-[#00C805] px-5 py-2 font-semibold text-black transition hover:bg-[#00E606] disabled:opacity-50 disabled:hover:bg-[#00C805]"
                >
                  Invest
                </button>
                <div className="ml-2 border-l border-[#333] pl-4">
                  <label className="mb-1 block text-xs text-[#a3a3a3]">Amount (rIDX)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="0.0"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(normalizeAmountInput(e.target.value))}
                      className="w-40 rounded-lg border border-[#333] bg-[#0a0a0a] px-3 py-2 text-[#e5e5e5] placeholder:text-[#525252] focus:border-[#00C805] focus:outline-none focus:ring-1 focus:ring-[#00C805]"
                    />
                    <button
                      type="button"
                      onClick={setWithdrawMax}
                      className="rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-2 text-xs font-medium text-[#a3a3a3] hover:bg-[#262626]"
                    >
                      Max
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleWithdraw}
                  disabled={isPending || isConfirming || !isWithdrawValid || !hasVaultAddress}
                  title={!hasVaultAddress ? "Contract address not found" : undefined}
                  className="rounded-lg border-2 border-[#00C805] bg-transparent px-5 py-2 font-semibold text-[#00C805] transition hover:bg-[#00C805]/10 disabled:opacity-50"
                >
                  Withdraw
                </button>
              </div>
              {!hasVaultAddress && (
                <p className="mt-3 text-sm text-amber-400" role="alert">
                  Contract address not found. Set NEXT_PUBLIC_INDEX_VAULT_ADDRESS in .env.local and restart the dev server.
                </p>
              )}
              {isSuccess && hash && (
                <p className="mt-3 text-sm text-[#00C805]">
                  Success!{" "}
                  <a
                    href={`https://explorer.testnet.chain.robinhood.com/tx/${hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-[#00E606]"
                  >
                    View on explorer
                  </a>
                </p>
              )}
            </section>
          </>
        )}
      </main>
      <footer className="mt-auto border-t border-[#333] py-4 text-center text-sm text-[#737373]">
        Built for Robinhood Chain Testnet 2026
      </footer>
    </div>
  );
}
