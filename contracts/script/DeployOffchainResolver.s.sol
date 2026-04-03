// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/RnsOffchainResolver.sol";

contract DeployOffchainResolver is Script {
    function run() external {
        // Read from environment
        string memory gatewayUrl = vm.envString("GATEWAY_URL");
        address signerAddr = vm.envAddress("GATEWAY_SIGNER_ADDRESS");

        vm.startBroadcast();

        RnsOffchainResolver resolver = new RnsOffchainResolver(
            gatewayUrl,
            signerAddr
        );

        vm.stopBroadcast();

        console.log("RnsOffchainResolver deployed at:", address(resolver));
        console.log("  Gateway URL:", gatewayUrl);
        console.log("  Signer:", signerAddr);
    }
}
