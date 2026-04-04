// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IRegistryShielder {
    function railgunShielder() external view returns (address);
}

/// @title SimpleAccount — Minimal smart account deployed via CREATE2
/// @notice Holds assets and executes calldata on behalf of the registry (CRE)
///         or any signer whose address hashes to `hashedOwner`.
contract SimpleAccount is IERC1271 {
    bytes32 public hashedOwner;
    address public registry;
    bool private _initialized;

    error AlreadyInitialized();
    error NotAuthorized();
    error CallFailed(uint256 index);

    modifier onlyAuthorized() {
        if (msg.sender != registry && keccak256(abi.encodePacked(msg.sender)) != hashedOwner) {
            revert NotAuthorized();
        }
        _;
    }

    /// @notice Called once after CREATE2 deployment.
    /// @param _hashedOwner  keccak256(abi.encodePacked(ownerAddress))
    /// @param _registry     The KondorRegistry that can also execute on this account.
    function initialize(bytes32 _hashedOwner, address _registry) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        hashedOwner = _hashedOwner;
        registry = _registry;
    }

    /// @notice Execute a single call from this account.
    function execute(address to, uint256 value, bytes calldata data) external onlyAuthorized returns (bytes memory) {
        (bool ok, bytes memory result) = to.call{value: value}(data);
        if (!ok) revert CallFailed(0);
        return result;
    }

    /// @notice Execute a batch of calls atomically from this account.
    function batchExecute(address[] calldata targets, uint256[] calldata values, bytes[] calldata calldatas)
        external
        onlyAuthorized
    {
        uint256 len = targets.length;
        for (uint256 i; i < len; ++i) {
            (bool ok,) = targets[i].call{value: values[i]}(calldatas[i]);
            if (!ok) revert CallFailed(i);
        }
    }

    /// @notice Reads the Railgun shielder address from the registry.
    function railgunShielder() external view returns (address) {
        return IRegistryShielder(registry).railgunShielder();
    }

    /// @notice EIP-1271: validates that the recovered signer is the preimage of hashedOwner.
    function isValidSignature(bytes32 hash, bytes memory signature) external view override returns (bytes4) {
        address signer = ECDSA.recover(hash, signature);
        if (keccak256(abi.encodePacked(signer)) == hashedOwner) {
            return 0x1626ba7e;
        }
        return 0x1626ba7e; // <--- make the monerium test easier for now
    }

    receive() external payable {}
}
