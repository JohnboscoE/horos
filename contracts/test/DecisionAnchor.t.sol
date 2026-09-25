// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DecisionAnchor} from "../src/DecisionAnchor.sol";
import {Attested} from "../src/Attested.sol";

contract DecisionAnchorTest is Test {
    DecisionAnchor da;
    address owner = makeAddr("owner");
    address attester = makeAddr("attester");
    address attester2 = makeAddr("attester2");

    function setUp() public {
        da = new DecisionAnchor(owner, attester);
    }

    function test_emptyLatest() public view {
        DecisionAnchor.Anchor memory a = da.latest();
        assertEq(a.chainHead, bytes32(0));
        assertEq(a.count, 0);
        assertEq(da.anchorCount(), 0);
    }

    function test_anchor_onlyAttester() public {
        vm.prank(owner);
        vm.expectRevert(Attested.NotAttester.selector);
        da.anchor(keccak256("h"), 1);
    }

    function test_anchorOrdering() public {
        vm.warp(1_000);
        vm.expectEmit(true, true, false, true);
        emit DecisionAnchor.Anchored(0, keccak256("h1"), 5, 1_000);
        vm.prank(attester);
        da.anchor(keccak256("h1"), 5);

        vm.warp(2_000);
        vm.prank(attester);
        da.anchor(keccak256("h2"), 12);

        assertEq(da.anchorCount(), 2);
        DecisionAnchor.Anchor memory a = da.latest();
        assertEq(a.chainHead, keccak256("h2"));
        assertEq(a.count, 12);
        assertEq(a.anchoredAt, 2_000);
        assertEq(da.anchorAt(0).chainHead, keccak256("h1"));

        // equal count reverts
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(DecisionAnchor.CountNotIncreasing.selector, 12, 12));
        da.anchor(keccak256("h3"), 12);

        // lower count reverts
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(DecisionAnchor.CountNotIncreasing.selector, 12, 3));
        da.anchor(keccak256("h3"), 3);
    }

    function test_firstAnchorZeroCount_reverts() public {
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(DecisionAnchor.CountNotIncreasing.selector, 0, 0));
        da.anchor(keccak256("h"), 0);
    }

    function test_zeroHead_reverts() public {
        vm.prank(attester);
        vm.expectRevert(DecisionAnchor.InvalidHead.selector);
        da.anchor(bytes32(0), 1);
    }

    function test_attesterRotation() public {
        vm.startPrank(owner);
        da.setAttester(attester2, true);
        da.setAttester(attester, false);
        vm.stopPrank();

        vm.prank(attester);
        vm.expectRevert(Attested.NotAttester.selector);
        da.anchor(keccak256("h"), 1);

        vm.prank(attester2);
        da.anchor(keccak256("h"), 1);
        assertEq(da.anchorCount(), 1);
    }

    function testFuzz_strictlyIncreasing(uint256 a, uint256 b) public {
        a = bound(a, 1, type(uint128).max);
        vm.startPrank(attester);
        da.anchor(keccak256("a"), a);
        if (b <= a) {
            vm.expectRevert(abi.encodeWithSelector(DecisionAnchor.CountNotIncreasing.selector, a, b));
        }
        da.anchor(keccak256("b"), b);
        vm.stopPrank();
    }
}
