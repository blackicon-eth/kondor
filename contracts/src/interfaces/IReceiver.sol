// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IReceiver — Chainlink CRE consumer interface
/// @notice Contracts that receive CRE workflow reports must implement this.
interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
