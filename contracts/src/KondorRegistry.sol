// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";
import {SimpleAccount} from "./SimpleAccount.sol";

/// @title KondorRegistry — Factory + router for salt-keyed smart accounts
/// @notice Deploys SimpleAccounts via CREATE2 keyed by a bytes32 salt.
///         Receives CRE reports and forwards calldata batches to the target account.
contract KondorRegistry is IReceiver, Ownable {
    bytes32 internal constant EVENT_REPORT_MAGIC = keccak256("KONDOR_EVENT_REPORT_V1");

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    /// @notice The trusted Chainlink Forwarder that may call onReport.
    address public forwarder;

    /// @notice Railgun shielder contract address.
    address public railgunShielder;

    /// @notice salt → deployed SimpleAccount address
    mapping(bytes32 => address) public accounts;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    // 0 = Railgun (private), 1 = OffRamp (cash out), 2 = ForwardTo (send to receiver)
    enum Mode {
        Railgun,
        OffRamp,
        ForwardTo
    }

    event AccountCreated(bytes32 indexed salt, address account, bytes32 hashedOwner);
    event ReportProcessed(
        address indexed account, uint256 callCount, address[] touchedTokens, bool isSweepable, Mode mode
    );
    event ShieldReportProcessed(address indexed account, uint256 callCount, address[] touchedTokens);
    event ForwarderUpdated(address oldForwarder, address newForwarder);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error UnauthorizedForwarder();
    error AccountAlreadyExists(bytes32 salt);
    error AccountDoesNotExist(bytes32 salt);
    error InvalidEventAccount(address account);
    error ArrayLengthMismatch();

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /// @param _forwarder Chainlink KeystoneForwarder address (address(0) to skip check).
    constructor(address _forwarder, address _railgun) Ownable(msg.sender) {
        forwarder = _forwarder;
        railgunShielder = _railgun;
    }

    // -----------------------------------------------------------------------
    // CRE Integration
    // -----------------------------------------------------------------------

    /// @notice Called by the Chainlink Forwarder with a CRE workflow report.
    /// @dev Report is ABI-decoded as:
    ///      (bytes32 salt, bytes32 hashedOwner, address[] targets, uint256[] values, bytes[] calldatas, address[] touchedTokens, bool isSweepable, uint8 mode)
    ///      - If the SA doesn't exist it is deployed + initialized first.
    ///      - Then batchExecute is called with the provided calldata array.
    ///      - The mode is used to determine the action to take.
    ///      - The touchedTokens are the tokens that were touched by the calldata.
    ///      - The isSweepable is a boolean that indicates if the account should be swept.
    ///      - The mode is a uint8 that indicates the mode of the account.
    ///      - The mode is a uint8 that indicates the mode of the account.
    function onReport(
        bytes calldata,
        /* metadata */
        bytes calldata report
    )
        external
        override
    {
        if (forwarder != address(0) && msg.sender != forwarder) {
            revert UnauthorizedForwarder();
        }

        if (_isEventReport(report)) {
            _handleEventReport(report);
            return;
        }

        _handleInitialReport(report);
    }

    function _handleInitialReport(bytes calldata report) internal {
        (
            bytes32 salt,
            bytes32 hashedOwner_,
            address[] memory targets,
            uint256[] memory values,
            bytes[] memory calldatas,
            address[] memory touchedTokens,
            bool isSweepable,
            uint8 mode_
        ) = abi.decode(report, (bytes32, bytes32, address[], uint256[], bytes[], address[], bool, uint8));

        // Deploy account if it doesn't exist
        address account = accounts[salt];
        if (account == address(0)) {
            account = _deployAccount(salt, hashedOwner_);
        }

        // Execute batch if there is calldata
        if (targets.length > 0) {
            if (targets.length != values.length || targets.length != calldatas.length) {
                revert ArrayLengthMismatch();
            }
            SimpleAccount(payable(account)).batchExecute(targets, values, calldatas);
        }

        emit ReportProcessed(account, targets.length, touchedTokens, isSweepable, Mode(mode_));
    }

    function _handleEventReport(bytes calldata report) internal {
        (
            bytes32 magic,
            address account,
            address[] memory targets,
            uint256[] memory values,
            bytes[] memory calldatas,
            address[] memory touchedTokens
        ) = abi.decode(report, (bytes32, address, address[], uint256[], bytes[], address[]));

        if (magic != EVENT_REPORT_MAGIC) {
            revert InvalidEventAccount(account);
        }

        try SimpleAccount(payable(account)).registry() returns (address registry_) {
            if (registry_ != address(this)) revert InvalidEventAccount(account);
        } catch {
            revert InvalidEventAccount(account);
        }

        if (targets.length != values.length || targets.length != calldatas.length) {
            revert ArrayLengthMismatch();
        }

        if (targets.length > 0) {
            SimpleAccount(payable(account)).batchExecute(targets, values, calldatas);
        }

        emit ShieldReportProcessed(account, targets.length, touchedTokens);
    }

    // -----------------------------------------------------------------------
    // Account management (callable by owner for manual ops)
    // -----------------------------------------------------------------------

    /// @notice Manually deploy + register an account for a salt.
    function createAccount(bytes32 salt, bytes32 hashedOwner_) external onlyOwner returns (address) {
        return _deployAccount(salt, hashedOwner_);
    }

    /// @notice Execute a batch on an existing account (registry is authorized).
    function executeOnAccount(
        bytes32 salt,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas
    ) external onlyOwner {
        address account = accounts[salt];
        if (account == address(0)) revert AccountDoesNotExist(salt);
        if (targets.length != values.length || targets.length != calldatas.length) {
            revert ArrayLengthMismatch();
        }
        SimpleAccount(payable(account)).batchExecute(targets, values, calldatas);
    }

    // -----------------------------------------------------------------------
    // View helpers
    // -----------------------------------------------------------------------

    /// @notice Get the account address for a salt (address(0) if not deployed).
    function getAccount(bytes32 salt) external view returns (address) {
        return accounts[salt];
    }

    /// @notice Predict the CREATE2 address for a salt before deployment.
    function predictAddress(bytes32 salt) external view returns (address) {
        bytes32 hash =
            keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(type(SimpleAccount).creationCode)));
        return address(uint160(uint256(hash)));
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    function setForwarder(address _forwarder) external onlyOwner {
        emit ForwarderUpdated(forwarder, _forwarder);
        forwarder = _forwarder;
    }

    function setRailgunShielder(address _railgunShielder) external onlyOwner {
        railgunShielder = _railgunShielder;
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    function _deployAccount(bytes32 salt, bytes32 hashedOwner_) internal returns (address) {
        if (accounts[salt] != address(0)) revert AccountAlreadyExists(salt);

        SimpleAccount account = new SimpleAccount{salt: salt}();
        account.initialize(hashedOwner_, address(this));

        accounts[salt] = address(account);

        emit AccountCreated(salt, address(account), hashedOwner_);
        return address(account);
    }

    function _isEventReport(bytes calldata report) internal pure returns (bool) {
        if (report.length < 32) return false;

        bytes32 prefix;
        assembly {
            prefix := calldataload(report.offset)
        }
        return prefix == EVENT_REPORT_MAGIC;
    }
}
