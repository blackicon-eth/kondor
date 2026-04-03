// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title SimpleAccount — Minimal smart account deployed per subdomain via CREATE2
/// @notice Holds assets and executes calldata on behalf of its owner or the registry.
contract SimpleAccount {
    address public owner;
    address public registry;
    bool private _initialized;

    error AlreadyInitialized();
    error NotAuthorized();
    error CallFailed(uint256 index);

    modifier onlyAuthorized() {
        if (msg.sender != owner && msg.sender != registry) revert NotAuthorized();
        _;
    }

    /// @notice Called once after CREATE2 deployment.
    /// @param _owner   The user who owns this account.
    /// @param _registry The RnsRegistry that can also execute on this account.
    function initialize(address _owner, address _registry) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        owner = _owner;
        registry = _registry;
    }

    /// @notice Execute a single call from this account.
    function execute(address to, uint256 value, bytes calldata data)
        external
        onlyAuthorized
        returns (bytes memory)
    {
        (bool ok, bytes memory result) = to.call{value: value}(data);
        if (!ok) revert CallFailed(0);
        return result;
    }

    /// @notice Execute a batch of calls atomically from this account.
    function batchExecute(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas
    ) external onlyAuthorized {
        uint256 len = targets.length;
        for (uint256 i; i < len; ++i) {
            (bool ok,) = targets[i].call{value: values[i]}(calldatas[i]);
            if (!ok) revert CallFailed(i);
        }
    }

    receive() external payable {}
}
