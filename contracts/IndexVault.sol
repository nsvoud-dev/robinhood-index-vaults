// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/ISwapRouter.sol";
import "./interfaces/IWETH.sol";
import "./interfaces/IPriceOracle.sol";

/**
 * @title IndexVault
 * @notice ERC4626 Vault that accepts ETH, wraps to WETH, and swaps into a basket of "Stock Tokens" (index).
 * @dev Integrates with a Uniswap V3-style SwapRouter. Supports deposit, withdraw, rebalance, harvest, stop-loss, and custom user indices.
 */
contract IndexVault is ERC4626, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Constants ---
    /// @dev Robinhood Chain Testnet WETH (L2)
    address public constant WETH = 0x7943e237c7F95DA44E0301572D358911207852Fa;

    /// @dev Default Uniswap V3 fee tier (0.3%)
    uint24 public constant DEFAULT_FEE = 3000;

    /// @dev MockSwapRouter rate: 1 WETH = 100 Stock Tokens → token value in WETH = tokenBalance / 100
    uint256 public constant STOCK_PER_WETH = 100;

    /// @dev 24 hours in seconds for volatility snapshot
    uint256 public constant SNAPSHOT_WINDOW = 24 hours;

    // --- State ---
    ISwapRouter public immutable swapRouter;

    /// @dev Index token addresses (e.g. TSLA, AAPL, NVDA placeholders)
    address[] public indexTokens;

    /// @dev Target weights in basis points (10000 = 100%). Same order as indexTokens.
    uint16[] public weightsBps;

    /// @dev Pool fee for each token swap (index = indexTokens)
    uint24[] public feeTiers;

    /// @dev Optional price oracle for rebalancing (delta-based). If address(0), rebalance does full sell + re-swap.
    IPriceOracle public priceOracle;

    /// @dev Keeper allowed to call rebalance() and recordSnapshot(). If address(0), only owner.
    address public keeper;

    /// @dev Volatility protection: threshold in bps (e.g. 1000 = 10% drop triggers safe mode).
    uint256 public emergencyThresholdBps;

    /// @dev Snapshot of totalAssets for 24h comparison.
    uint256 public totalAssetsAtSnapshot;
    uint256 public snapshotTimestamp;

    /// @dev When true, vault has triggered Safe Exit (all index sold to WETH). Deposits still allowed (WETH only).
    bool public safeModeActive;

    /// @dev Custom index weights per user. If length 0 or not set, use global weightsBps.
    mapping(address => uint16[]) public userIndices;

    event IndexUpdated(address[] tokens, uint16[] weightsBps);
    event Rebalanced(uint256 wethSpent, uint256[] amountsOut);
    event VaultDeposit(address indexed user, uint256 assets, uint256 shares);
    event VaultWithdraw(address indexed user, uint256 shares, uint256 assetsOut);
    event VaultRebalance(uint256 timestamp);
    event HarvestAndReinvest(uint256 wethReinvested);
    event EmergencyThresholdSet(uint256 bps);
    event SnapshotRecorded(uint256 totalAssets, uint256 timestamp);
    event SafeModeTriggered(uint256 totalAssetsBefore);
    event UserIndexSet(address indexed user);
    event KeeperSet(address indexed keeper);
    event PriceOracleSet(address indexed oracle);

    error InvalidWeights();
    error InvalidLength();
    error OnlyWETH();
    error SwapFailed();
    error MinSharesNotMet(uint256 received, uint256 minimum);
    error SafeModeActive();
    error OnlyOwnerOrKeeper();

    /// @param _swapRouter Uniswap V3-style router. Owner is set to msg.sender (deployer); only owner can setEmergencyThreshold, setIndex, setKeeper, etc.
    constructor(
        address _asset,
        string memory _name,
        string memory _symbol,
        address _swapRouter
    ) ERC4626(IERC20(_asset)) ERC20(_name, _symbol) Ownable(msg.sender) {
        if (_asset != WETH) revert OnlyWETH();
        swapRouter = ISwapRouter(_swapRouter);

        // Index: PLTR, AMD, NFLX, AMZN, TSLA — 20% each
        indexTokens = [
            0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0, // PLTR
            0x71178BAc73cBeb415514eB542a8995b82669778d,  // AMD
            0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93,  // NFLX
            0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02,  // AMZN
            0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E   // TSLA
        ];
        weightsBps = [2000, 2000, 2000, 2000, 2000]; // 20% each
        feeTiers = [DEFAULT_FEE, DEFAULT_FEE, DEFAULT_FEE, DEFAULT_FEE, DEFAULT_FEE];
    }

    /// @notice Allow the vault to receive ETH (e.g. from WETH.withdraw when user withdraws).
    receive() external payable {}

    /// @notice Deposit ETH into the vault. ETH is wrapped to WETH and swapped into the index (global or user's custom index).
    /// @param minSharesOut Minimum shares to receive (slippage protection).
    function depositEth(uint256 minSharesOut) external payable nonReentrant {
        if (msg.value == 0) return;
        if (safeModeActive) {
            // In safe mode we only hold WETH; still mint shares 1:1 for incoming ETH
            uint256 _assetsBefore = totalAssets();
            uint256 _supply = totalSupply();
            IWETH(WETH).deposit{value: msg.value}();
            uint256 _shares = _supply == 0 ? msg.value : (msg.value * _supply) / _assetsBefore;
            if (_shares == 0) _shares = msg.value;
            if (_shares < minSharesOut) revert MinSharesNotMet(_shares, minSharesOut);
            _mint(msg.sender, _shares);
            emit VaultDeposit(msg.sender, msg.value, _shares);
            return;
        }
        harvestAndReinvest();
        (uint256 shares,) = _depositWethAndSwap(msg.value, msg.sender);
        if (shares < minSharesOut) revert MinSharesNotMet(shares, minSharesOut);
        _mint(msg.sender, shares);
        emit VaultDeposit(msg.sender, msg.value, shares);
    }

    /// @dev Internal: wrap ETH to WETH, swap WETH to index tokens per weights (user's or global), mint shares.
    /// Uses totalAssets() *before* swap so share calculation is correct (ERC4626).
    function _depositWethAndSwap(uint256 amountEth, address receiver)
        internal
        returns (uint256 shares, uint256 totalAssetUsed)
    {
        uint256 assetsBefore = totalAssets();
        uint256 supply = totalSupply();

        IWETH(WETH).deposit{value: amountEth}();
        IERC20 weth = IERC20(WETH);
        uint256 wethBalance = weth.balanceOf(address(this));

        totalAssetUsed = _swapWethToIndexForUser(wethBalance, receiver);
        if (totalAssetUsed == 0) totalAssetUsed = amountEth;

        shares = supply == 0
            ? totalAssetUsed
            : (totalAssetUsed * supply) / assetsBefore;
        if (shares == 0) shares = totalAssetUsed;
    }

    /// @notice Deposit WETH and receive vault shares with slippage protection. Uses receiver's custom index if set.
    /// @param minSharesOut Minimum shares to receive (slippage protection).
    function deposit(uint256 assets, address receiver, uint256 minSharesOut)
        public
        nonReentrant
        returns (uint256 shares)
    {
        if (safeModeActive) {
            uint256 _assetsBefore = totalAssets();
            uint256 _supply = totalSupply();
            IERC20(asset()).safeTransferFrom(msg.sender, address(this), assets);
            shares = _supply == 0 ? assets : (assets * _supply) / _assetsBefore;
            if (shares == 0) shares = assets;
            if (shares < minSharesOut) revert MinSharesNotMet(shares, minSharesOut);
            _mint(receiver, shares);
            emit VaultDeposit(receiver, assets, shares);
            return shares;
        }
        harvestAndReinvest();
        uint256 assetsBefore = totalAssets();
        uint256 supply = totalSupply();

        IERC20(asset()).safeTransferFrom(msg.sender, address(this), assets);
        uint256 totalAssetUsed = _swapWethToIndexForUser(assets, receiver);
        if (totalAssetUsed == 0) totalAssetUsed = assets;

        shares = supply == 0
            ? totalAssetUsed
            : (totalAssetUsed * supply) / assetsBefore;
        if (shares == 0) shares = totalAssetUsed;
        if (shares < minSharesOut) revert MinSharesNotMet(shares, minSharesOut);

        _mint(receiver, shares);
        emit VaultDeposit(receiver, assets, shares);
        return shares;
    }

    /// @notice ERC4626 deposit overload without minSharesOut (uses 0 for minimum).
    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256 shares) {
        return deposit(assets, receiver, 0);
    }

    /// @notice Burn shares and receive ETH. Uses assetsOut = (shares * totalAssets) / totalSupply.
    function withdraw(uint256 shares) external nonReentrant {
        if (shares == 0) return;
        uint256 supply = totalSupply();
        if (supply == 0) return;

        uint256 assetsOut = (shares * totalAssets()) / supply;
        _burn(msg.sender, shares);

        uint256 wethOut = _withdrawIndexToWeth(assetsOut);
        IWETH(WETH).withdraw(wethOut);
        uint256 actualBalance = address(this).balance;
        Address.sendValue(payable(msg.sender), actualBalance < wethOut ? actualBalance : wethOut);

        emit VaultWithdraw(msg.sender, shares, wethOut);
    }

    /// @inheritdoc ERC4626
    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        shares = _convertToShares(assets, Math.Rounding.Ceil);
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);

        uint256 wethNeeded = _withdrawIndexToWeth(assets);
        IERC20(asset()).safeTransfer(receiver, wethNeeded);
        return shares;
    }

    /// @inheritdoc ERC4626
    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        assets = _convertToAssets(shares, Math.Rounding.Floor);
        _burn(owner, shares);

        uint256 wethOut = _withdrawIndexToWeth(assets);
        IERC20(asset()).safeTransfer(receiver, wethOut);
        return wethOut;
    }

    /// @notice Rebalance: optionally update target weights, then sell index to WETH and re-swap to target weights. Callable by owner or keeper.
    /// @param newWeightsBps New weights in bps (length must match indexTokens, sum 10000). Empty to keep current.
    function rebalance(uint16[] calldata newWeightsBps) external nonReentrant {
        if (msg.sender != owner() && msg.sender != keeper) revert OnlyOwnerOrKeeper();
        if (safeModeActive) return;
        if (newWeightsBps.length == indexTokens.length) {
            uint256 sum;
            for (uint256 i = 0; i < newWeightsBps.length; i++) sum += newWeightsBps[i];
            if (sum != 10000) revert InvalidWeights();
            weightsBps = newWeightsBps;
            emit IndexUpdated(indexTokens, newWeightsBps);
        }
        uint256[] memory amountsOut = new uint256[](indexTokens.length);
        uint256 totalWeth;

        for (uint256 i = 0; i < indexTokens.length; i++) {
            address token = indexTokens[i];
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal == 0) continue;

            IERC20(token).forceApprove(address(swapRouter), bal);
            uint24 fee = i < feeTiers.length ? feeTiers[i] : DEFAULT_FEE;
            uint256 out = swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: token,
                    tokenOut: WETH,
                    fee: fee,
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: bal,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
            amountsOut[i] = out;
            totalWeth += out;
        }

        emit Rebalanced(totalWeth, amountsOut);
        emit VaultRebalance(block.timestamp);

        if (totalWeth > 0 && indexTokens.length > 0) {
            _swapWethToIndex(totalWeth);
        }
    }

    /// @notice Legacy rebalance (full sell + re-swap). Kept for compatibility.
    function rebalanceIndex() external onlyOwner nonReentrant {
        if (safeModeActive) return;
        uint256[] memory amountsOut = new uint256[](indexTokens.length);
        uint256 totalWeth;
        for (uint256 i = 0; i < indexTokens.length; i++) {
            address token = indexTokens[i];
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal == 0) continue;
            IERC20(token).forceApprove(address(swapRouter), bal);
            uint24 fee = i < feeTiers.length ? feeTiers[i] : DEFAULT_FEE;
            uint256 out = swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: token,
                    tokenOut: WETH,
                    fee: fee,
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: bal,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
            amountsOut[i] = out;
            totalWeth += out;
        }
        emit Rebalanced(totalWeth, amountsOut);
        emit VaultRebalance(block.timestamp);
        if (totalWeth > 0 && indexTokens.length > 0) _swapWethToIndex(totalWeth);
    }

    /// @notice Sweep any leftover WETH in the vault back into the index (compounding). Callable by anyone. No nonReentrant so it can be invoked from depositEth/deposit.
    function harvestAndReinvest() public {
        if (safeModeActive) return;
        uint256 wethBal = IERC20(WETH).balanceOf(address(this));
        if (wethBal == 0) return;
        uint256 used = _swapWethToIndex(wethBal);
        if (used > 0) emit HarvestAndReinvest(used);
    }

    /// @notice Set volatility protection threshold in bps (e.g. 1000 = 10% drop in 24h triggers Safe Exit).
    function setEmergencyThreshold(uint256 percentageBps) external onlyOwner {
        emergencyThresholdBps = percentageBps;
        emit EmergencyThresholdSet(percentageBps);
    }

    /// @notice Record snapshot of totalAssets for 24h comparison. Call by keeper or owner periodically.
    function recordSnapshot() external {
        if (msg.sender != owner() && msg.sender != keeper) revert OnlyOwnerOrKeeper();
        totalAssetsAtSnapshot = totalAssets();
        snapshotTimestamp = block.timestamp;
        emit SnapshotRecorded(totalAssetsAtSnapshot, snapshotTimestamp);
    }

    /// @notice If portfolio dropped >= threshold since snapshot, trigger Safe Exit (swap all to WETH). No 24h wait (for testing/demo).
    function checkAndTriggerSafeMode() external nonReentrant {
        if (safeModeActive) return;
        if (emergencyThresholdBps == 0) return;
        if (snapshotTimestamp == 0) return;
        uint256 current = totalAssets();
        // current < snapshot * (10000 - thresholdBps) / 10000
        if (current >= (totalAssetsAtSnapshot * (10000 - emergencyThresholdBps)) / 10000) return;
        safeModeActive = true;
        emit SafeModeTriggered(current);
        _safeExit();
    }

    /// @notice Owner only: force Safe Mode on immediately (for demos). Sells all index tokens to WETH.
    function forceTriggerSafeMode() external onlyOwner nonReentrant {
        if (safeModeActive) return;
        uint256 current = totalAssets();
        safeModeActive = true;
        emit SafeModeTriggered(current);
        _safeExit();
    }

    /// @dev Swap all index tokens to WETH (preserve capital in safe asset).
    function _safeExit() internal {
        for (uint256 i = 0; i < indexTokens.length; i++) {
            address token = indexTokens[i];
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal == 0) continue;
            IERC20(token).forceApprove(address(swapRouter), bal);
            uint24 fee = i < feeTiers.length ? feeTiers[i] : DEFAULT_FEE;
            swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: token,
                    tokenOut: WETH,
                    fee: fee,
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: bal,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
        }
    }

    /// @notice Set custom index weights for msg.sender (basis points, same length as global index, sum 10000). Callable by any user.
    function setUserIndex(uint16[] calldata weightsBpsUser) public {
        if (weightsBpsUser.length != indexTokens.length) revert InvalidLength();
        uint256 sum;
        for (uint256 i = 0; i < weightsBpsUser.length; i++) sum += weightsBpsUser[i];
        if (sum != 10000) revert InvalidWeights();
        userIndices[msg.sender] = weightsBpsUser;
        emit UserIndexSet(msg.sender);
    }

    /// @notice Get weights to use for a user (custom or global). For frontend / integration.
    function getUserWeights(address user) external view returns (uint16[] memory) {
        uint16[] storage u = userIndices[user];
        if (u.length == indexTokens.length) return u;
        return weightsBps;
    }

    /// @notice Returns the current owner (deployer). Use this to verify who can call setEmergencyThreshold, setIndex, etc.
    function getOwner() external view returns (address) {
        return owner();
    }

    /// @notice Owner: set keeper address (can call rebalance and recordSnapshot).
    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
        emit KeeperSet(_keeper);
    }

    /// @notice Owner: set price oracle for delta-based rebalancing (optional).
    function setPriceOracle(address _oracle) external onlyOwner {
        priceOracle = IPriceOracle(_oracle);
        emit PriceOracleSet(_oracle);
    }

    /// @notice Owner: exit Safe Mode and optionally re-invest WETH into the index.
    function exitSafeMode(bool reinvestIntoIndex) external onlyOwner nonReentrant {
        if (!safeModeActive) return;
        safeModeActive = false;
        if (reinvestIntoIndex) {
            uint256 wethBal = IERC20(WETH).balanceOf(address(this));
            if (wethBal > 0) _swapWethToIndex(wethBal);
        }
    }

    /// @dev Get weights for a user (custom index or global). Returns memory array for use in swaps.
    function _getWeightsFor(address user) internal view returns (uint16[] memory) {
        uint16[] storage u = userIndices[user];
        if (u.length == indexTokens.length) {
            uint16[] memory out = new uint16[](u.length);
            for (uint256 i = 0; i < u.length; i++) out[i] = u[i];
            return out;
        }
        return weightsBps;
    }

    /// @dev Swap WETH to index tokens according to given weights (rounding-safe).
    function _swapWethToIndexWithWeights(uint256 wethAmount, uint16[] memory wBps) internal returns (uint256 totalUsed) {
        if (indexTokens.length == 0 || wethAmount == 0 || wBps.length != indexTokens.length) return 0;
        IERC20 weth = IERC20(WETH);
        for (uint256 i = 0; i < indexTokens.length; i++) {
            uint256 portion = (wethAmount * wBps[i]) / 10000;
            if (portion == 0) continue;
            weth.forceApprove(address(swapRouter), portion);
            uint24 fee = i < feeTiers.length ? feeTiers[i] : DEFAULT_FEE;
            swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: WETH,
                    tokenOut: indexTokens[i],
                    fee: fee,
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: portion,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
            totalUsed += portion;
        }
        return totalUsed;
    }

    /// @dev Swap WETH to index using global weights (harvest, rebalance).
    function _swapWethToIndex(uint256 wethAmount) internal returns (uint256 totalUsed) {
        return _swapWethToIndexWithWeights(wethAmount, weightsBps);
    }

    /// @dev Swap WETH to index using user's custom or global weights (deposit).
    function _swapWethToIndexForUser(uint256 wethAmount, address user) internal returns (uint256 totalUsed) {
        return _swapWethToIndexWithWeights(wethAmount, _getWeightsFor(user));
    }

    /// @dev For withdraw: use WETH balance first, then sell index tokens proportionally to get remaining WETH.
    function _withdrawIndexToWeth(uint256 assetsRequested) internal returns (uint256 wethOut) {
        uint256 wethBal = IERC20(WETH).balanceOf(address(this));
        if (wethBal >= assetsRequested) return assetsRequested;

        wethOut = wethBal;
        uint256 needFromSwap = assetsRequested - wethBal;
        uint256 totalWethValue = _totalWethValue();
        if (totalWethValue == 0) return wethOut;

        for (uint256 i = 0; i < indexTokens.length; i++) {
            uint256 bal = IERC20(indexTokens[i]).balanceOf(address(this));
            if (bal == 0) continue;
            uint256 toSell = (bal * needFromSwap) / totalWethValue;
            if (toSell == 0) continue;

            IERC20(indexTokens[i]).forceApprove(address(swapRouter), toSell);
            uint24 fee = i < feeTiers.length ? feeTiers[i] : DEFAULT_FEE;
            wethOut += swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: indexTokens[i],
                    tokenOut: WETH,
                    fee: fee,
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: toSell,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
        }
        return wethOut;
    }

    /// @notice Get balance of each index token (for frontend pie chart).
    function getIndexBalances() external view returns (uint256[] memory) {
        uint256[] memory balances = new uint256[](indexTokens.length);
        for (uint256 i = 0; i < indexTokens.length; i++) {
            balances[i] = IERC20(indexTokens[i]).balanceOf(address(this));
        }
        return balances;
    }

    /// @dev Total value in WETH terms. Index tokens converted via STOCK_PER_WETH (1 WETH = 100 stock).
    function _totalWethValue() internal view returns (uint256) {
        uint256 wethBal = IERC20(WETH).balanceOf(address(this));
        for (uint256 i = 0; i < indexTokens.length; i++) {
            wethBal += IERC20(indexTokens[i]).balanceOf(address(this)) / STOCK_PER_WETH;
        }
        return wethBal;
    }

    /// @notice Total assets in WETH terms (underlying asset).
    function totalAssets() public view override returns (uint256) {
        return _totalWethValue();
    }

    /// @notice Update index composition (tokens and weights). Only owner.
    function setIndex(address[] calldata tokens, uint16[] calldata newWeightsBps, uint24[] calldata fees)
        external
        onlyOwner
    {
        if (tokens.length != newWeightsBps.length || tokens.length != fees.length) revert InvalidLength();
        uint256 sum;
        for (uint256 i = 0; i < newWeightsBps.length; i++) sum += newWeightsBps[i];
        if (sum != 10000) revert InvalidWeights();

        indexTokens = tokens;
        weightsBps = newWeightsBps;
        feeTiers = fees;
        emit IndexUpdated(tokens, newWeightsBps);
    }

    /// @notice Get index token list (for frontend).
    function getIndexTokens() external view returns (address[] memory) {
        return indexTokens;
    }

    /// @notice Get weights in basis points (for frontend).
    function getWeightsBps() external view returns (uint16[] memory) {
        return weightsBps;
    }
}
