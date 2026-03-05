"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { parseEther, formatEther, formatUnits } from "viem";
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { INDEX_VAULT_ABI } from "@/abis/IndexVault";
import { INDEX_VAULT_ADDRESS, INDEX_TOKEN_LABELS } from "@/config/contracts";

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, delay: i * 0.06 },
  }),
};
const buttonHover = { scale: 1.02 };
const buttonTap = { scale: 0.98 };

const COLORS = ["#6366f1", "#4f46e5", "#3b82f6", "#2563eb", "#06b6d4"];
// Order must match contract indexTokens: PLTR, AMD, NFLX, AMZN, TSLA
const TICKERS = ["PLTR", "AMD", "NFLX", "AMZN", "TSLA"] as const;
const INDEX_TOKEN_COUNT = 5;
const TARGET_WEIGHT_PCT = 20;
const BPS_TOTAL = 10_000;

/** Convert slider percentages (0–100) to basis points (0–10000). Sum is forced to exactly 10000 to avoid float errors. */
function toBpsArray(weights: number[]): number[] {
  const slice = weights.slice(0, INDEX_TOKEN_COUNT);
  while (slice.length < INDEX_TOKEN_COUNT) slice.push(0);
  const bps = slice.map((p) => Math.round(Number(p) * 100));
  const sum = bps.reduce((a, b) => a + b, 0);
  const diff = BPS_TOTAL - sum;
  if (diff !== 0) bps[0] = bps[0] + diff;
  return bps.slice(0, INDEX_TOKEN_COUNT);
}

