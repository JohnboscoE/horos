// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Owner + rotatable attester set. The owner never writes records; it only manages attesters.
abstract contract Attested {
    address public owner;
    mapping(address => bool) public isAttester;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AttesterSet(address indexed attester, bool allowed);

    error NotOwner();
    error NotAttester();
    error ZeroAddress();

    constructor(address initialOwner, address initialAttester) {
        if (initialOwner == address(0) || initialAttester == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
        isAttester[initialAttester] = true;
        emit AttesterSet(initialAttester, true);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAttester() {
        if (!isAttester[msg.sender]) revert NotAttester();
        _;
    }

    function setAttester(address attester, bool allowed) external onlyOwner {
        if (attester == address(0)) revert ZeroAddress();
        isAttester[attester] = allowed;
        emit AttesterSet(attester, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
