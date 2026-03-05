// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IPriceOracle.sol";

/**
 * @title MockPriceOracle
 * @notice Mock oracle for testnet: fixed rate 1 WETH = 100 stock tokens => 1 token = 0.01 WETH (1e16).
 * @dev Owner can override per-token prices for testing rebalancing.
 */
contract MockPriceOracle is IPriceOracle {
    address public immutable weth;

    /// @dev token => price in WETH (18 decimals).
    mapping(address => uint256) private _priceInWeth;

    constructor(address _weth, address[] memory indexTokens) {
        weth = _weth;
        uint256 defaultStockPrice = 1e18 / 100; // 0.01 WETH per stock token
        for (uint256 i = 0; i < indexTokens.length; i++) {
            _priceInWeth[indexTokens[i]] = indexTokens[i] == _weth ? 1e18 : defaultStockPrice;
        }
        _priceInWeth[_weth] = 1e18;
    }

    function getPriceInWeth(address token) external view override returns (uint256) {
        return _priceInWeth[token] != 0 ? _priceInWeth[token] : 1e18 / 100;
    }

    /// @notice Set price for a token (owner / test helper). Price in WETH terms (18 decimals).
    function setPrice(address token, uint256 priceInWeth) external {
        _priceInWeth[token] = priceInWeth;
    }
}