/** Sum of weights as BPS (for strict 100% check). */
function bpsSum(weights: number[]): number {
  return weights
    .slice(0, INDEX_TOKEN_COUNT)
    .reduce((a, b) => a + Math.round(Number(b) * 100), 0);
}
const RIDX_DECIMALS = 18;
const COINGECKO_ETH_URL = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";
const ETH_PRICE_POLL_MS = 30_000;
const EXPLORER_TX_URL = "https://explorer.testnet.chain.robinhood.com/tx";

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

  const { data: safeModeActive } = useReadContract({
    address: INDEX_VAULT_ADDRESS,
    abi: INDEX_VAULT_ABI,
    functionName: "safeModeActive",
  });
  const { data: emergencyThresholdBps } = useReadContract({
    address: INDEX_VAULT_ADDRESS,
    abi: INDEX_VAULT_ABI,
    functionName: "emergencyThresholdBps",
  });
  const { data: totalAssetsAtSnapshot } = useReadContract({
    address: INDEX_VAULT_ADDRESS,
    abi: INDEX_VAULT_ABI,
    functionName: "totalAssetsAtSnapshot",
  });
  const { data: snapshotTimestamp } = useReadContract({
    address: INDEX_VAULT_ADDRESS,
    abi: INDEX_VAULT_ABI,
    functionName: "snapshotTimestamp",
  });
  const { data: vaultOwner } = useReadContract({
    address: INDEX_VAULT_ADDRESS,
    abi: INDEX_VAULT_ABI,
    functionName: "getOwner",
  });
  const { data: weightsBps } = useReadContract({
    address: INDEX_VAULT_ADDRESS,
    abi: INDEX_VAULT_ABI,
    functionName: "getWeightsBps",
  });
  const { data: userWeights, refetch: refetchUserWeights } = useReadContract({
    address: INDEX_VAULT_ADDRESS,
    abi: INDEX_VAULT_ABI,
    functionName: "getUserWeights",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && INDEX_VAULT_ADDRESS) },
  });

  const [emergencyThresholdInput, setEmergencyThresholdInput] = useState("");
  const [customWeights, setCustomWeights] = useState<number[]>([20, 20, 20, 20, 20]);
  const [showDevDetails, setShowDevDetails] = useState(false);
  const [managerView, setManagerView] = useState(false);

  const { writeContract, data: hash, isPending, isError: isWriteError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, isError: isTxError } = useWaitForTransactionReceipt({ hash: hash ?? undefined });
  const loadingToastIdRef = useRef<string | number | null>(null);
  const resultShownForHashRef = useRef<string | "error" | null>(null);

  useEffect(() => {
    if (!isPending) return;
    resultShownForHashRef.current = null;
    const id = toast.loading("Transaction submitted…");
    loadingToastIdRef.current = id;
  }, [isPending]);

  useEffect(() => {
    if (!isSuccess || !hash) return;
    if (resultShownForHashRef.current === hash) return;
    resultShownForHashRef.current = hash;
    const loadingId = loadingToastIdRef.current;
    loadingToastIdRef.current = null;
    if (loadingId != null) toast.dismiss(loadingId);
    const link = `${EXPLORER_TX_URL}/${hash}`;
    toast.success("Transaction Successful!", {
      duration: 5000,
      description: (
        <a href={link} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block underline hover:opacity-90">
          View in Explorer
        </a>
      ),
    });
  }, [isSuccess, hash]);

  useEffect(() => {
    if (!isTxError && !isWriteError) return;
    const key = hash ?? "error";
    if (resultShownForHashRef.current === key) return;
    resultShownForHashRef.current = key;
    const loadingId = loadingToastIdRef.current;
    loadingToastIdRef.current = null;
    if (loadingId != null) toast.dismiss(loadingId);
    const link = hash ? `${EXPLORER_TX_URL}/${hash}` : null;
    toast.error("Transaction Failed", {
      duration: 5000,
      description: link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block underline hover:opacity-90">
          View in Explorer
        </a>
      ) : undefined,
    });
  }, [isTxError, isWriteError, hash]);

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
      refetchUserShares();
      refetchTotalSupply();
      refetchIndexBalances();
      refetchUserWeights();
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
  }, [isSuccess, queryClient, refetchTotalAssets, refetchUserShares, refetchTotalSupply, refetchIndexBalances, refetchUserWeights]);

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
  const isInvestValid = investAmountWei !== null && investAmountWei > BigInt(0);

  const withdrawSharesWei = safeParseEther(withdrawAmount);
  const userSharesBn = userShares ?? BigInt(0);
  const isWithdrawValid =
    withdrawSharesWei !== null &&
    withdrawSharesWei > BigInt(0) &&
    withdrawSharesWei <= userSharesBn;

  const hasVaultAddress = Boolean(INDEX_VAULT_ADDRESS);

  const handleInvest = () => {
    if (!INDEX_VAULT_ADDRESS) return;
    if (!isInvestValid || investAmountWei === null) return;
    writeContract({
      address: INDEX_VAULT_ADDRESS,
      abi: INDEX_VAULT_ABI,
      functionName: "depositEth",
      args: [BigInt(0)], // minSharesOut: 0 = no slippage protection; set higher to require minimum shares
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

  const globalWeightsArray: number[] = weightsBps
    ? (Array.from((weightsBps as unknown) as readonly bigint[]).map((x) => Number(x)) as number[])
    : [2000, 2000, 2000, 2000, 2000];
  const handleRebalance = () => {
    if (!INDEX_VAULT_ADDRESS) return;
    writeContract({
      address: INDEX_VAULT_ADDRESS,
      abi: INDEX_VAULT_ABI,
      functionName: "rebalance",
      args: [globalWeightsArray],
    });
  };
  const handleHarvest = () => {
    if (!INDEX_VAULT_ADDRESS) return;
    writeContract({
      address: INDEX_VAULT_ADDRESS,
      abi: INDEX_VAULT_ABI,
      functionName: "harvestAndReinvest",
    });
  };
  const handleSetEmergencyThreshold = () => {
    const bps = Math.round(Number(emergencyThresholdInput) * 100);
    if (!INDEX_VAULT_ADDRESS || Number.isNaN(bps) || bps < 0 || bps > 10000) return;
    writeContract({
      address: INDEX_VAULT_ADDRESS,
      abi: INDEX_VAULT_ABI,
      functionName: "setEmergencyThreshold",
      args: [BigInt(bps)],
    });
    setEmergencyThresholdInput("");
  };
  const handleRecordSnapshot = () => {
    if (!INDEX_VAULT_ADDRESS) return;
    writeContract({
      address: INDEX_VAULT_ADDRESS,
      abi: INDEX_VAULT_ABI,
      functionName: "recordSnapshot",
    });
  };
  const handleCheckAndTriggerSafeMode = () => {
    if (!INDEX_VAULT_ADDRESS) return;
    writeContract({
      address: INDEX_VAULT_ADDRESS,
      abi: INDEX_VAULT_ABI,
      functionName: "checkAndTriggerSafeMode",
    });
  };
  const handleForceTriggerSafeMode = () => {
    if (!INDEX_VAULT_ADDRESS) return;
    writeContract({
      address: INDEX_VAULT_ADDRESS,
      abi: INDEX_VAULT_ABI,
      functionName: "forceTriggerSafeMode",
    });
  };
  const isOwner = Boolean(address && vaultOwner && address.toLowerCase() === (vaultOwner as string).toLowerCase());
  const showAdminTools = isOwner && managerView;
  const handleExitSafeMode = (reinvestIntoIndex: boolean) => {
    if (!INDEX_VAULT_ADDRESS) return;
    writeContract({
      address: INDEX_VAULT_ADDRESS,
      abi: INDEX_VAULT_ABI,
      functionName: "exitSafeMode",
      args: [reinvestIntoIndex],
    });
  };
  const customWeightsBpsSum = bpsSum(customWeights);
  const isCustomSumExactly100 = customWeightsBpsSum === BPS_TOTAL;

  const handleSetUserIndex = () => {
    if (!INDEX_VAULT_ADDRESS || !isCustomSumExactly100) return;
    const bps = toBpsArray(customWeights);
    if (bps.length !== INDEX_TOKEN_COUNT) return;
    const bpsSumCheck = bps.reduce((a, b) => a + b, 0);
    if (bpsSumCheck !== BPS_TOTAL) return;
    writeContract({
      address: INDEX_VAULT_ADDRESS,
      abi: INDEX_VAULT_ABI,
      functionName: "setUserIndex",
      args: [bps],
    });
  };
  const cloneGlobalWeights = () => {
    const w = weightsBps && Array.isArray(weightsBps)
      ? (Array.from((weightsBps as unknown) as readonly bigint[]).map((x) => Number(x) / 100) as number[])
      : [20, 20, 20, 20, 20];
    setCustomWeights(w.slice(0, INDEX_TOKEN_COUNT).length === INDEX_TOKEN_COUNT ? w : [20, 20, 20, 20, 20]);
  };
  useEffect(() => {
    if (userWeights && Array.isArray(userWeights) && (userWeights as unknown[]).length === INDEX_TOKEN_COUNT) {
      const w = (Array.from((userWeights as unknown) as readonly bigint[]).map((x) => Number(x) / 100) as number[]).slice(0, INDEX_TOKEN_COUNT);
      setCustomWeights(w.length === INDEX_TOKEN_COUNT ? w : [20, 20, 20, 20, 20]);
    }
  }, [userWeights]);
  const updateCustomWeight = (index: number, value: number) => {
    setCustomWeights((prev) => {
      const next = [...prev];
      next[index] = Math.max(0, Math.min(100, value));
      return next;
    });
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-[#020617]">
      <header className="shrink-0 border-b border-white/10 bg-black/20 backdrop-blur-[40px]">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-4">
          <span className="bg-gradient-to-r from-slate-300 via-slate-100 to-white bg-clip-text text-xl font-semibold tracking-tight text-transparent">
            Robinhood Index Vault
          </span>
          <div className="flex items-center gap-4">
            {isConnected && isOwner && (
              <label className="text-pop flex cursor-pointer select-none items-center gap-2 text-xs uppercase tracking-wider text-[#e2e8f0]">
                <span className="relative inline-flex h-6 w-10 shrink-0 cursor-pointer rounded-full border border-white/15 bg-white/10">
                  <input type="checkbox" checked={managerView} onChange={(e) => setManagerView(e.target.checked)} className="peer sr-only" />
                  <span className="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full border border-white/20 bg-white/90 shadow transition-transform peer-checked:translate-x-4" aria-hidden />
                </span>
                <span>Manager</span>
              </label>
            )}
            <div className="connect-wallet-wrapper">
              <ConnectButton />
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-0 flex flex-1 flex-col overflow-visible">
        <div className="content-glow mx-auto w-full max-w-[1200px] px-4 py-6 pb-20">
          {!isConnected ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel text-pop flex min-h-[60vh] items-center justify-center rounded-2xl p-12 text-center">
              <div>
                <p className="mb-4 text-base text-[#f8fafc]">Connect your wallet to view the vault and invest.</p>
                <div className="connect-wallet-wrapper">
                  <ConnectButton />
                </div>
              </div>
            </motion.div>
          ) : (
            <>
              {/* Portfolio Hero — large elegant panel */}
              <section className="glass-panel text-pop mb-6 min-h-[120px] rounded-2xl p-8">
                <div className="flex flex-wrap items-end justify-between gap-6">
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wider text-[#94a3b8]">Vault Balance</p>
                    <p className="font-mono text-2xl font-semibold tabular-nums text-white md:text-3xl">{totalAssetsNum.toFixed(4)} ETH</p>
                    {address && (
                      <p className="mt-2 text-sm text-[#94a3b8]">
                        Your shares: <span className="font-mono text-white tabular-nums">{userSharesNum.toFixed(4)} rIDX</span>
                        {userEstValueUsd != null && <span className="ml-2">Est. <span className="font-mono tabular-nums">${userEstValueUsd.toFixed(2)}</span></span>}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="mb-1 text-xs uppercase tracking-wider text-[#94a3b8]">Total Portfolio Value</p>
                    <p className="font-mono text-2xl font-semibold tabular-nums text-white md:text-3xl">
                      {portfolioValueUsd != null ? `$${portfolioValueUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                    </p>
                    <p className="mt-1 text-xs text-[#64748b]">1 ETH = {pricePerEth != null ? `$${pricePerEth.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}{hash && <a href={`${EXPLORER_TX_URL}/${hash}`} target="_blank" rel="noopener noreferrer" className="ml-2 font-sans underline hover:text-[#94a3b8]">TX</a>}</p>
                  </div>
                </div>
              </section>

              {safeModeActive && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-pop mb-6 rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 backdrop-blur-[40px]" role="alert">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <p className="font-medium">SAFE MODE ACTIVE — Assets protected in WETH.</p>
                    <div className="flex gap-2">
                      <motion.button whileHover={buttonHover} whileTap={buttonTap} onClick={() => handleExitSafeMode(false)} disabled={isPending || isConfirming || !hasVaultAddress || !isOwner} className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] disabled:opacity-50">Exit</motion.button>
                      <motion.button whileHover={buttonHover} whileTap={buttonTap} onClick={() => handleExitSafeMode(true)} disabled={isPending || isConfirming || !hasVaultAddress || !isOwner} className="rounded-xl border border-red-400 px-4 py-2 text-sm text-red-400 disabled:opacity-50">Exit &amp; reinvest</motion.button>
                    </div>
                  </div>
                  {!isOwner && address && <p className="mt-2 text-sm text-red-300/90">Owner wallet required to exit.</p>}
                </motion.div>
              )}

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Left: Index Composition + Custom Index */}
                <div className="flex flex-col gap-6">
                  <section className="glass-panel text-pop min-h-[320px] w-full rounded-2xl p-8">
                    <h2 className="text-silver-gradient mb-1 text-sm font-semibold uppercase tracking-wider">Index Composition</h2>
                    <p className="mb-6 text-xs leading-snug text-[#94a3b8]">Real-time breakdown of underlying high-growth tech assets.</p>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-8 sm:flex-nowrap sm:justify-start lg:gap-10">
                      <div className="h-44 w-44 shrink-0 sm:h-48 sm:w-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={44}
                              outerRadius={62}
                              paddingAngle={2}
                              dataKey="value"
                              isAnimationActive
                              label={false}
                              labelLine={false}
                            >
                              {pieData.map((_, i) => <Cell key={TICKERS[i]} fill={COLORS[i % COLORS.length]} />)}
                            </Pie>
                            <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ background: "rgba(15,15,20,0.95)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", color: "#fff" }} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#e2e8f0" }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <ul className="flex flex-col gap-3.5" role="list">
                        {TICKERS.map((ticker) => (
                          <li key={ticker} className="flex items-center gap-4">
                            <span className="relative flex h-8 w-8 shrink-0 overflow-hidden rounded-lg">
                              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-indigo-950 text-sm font-bold text-white" aria-hidden role="img">
                                {ticker[0]}
                              </div>
                              <img
                                src={`/logos/${ticker.toUpperCase()}.png`}
                                alt=""
                                width={32}
                                height={32}
                                className="relative h-8 w-8 object-contain rounded-lg"
                                onError={(e) => { e.currentTarget.style.display = "none"; }}
                              />
                            </span>
                            <span className="text-silver-gradient min-w-[4rem] text-sm font-medium">{ticker}</span>
                            <span className="font-mono w-10 text-right text-sm tabular-nums text-white">{TARGET_WEIGHT_PCT}%</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </section>

                  <section className="glass-panel text-pop min-h-[280px] rounded-2xl p-8">
                    <h2 className="mb-1 text-sm font-semibold tracking-tight text-[#f8fafc]">Custom index</h2>
                    <p className="mb-6 text-xs leading-snug text-[#94a3b8]">Personalize your portfolio weights. Strategy is applied on your next deposit.</p>
                    <div className="mb-6 flex items-center justify-between gap-4">
                      <div className="flex gap-2">
                        <motion.button type="button" whileHover={buttonHover} whileTap={buttonTap} onClick={cloneGlobalWeights} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-[#f8fafc] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-white/10">Clone global</motion.button>
                        <motion.button type="button" whileHover={buttonHover} whileTap={buttonTap} onClick={handleSetUserIndex} disabled={isPending || isConfirming || !isCustomSumExactly100 || !hasVaultAddress} className="btn-emerald rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save my index</motion.button>
                      </div>
                      <span className={`font-mono text-sm font-semibold tabular-nums ${isCustomSumExactly100 ? "text-emerald-400" : "text-amber-400"}`}>{isCustomSumExactly100 ? "100%" : `${customWeightsBpsSum / 100}%`}</span>
                    </div>
                    <div className="space-y-4">
                      {TICKERS.map((ticker, i) => (
                        <div key={ticker} className="flex items-center gap-4">
                          <span className="relative flex h-8 w-8 shrink-0 overflow-hidden rounded-lg">
                            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-indigo-950 text-sm font-bold text-white" aria-hidden role="img">
                              {ticker[0]}
                            </div>
                            <img
                              src={`/logos/${ticker.toUpperCase()}.png`}
                              alt=""
                              width={32}
                              height={32}
                              className="relative h-8 w-8 object-contain rounded-lg"
                              onError={(e) => { e.currentTarget.style.display = "none"; }}
                            />
                          </span>
                          <span className="text-pop w-12 text-sm text-[#f8fafc]">{ticker}</span>
                          <input type="range" min={0} max={100} value={customWeights[i] ?? 20} onChange={(e) => updateCustomWeight(i, Number(e.target.value))} className="h-2 flex-1 accent-indigo-500" />
                          <span className="text-pop w-12 text-right font-mono text-sm tabular-nums text-white">{Math.round(customWeights[i] ?? 20)}%</span>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                {/* Right: Invest, Rebalancing, Stop-Loss */}
                <div className="flex flex-col gap-6">
                  <section className="glass-panel text-pop min-h-[200px] rounded-2xl p-8">
                    <h2 className="mb-1 text-sm font-semibold tracking-tight text-[#f8fafc]">Invest &amp; Withdraw</h2>
                    <p className="mb-6 text-xs leading-snug text-[#94a3b8]">Deposit ETH or withdraw rIDX shares to receive ETH back.</p>
                    <div className="flex flex-wrap items-end gap-4">
                      <div>
                        <label className="text-pop mb-2 block text-xs text-[#f8fafc]">Amount (ETH)</label>
                        <input type="text" placeholder="0.0" value={investAmount} onChange={(e) => setInvestAmount(normalizeAmountInput(e.target.value))} className="font-mono w-32 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-base tabular-nums text-white placeholder:text-[#64748b] focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
                      </div>
                      <motion.button whileHover={buttonHover} whileTap={buttonTap} onClick={handleInvest} disabled={isPending || isConfirming || !isInvestValid || !hasVaultAddress} className="btn-emerald rounded-xl bg-emerald-500 px-6 py-3 text-base font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] disabled:opacity-50">Invest</motion.button>
                      <div className="border-l border-white/10 pl-4">
                        <label className="text-pop mb-2 block text-xs text-[#f8fafc]">Amount (rIDX)</label>
                        <div className="flex gap-2">
                          <input type="text" placeholder="0.0" value={withdrawAmount} onChange={(e) => setWithdrawAmount(normalizeAmountInput(e.target.value))} className="font-mono w-32 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-base tabular-nums text-white placeholder:text-[#64748b] focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
                          <motion.button type="button" whileHover={buttonHover} whileTap={buttonTap} onClick={setWithdrawMax} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-[#f8fafc] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-white/10">Max</motion.button>
                        </div>
                      </div>
                      <motion.button whileHover={buttonHover} whileTap={buttonTap} onClick={handleWithdraw} disabled={isPending || isConfirming || !isWithdrawValid || !hasVaultAddress} className="btn-emerald rounded-xl border-2 border-emerald-500/60 bg-transparent px-6 py-3 text-base font-semibold text-emerald-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] disabled:opacity-50">Withdraw</motion.button>
                    </div>
                    {!hasVaultAddress && <p className="mt-4 text-sm text-amber-400" role="alert">Set NEXT_PUBLIC_INDEX_VAULT_ADDRESS</p>}
                  </section>

                  <section className="glass-panel text-pop min-h-[140px] rounded-2xl p-8">
                    <h2 className="mb-1 text-sm font-semibold tracking-tight text-[#f8fafc]">Rebalancing</h2>
                    <p className="mb-6 text-xs leading-snug text-[#94a3b8]">Align portfolio to target weights. Rebalance sells to WETH and re-swaps.</p>
                    <div className="flex flex-wrap gap-3">
                      {showAdminTools && (
                        <motion.button whileHover={buttonHover} whileTap={buttonTap} onClick={handleHarvest} disabled={isPending || isConfirming || !hasVaultAddress || !!safeModeActive} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-[#f8fafc] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-white/10 disabled:opacity-50">Harvest &amp; Reinvest</motion.button>
                      )}
                      <motion.button whileHover={buttonHover} whileTap={buttonTap} onClick={handleRebalance} disabled={isPending || isConfirming || !hasVaultAddress || !!safeModeActive} className="btn-emerald rounded-xl border border-emerald-500/60 bg-emerald-500/10 px-6 py-3 text-base font-semibold text-emerald-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-emerald-500/20 disabled:opacity-50">Rebalance index</motion.button>
                    </div>
                  </section>

                  <section className="glass-panel text-pop min-h-[160px] rounded-2xl p-8">
                    <h2 className="mb-1 text-sm font-semibold tracking-tight text-[#f8fafc]">Stop-Loss</h2>
                    <p className="mb-6 text-xs leading-snug text-[#94a3b8]">Institutional-grade capital protection. Assets liquidate to WETH if the threshold is breached.</p>
                    {!showAdminTools && (
                      <div className="flex flex-wrap items-center gap-4">
                        {emergencyThresholdBps != null && emergencyThresholdBps > BigInt(0) && <span className="font-mono text-sm tabular-nums text-[#e2e8f0]">Current threshold: {Number(emergencyThresholdBps) / 100}%</span>}
                        <motion.button whileHover={buttonHover} whileTap={buttonTap} onClick={handleCheckAndTriggerSafeMode} disabled={isPending || isConfirming || !hasVaultAddress || !!safeModeActive} className="btn-amber rounded-xl border border-amber-500/60 px-6 py-3 text-base font-semibold text-amber-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-amber-500/10 disabled:opacity-50">Check &amp; trigger Safe Mode</motion.button>
                      </div>
                    )}
                    {showAdminTools && (
                      <>
                        <div className="mb-4 flex flex-wrap items-end gap-3">
                          <div>
                            <label className="text-pop mb-2 block text-xs text-[#f8fafc]">Threshold (%)</label>
                            <input type="text" placeholder={emergencyThresholdBps != null ? String(Number(emergencyThresholdBps) / 100) : "10"} value={emergencyThresholdInput} onChange={(e) => setEmergencyThresholdInput(e.target.value.replace(/[^0-9.]/g, ""))} className="font-mono w-20 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm tabular-nums text-white focus:border-emerald-500/50 focus:outline-none" />
                          </div>
                          <motion.button whileHover={buttonHover} whileTap={buttonTap} onClick={handleSetEmergencyThreshold} disabled={isPending || isConfirming || !hasVaultAddress} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-[#f8fafc] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-white/10 disabled:opacity-50">Set threshold</motion.button>
                          <motion.button whileHover={buttonHover} whileTap={buttonTap} onClick={handleRecordSnapshot} disabled={isPending || isConfirming || !hasVaultAddress} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-[#f8fafc] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-white/10 disabled:opacity-50">Record snapshot</motion.button>
                          <motion.button whileHover={buttonHover} whileTap={buttonTap} onClick={handleCheckAndTriggerSafeMode} disabled={isPending || isConfirming || !hasVaultAddress || !!safeModeActive} className="btn-amber rounded-xl border border-amber-500/60 px-4 py-2 text-sm font-semibold text-amber-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-amber-500/10 disabled:opacity-50">Check Safe Mode</motion.button>
                          <motion.button whileHover={buttonHover} whileTap={buttonTap} onClick={handleForceTriggerSafeMode} disabled={isPending || isConfirming || !hasVaultAddress || !!safeModeActive} className="rounded-xl border border-red-500/60 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50">Force Safe Mode</motion.button>
                        </div>
                        {emergencyThresholdBps != null && emergencyThresholdBps > BigInt(0) && <p className="font-mono text-sm tabular-nums text-[#e2e8f0]">Current threshold: {Number(emergencyThresholdBps) / 100}%</p>}
                      </>
                    )}
                  </section>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      <footer className="shrink-0 border-t border-white/10 py-4">
        <div className="mx-auto max-w-[1200px] px-4 text-center">
          <button type="button" onClick={() => setShowDevDetails((d) => !d)} className="text-xs text-[#737373] underline hover:text-[#a3a3a3]">{showDevDetails ? "Hide" : "Show"} Dev Details</button>
          {showDevDetails && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-pop mt-3 rounded-xl border border-white/10 bg-black/20 p-4 text-left text-xs text-[#e2e8f0]">
              <p>BPS: {customWeightsBpsSum}</p>
              {snapshotTimestamp != null && snapshotTimestamp > BigInt(0) && <p>Snapshot: {totalAssetsAtSnapshot != null ? formatEther(totalAssetsAtSnapshot) : "—"} ETH</p>}
              {emergencyThresholdBps != null && <p>Threshold bps: {emergencyThresholdBps.toString()}</p>}
              {vaultOwner && <p>Owner: {(vaultOwner as string).slice(0, 10)}…</p>}
              {INDEX_VAULT_ADDRESS && <p>Contract: {INDEX_VAULT_ADDRESS.slice(0, 14)}…</p>}
            </motion.div>
          )}
          <p className="text-pop mt-3 text-sm text-[#e2e8f0]">Robinhood Chain Testnet 2026</p>
        </div>
      </footer>
    </div>
  );
}
