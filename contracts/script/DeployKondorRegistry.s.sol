// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/KondorRegistry.sol";

contract DeployKondorRegistry is Script {
    function run() external {
        // address(0) disables forwarder check — set it later via setForwarder()
        address forwarder = vm.envOr("FORWARDER", address(0));
        address railgun = vm.envOr("RAILGUN", address(0));
        vm.startBroadcast();

        KondorRegistry registry = new KondorRegistry(forwarder, railgun);

        vm.stopBroadcast();

        console.log("KondorRegistry deployed at:", address(registry));
        console.log("  Forwarder:", forwarder);
        console.log("  Railgun:", railgun);
        console.log("  Owner:", registry.owner());
    }
}
