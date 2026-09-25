// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Attested} from "./Attested.sol";

/// @title DecisionAnchor
/// @notice Periodically anchors the head of Horos's hash-chained agent decision log.
/// @dev Anchors must be strictly increasing in `count` so a later anchor can never rewrite history.
contract DecisionAnchor is Attested {
    struct Anchor {
        bytes32 chainHead;
        uint256 count;
        uint64 anchoredAt;
    }

    Anchor[] private _anchors;

    event Anchored(uint256 indexed index, bytes32 indexed chainHead, uint256 count, uint64 anchoredAt);

    error InvalidHead();
    error CountNotIncreasing(uint256 previous, uint256 given);

    constructor(address initialOwner, address initialAttester) Attested(initialOwner, initialAttester) {}

    function anchor(bytes32 chainHead, uint256 count) external onlyAttester {
        if (chainHead == bytes32(0)) revert InvalidHead();
        uint256 n = _anchors.length;
        uint256 prev = n == 0 ? 0 : _anchors[n - 1].count;
        if (count <= prev) revert CountNotIncreasing(prev, count);
        _anchors.push(Anchor({chainHead: chainHead, count: count, anchoredAt: uint64(block.timestamp)}));
        emit Anchored(n, chainHead, count, uint64(block.timestamp));
    }

    function anchorCount() external view returns (uint256) {
        return _anchors.length;
    }

    function latest() external view returns (Anchor memory) {
        uint256 n = _anchors.length;
        if (n == 0) return Anchor(bytes32(0), 0, 0);
        return _anchors[n - 1];
    }

    function anchorAt(uint256 index) external view returns (Anchor memory) {
        return _anchors[index];
    }
}
