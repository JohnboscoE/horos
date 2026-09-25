// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PaymentRecord} from "../src/PaymentRecord.sol";
import {DecisionAnchor} from "../src/DecisionAnchor.sol";

/// Usage (Arc testnet):
///   forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast \
///     --private-key $DEPLOYER_PRIVATE_KEY
/// Env: OWNER_ADDRESS, ATTESTER_ADDRESS
contract Deploy is Script {
    function run() external {
        address owner = vm.envAddress("OWNER_ADDRESS");
        address attester = vm.envAddress("ATTESTER_ADDRESS");

        vm.startBroadcast();
        PaymentRecord rec = new PaymentRecord(owner, attester);
        DecisionAnchor anchor = new DecisionAnchor(owner, attester);
        vm.stopBroadcast();

        console2.log("PaymentRecord:", address(rec));
        console2.log("DecisionAnchor:", address(anchor));
    }
}
