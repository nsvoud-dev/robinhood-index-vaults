// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ISwapRouter.sol";
import "./interfaces/IWETH.sol";

/**
 * @title MockSwapRouter
 * @notice Mock DEX router for testing. Fixed rate: 1 WETH = 100 Stock Tokens.
 * @dev Deployer must fund this contract with stock tokens (and optionally WETH for reverse swaps).
 */
contract MockSwapRouter is ISwapRouter {
    using SafeERC20 for IERC20;

    /// @dev Fixed rate: 1 WETH (1e18) = 100 Stock Tokens (100e18)
    uint256 public constant STOCK_PER_WETH = 100;

    address public immutable weth;
    address[] public stockTokens;

    event Swap(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    constructor(address _weth, address[] memory _stockTokens) {
        weth = _weth;
        stockTokens = _stockTokens;
    }

    /// @notice Fund the router with tokens (for testing). Call from deployer.
    function fund(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Implements Uniswap V3-style exactInputSingle. Rate: 1 WETH = 100 Stock.
    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        if (params.tokenIn == weth && _isStockToken(params.tokenOut)) {
            // WETH -> Stock: pull WETH, send stock at 1:100
            IERC20(weth).safeTransferFrom(msg.sender, address(this), params.amountIn);
            amountOut = params.amountIn * STOCK_PER_WETH;
            IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
        } else if (_isStockToken(params.tokenIn) && params.tokenOut == weth) {
            // Stock -> WETH: pull stock, send WETH at 100:1
            IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
            amountOut = params.amountIn / STOCK_PER_WETH;
            IERC20(weth).safeTransfer(params.recipient, amountOut);
        } else {
            revert("MockSwapRouter: unsupported pair");
        }
        emit Swap(params.tokenIn, params.tokenOut, params.amountIn, amountOut);
        return amountOut;
    }

    function _isStockToken(address token) internal view returns (bool) {
        for (uint256 i = 0; i < stockTokens.length; i++) {
            if (stockTokens[i] == token) return true;
        }
        return false;
    }

    /// @notice Accept ETH and wrap to WETH (for liquidity when vault withdraws Stock -> WETH).
    receive() external payable {
        if (msg.value > 0) {
            IWETH(weth).deposit{value: msg.value}();
        }
    }
}
