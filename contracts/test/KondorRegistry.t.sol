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
    KondorRegistry registry;
    MockTarget target;
    address forwarder = address(0xF0);
    address alice = address(0xA1);

    function setUp() public {
        registry = new KondorRegistry(forwarder);
        target = new MockTarget();
    }

    // -------------------------------------------------------------------
    // Account creation
    // -------------------------------------------------------------------

    function test_createAccount() public {
        address predicted = registry.predictAddress("alice.Kondor");

        address account = registry.createAccount("alice.Kondor", alice);

        assertEq(account, predicted, "deployed address should match prediction");
        assertEq(registry.getAccount("alice.Kondor"), account);
        assertEq(SimpleAccount(payable(account)).owner(), alice);
        assertEq(SimpleAccount(payable(account)).registry(), address(registry));
    }

    function test_createAccount_duplicate_reverts() public {
        registry.createAccount("alice.Kondor", alice);
        vm.expectRevert(abi.encodeWithSelector(KondorRegistry.AccountAlreadyExists.selector, "alice.Kondor"));
        registry.createAccount("alice.Kondor", alice);
    }

    function test_differentSubdomains_differentAddresses() public {
        address a1 = registry.createAccount("alice.Kondor", alice);
        address a2 = registry.createAccount("bob.Kondor", alice);
        assertTrue(a1 != a2);
    }

    // -------------------------------------------------------------------
    // onReport — deploy + batch execute
    // -------------------------------------------------------------------

    function test_onReport_deploysAndExecutes() public {
        address[] memory targets = new address[](1);
        targets[0] = address(target);

        uint256[] memory values = new uint256[](1);
        values[0] = 0;

        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockTarget.setValue, (42));

        bytes memory report = abi.encode("test.Kondor", alice, targets, values, calldatas);

        vm.prank(forwarder);
        registry.onReport("", report);

        // Account should be created
        address account = registry.getAccount("test.Kondor");
        assertTrue(account != address(0));

        // Call should have been executed
        assertEq(target.value(), 42);
    }

    function test_onReport_existingAccount_justExecutes() public {
        registry.createAccount("test.Kondor", alice);

        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockTarget.setValue, (99));

        bytes memory report = abi.encode("test.Kondor", alice, targets, values, calldatas);

        vm.prank(forwarder);
        registry.onReport("", report);

        assertEq(target.value(), 99);
    }

    function test_onReport_emptyCalldata_justDeploys() public {
        address[] memory targets = new address[](0);
        uint256[] memory values = new uint256[](0);
        bytes[] memory calldatas = new bytes[](0);

        bytes memory report = abi.encode("empty.Kondor", alice, targets, values, calldatas);

        vm.prank(forwarder);
        registry.onReport("", report);

        assertTrue(registry.getAccount("empty.Kondor") != address(0));
    }

    function test_onReport_unauthorizedForwarder_reverts() public {
        bytes memory report = abi.encode("x.Kondor", alice, new address[](0), new uint256[](0), new bytes[](0));

        vm.prank(address(0xBAD));
        vm.expectRevert(KondorRegistry.UnauthorizedForwarder.selector);
        registry.onReport("", report);
    }

    // -------------------------------------------------------------------
    // executeOnAccount
    // -------------------------------------------------------------------

    function test_executeOnAccount() public {
        registry.createAccount("exec.Kondor", alice);

        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockTarget.setValue, (77));

        registry.executeOnAccount("exec.Kondor", targets, values, calldatas);

        assertEq(target.value(), 77);
    }

    function test_executeOnAccount_nonexistent_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(KondorRegistry.AccountDoesNotExist.selector, "nope.Kondor"));
        registry.executeOnAccount("nope.Kondor", new address[](0), new uint256[](0), new bytes[](0));
    }

    // -------------------------------------------------------------------
    // SimpleAccount direct
    // -------------------------------------------------------------------

    function test_account_execute_byOwner() public {
        address account = registry.createAccount("own.Kondor", alice);

        vm.prank(alice);
        SimpleAccount(payable(account)).execute(address(target), 0, abi.encodeCall(MockTarget.setValue, (11)));

        assertEq(target.value(), 11);
    }

    function test_account_execute_unauthorized_reverts() public {
        address account = registry.createAccount("own.Kondor", alice);

        vm.prank(address(0xDEAD));
        vm.expectRevert(SimpleAccount.NotAuthorized.selector);
        SimpleAccount(payable(account)).execute(address(target), 0, "");
    }

    function test_account_initialize_twice_reverts() public {
        address account = registry.createAccount("own.Kondor", alice);

        vm.expectRevert(SimpleAccount.AlreadyInitialized.selector);
        SimpleAccount(payable(account)).initialize(alice, address(registry));
    }

    function test_account_batchExecute_revert_propagates() public {
        address account = registry.createAccount("rev.Kondor", alice);

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
        KondorRegistry open = new KondorRegistry(address(0));
        bytes memory report = abi.encode("open.Kondor", alice, new address[](0), new uint256[](0), new bytes[](0));

        vm.prank(address(0xBEEF));
        open.onReport("", report);

        assertTrue(open.getAccount("open.Kondor") != address(0));
    }
}
