// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IPriceOracle
/// @notice Returns token price in WETH terms (18 decimals). Used for rebalancing delta calculation.
interface IPriceOracle {
    /// @notice Get the value of one token in WETH (1e18 = 1 WETH).
    function getPriceInWeth(address token) external view returns (uint256);
}
