// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";
import {SimpleAccount} from "./SimpleAccount.sol";

/// @title RnsRegistry — Factory + router for subdomain-based smart accounts
/// @notice Deploys SimpleAccounts via CREATE2 keyed by subdomain string.
///         Receives CRE reports and forwards calldata batches to the target account.
contract KondorRegistry is IReceiver, Ownable {
    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    /// @notice The trusted Chainlink Forwarder that may call onReport.
    address public forwarder;

    /// @notice subdomain hash → deployed SimpleAccount address
    mapping(bytes32 => address) public accounts;

    /// @notice subdomain hash → owner address
    mapping(bytes32 => address) public subdomainOwners;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event AccountCreated(string indexed subdomain, address account, address owner);
    event ReportProcessed(string subdomain, uint256 callCount);
    event ForwarderUpdated(address oldForwarder, address newForwarder);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error UnauthorizedForwarder();
    error AccountAlreadyExists(string subdomain);
    error AccountDoesNotExist(string subdomain);
    error ArrayLengthMismatch();

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /// @param _forwarder Chainlink KeystoneForwarder address (address(0) to skip check).
    constructor(address _forwarder) Ownable(msg.sender) {
        forwarder = _forwarder;
    }

    // -----------------------------------------------------------------------
    // CRE Integration
    // -----------------------------------------------------------------------

    /// @notice Called by the Chainlink Forwarder with a CRE workflow report.
    /// @dev For now the report is ABI-decoded as:
    ///      (string subdomain, address owner, address[] targets, uint256[] values, bytes[] calldatas)
    ///      - If the SA doesn't exist it is deployed + initialized first.
    ///      - Then batchExecute is called with the provided calldata array.
    function onReport(bytes calldata /* metadata */, bytes calldata report) external override {
        // Gate: only the forwarder may call (skip if forwarder == address(0) for testing)
        if (forwarder != address(0) && msg.sender != forwarder) {
            revert UnauthorizedForwarder();
        }

        (
            string memory subdomain,
            address owner_,
            address[] memory targets,
            uint256[] memory values,
            bytes[] memory calldatas
        ) = abi.decode(report, (string, address, address[], uint256[], bytes[]));

        // Deploy account if it doesn't exist
        bytes32 key = _subdomainKey(subdomain);
        address account = accounts[key];
        if (account == address(0)) {
            account = _deployAccount(subdomain, owner_);
        }

        // Execute batch if there is calldata
        if (targets.length > 0) {
            if (targets.length != values.length || targets.length != calldatas.length) {
                revert ArrayLengthMismatch();
            }
            SimpleAccount(payable(account)).batchExecute(targets, values, calldatas);
        }

        emit ReportProcessed(subdomain, targets.length);
    }

    // -----------------------------------------------------------------------
    // Account management (callable by owner for manual ops)
    // -----------------------------------------------------------------------

    /// @notice Manually deploy + register an account for a subdomain.
    function createAccount(string calldata subdomain, address owner_) external onlyOwner returns (address) {
        return _deployAccount(subdomain, owner_);
    }

    /// @notice Execute a batch on an existing account (registry is authorized).
    function executeOnAccount(
        string calldata subdomain,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas
    ) external onlyOwner {
        bytes32 key = _subdomainKey(subdomain);
        address account = accounts[key];
        if (account == address(0)) revert AccountDoesNotExist(subdomain);
        if (targets.length != values.length || targets.length != calldatas.length) {
            revert ArrayLengthMismatch();
        }
        SimpleAccount(payable(account)).batchExecute(targets, values, calldatas);
    }

    // -----------------------------------------------------------------------
    // View helpers
    // -----------------------------------------------------------------------

    /// @notice Get the account address for a subdomain (address(0) if not deployed).
    function getAccount(string calldata subdomain) external view returns (address) {
        return accounts[_subdomainKey(subdomain)];
    }

    /// @notice Predict the CREATE2 address for a subdomain before deployment.
    function predictAddress(string calldata subdomain) external view returns (address) {
        bytes32 salt = _subdomainKey(subdomain);
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(type(SimpleAccount).creationCode))
        );
        return address(uint160(uint256(hash)));
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    function setForwarder(address _forwarder) external onlyOwner {
        emit ForwarderUpdated(forwarder, _forwarder);
        forwarder = _forwarder;
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    function _subdomainKey(string memory subdomain) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(subdomain));
    }

    function _deployAccount(string memory subdomain, address owner_) internal returns (address) {
        bytes32 key = _subdomainKey(subdomain);
        if (accounts[key] != address(0)) revert AccountAlreadyExists(subdomain);

        bytes32 salt = key;
        SimpleAccount account = new SimpleAccount{salt: salt}();
        account.initialize(owner_, address(this));

        accounts[key] = address(account);
        subdomainOwners[key] = owner_;

        emit AccountCreated(subdomain, address(account), owner_);
        return address(account);
    }
}
