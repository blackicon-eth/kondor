// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {KondorRegistry} from "../src/KondorRegistry.sol";
import {SimpleAccount} from "../src/SimpleAccount.sol";

/// @dev Dummy target for testing execute calls
contract MockTarget {
    uint256 public value;

    function setValue(uint256 v) external {
        value = v;
    }

    function revertAlways() external pure {
        revert("boom");
    }

    receive() external payable {}
}

contract KondorRegistryTest is Test {
    bytes32 constant EVENT_REPORT_MAGIC = keccak256("KONDOR_EVENT_REPORT_V1");

    KondorRegistry registry;
    MockTarget target;
    address forwarder = address(0xF0);
    address alice = address(0xA1);

    function _salt(string memory label) internal pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    function _aliceHash() internal view returns (bytes32) {
        return keccak256(abi.encodePacked(alice));
    }

    function setUp() public {
        registry = new KondorRegistry(forwarder, address(0));
        target = new MockTarget();
    }

    // -------------------------------------------------------------------
    // Account creation
    // -------------------------------------------------------------------

    function test_createAccount() public {
        bytes32 s = _salt("alice.Kondor");
        address predicted = registry.predictAddress(s);

        address account = registry.createAccount(s, _aliceHash());

        assertEq(account, predicted, "deployed address should match prediction");
        assertEq(registry.getAccount(s), account);
        assertEq(SimpleAccount(payable(account)).hashedOwner(), _aliceHash());
        assertEq(SimpleAccount(payable(account)).registry(), address(registry));
    }

    function test_createAccount_duplicate_reverts() public {
        bytes32 s = _salt("alice.Kondor");
        registry.createAccount(s, _aliceHash());
        vm.expectRevert(abi.encodeWithSelector(KondorRegistry.AccountAlreadyExists.selector, s));
        registry.createAccount(s, _aliceHash());
    }

    function test_differentSubdomains_differentAddresses() public {
        address a1 = registry.createAccount(_salt("alice.Kondor"), _aliceHash());
        address a2 = registry.createAccount(_salt("bob.Kondor"), _aliceHash());
        assertTrue(a1 != a2);
    }

    // -------------------------------------------------------------------
    // onReport — deploy + batch execute
    // -------------------------------------------------------------------

    function _encodeReport(
        bytes32 salt_,
        bytes32 hashedOwner_,
        address[] memory targets_,
        uint256[] memory values_,
        bytes[] memory calldatas_
    ) internal pure returns (bytes memory) {
        address[] memory touched = new address[](0);
        return abi.encode(salt_, hashedOwner_, targets_, values_, calldatas_, touched, false, uint8(0));
    }

    function _encodeEventReport(
        address account_,
        address[] memory targets_,
        uint256[] memory values_,
        bytes[] memory calldatas_,
        address[] memory touchedTokens_
    ) internal pure returns (bytes memory) {
        return abi.encode(EVENT_REPORT_MAGIC, account_, targets_, values_, calldatas_, touchedTokens_);
    }

    function test_onReport_deploysAndExecutes() public {
        bytes32 s = _salt("test.Kondor");

        address[] memory targets = new address[](1);
        targets[0] = address(target);

        uint256[] memory values = new uint256[](1);
        values[0] = 0;

        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockTarget.setValue, (42));

        bytes memory report = _encodeReport(s, _aliceHash(), targets, values, calldatas);

        vm.prank(forwarder);
        registry.onReport("", report);

        address account = registry.getAccount(s);
        assertTrue(account != address(0));

        assertEq(target.value(), 42);
    }

    function test_onReport_existingAccount_justExecutes() public {
        bytes32 s = _salt("test.Kondor");
        registry.createAccount(s, _aliceHash());

        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockTarget.setValue, (99));

        bytes memory report = _encodeReport(s, _aliceHash(), targets, values, calldatas);

        vm.prank(forwarder);
        registry.onReport("", report);

        assertEq(target.value(), 99);
    }

    function test_onReport_eventReport_executesOnExistingAccount() public {
        bytes32 s = _salt("event.Kondor");
        address account = registry.createAccount(s, _aliceHash());

        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockTarget.setValue, (123));
        address[] memory touched = new address[](1);
        touched[0] = address(0x1234);

        bytes memory report = _encodeEventReport(account, targets, values, calldatas, touched);

        vm.prank(forwarder);
        registry.onReport("", report);

        assertEq(target.value(), 123);
    }

    function test_onReport_emptyCalldata_justDeploys() public {
        bytes32 s = _salt("empty.Kondor");

        bytes memory report = _encodeReport(s, _aliceHash(), new address[](0), new uint256[](0), new bytes[](0));

        vm.prank(forwarder);
        registry.onReport("", report);

        assertTrue(registry.getAccount(s) != address(0));
    }

    function test_onReport_unauthorizedForwarder_reverts() public {
        bytes32 s = _salt("x.Kondor");
        bytes memory report =
            _encodeReport(s, _aliceHash(), new address[](0), new uint256[](0), new bytes[](0));

        vm.prank(address(0xBAD));
        vm.expectRevert(KondorRegistry.UnauthorizedForwarder.selector);
        registry.onReport("", report);
    }

    // -------------------------------------------------------------------
    // executeOnAccount
    // -------------------------------------------------------------------

    function test_executeOnAccount() public {
        bytes32 s = _salt("exec.Kondor");
        registry.createAccount(s, _aliceHash());

        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockTarget.setValue, (77));

        registry.executeOnAccount(s, targets, values, calldatas);

        assertEq(target.value(), 77);
    }

    function test_executeOnAccount_nonexistent_reverts() public {
        bytes32 s = _salt("nope.Kondor");
        vm.expectRevert(abi.encodeWithSelector(KondorRegistry.AccountDoesNotExist.selector, s));
        registry.executeOnAccount(s, new address[](0), new uint256[](0), new bytes[](0));
    }

    // -------------------------------------------------------------------
    // SimpleAccount direct
    // -------------------------------------------------------------------

    function test_account_execute_byOwner() public {
        bytes32 s = _salt("own.Kondor");
        address account = registry.createAccount(s, _aliceHash());

        vm.prank(alice);
        SimpleAccount(payable(account)).execute(address(target), 0, abi.encodeCall(MockTarget.setValue, (11)));

        assertEq(target.value(), 11);
    }

    function test_account_execute_unauthorized_reverts() public {
        bytes32 s = _salt("own.Kondor");
        address account = registry.createAccount(s, _aliceHash());

        vm.prank(address(0xDEAD));
        vm.expectRevert(SimpleAccount.NotAuthorized.selector);
        SimpleAccount(payable(account)).execute(address(target), 0, "");
    }

    function test_account_initialize_twice_reverts() public {
        bytes32 s = _salt("own.Kondor");
        address account = registry.createAccount(s, _aliceHash());

        vm.expectRevert(SimpleAccount.AlreadyInitialized.selector);
        SimpleAccount(payable(account)).initialize(bytes32(0), address(0));
    }

    function test_account_batchExecute_revert_propagates() public {
        bytes32 s = _salt("rev.Kondor");
        address account = registry.createAccount(s, _aliceHash());

        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockTarget.revertAlways, ());

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SimpleAccount.CallFailed.selector, 0));
        SimpleAccount(payable(account)).batchExecute(targets, values, calldatas);
    }

    // -------------------------------------------------------------------
    // Forwarder address(0) bypass
    // -------------------------------------------------------------------

    function test_onReport_noForwarder_anyoneCanCall() public {
        KondorRegistry open = new KondorRegistry(address(0), address(0));
        bytes32 s = _salt("open.Kondor");
        bytes memory report =
            _encodeReport(s, _aliceHash(), new address[](0), new uint256[](0), new bytes[](0));

        vm.prank(address(0xBEEF));
        open.onReport("", report);

        assertTrue(open.getAccount(s) != address(0));
    }
}
