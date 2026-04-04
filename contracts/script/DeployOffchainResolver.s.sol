// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/KondorOffchainResolver.sol";

contract DeployOffchainResolver is Script {
    function run() external {
        // Read from environment
        string memory gatewayUrl = vm.envString("GATEWAY_URL");
        address signerAddr = vm.envAddress("GATEWAY_SIGNER_ADDRESS");

        vm.startBroadcast();

        KondorOffchainResolver resolver = new KondorOffchainResolver(
            gatewayUrl,
            signerAddr
        );

        vm.stopBroadcast();

        console.log("KondorOffchainResolver deployed at:", address(resolver));
        console.log("  Gateway URL:", gatewayUrl);
        console.log("  Signer:", signerAddr);
    }
}
