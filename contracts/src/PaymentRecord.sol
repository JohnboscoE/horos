// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Attested} from "./Attested.sol";

/// @title PaymentRecord
/// @notice Objective payment facts for client-acknowledged invoices: due date, paid date, amount band.
/// @dev Trust assumption: attesters are trusted reporters (the Horos backend). Settlement facts can be
///      cross-checked against Arc transfers to each invoice's deposit address. clientIdHash is
///      keccak256(orgSlug, salt) with a private salt, so deleting the salt makes entries unlinkable.
contract PaymentRecord is Attested {
    /// @dev 0 = <100, 1 = 100-999, 2 = 1,000-9,999, 3 = >=10,000 (USDC equivalent)
    uint8 public constant MAX_AMOUNT_BAND = 3;

    struct Entry {
        bytes32 clientIdHash;
        bytes32 freelancerIdHash;
        uint64 dueDate;
        uint64 paidAt; // 0 until settled
        uint8 amountBand;
        bool disputed;
        bytes32 responseHash; // latest client response; 0 if none
    }

    mapping(bytes32 => Entry) private _entries;

    event Acknowledged(
        bytes32 indexed invoiceHash,
        bytes32 indexed clientIdHash,
        bytes32 indexed freelancerIdHash,
        uint64 dueDate,
        uint8 amountBand
    );
    event Settled(bytes32 indexed invoiceHash, bytes32 indexed clientIdHash, uint64 paidAt);
    event Disputed(bytes32 indexed invoiceHash, bytes32 indexed clientIdHash, bytes32 responseHash);
    event DisputeResolved(bytes32 indexed invoiceHash, bytes32 indexed clientIdHash);

    error AlreadyRecorded(bytes32 invoiceHash);
    error UnknownInvoice(bytes32 invoiceHash);
    error AlreadySettled(bytes32 invoiceHash);
    error AlreadyDisputed(bytes32 invoiceHash);
    error NotDisputed(bytes32 invoiceHash);
    error InvalidAmountBand(uint8 band);
    error InvalidInput();

    constructor(address initialOwner, address initialAttester) Attested(initialOwner, initialAttester) {}

    function recordAcknowledged(
        bytes32 invoiceHash,
        bytes32 clientIdHash,
        bytes32 freelancerIdHash,
        uint64 dueDate,
        uint8 amountBand
    ) external onlyAttester {
        if (invoiceHash == bytes32(0) || clientIdHash == bytes32(0) || freelancerIdHash == bytes32(0)) {
            revert InvalidInput();
        }
        if (dueDate == 0) revert InvalidInput();
        if (amountBand > MAX_AMOUNT_BAND) revert InvalidAmountBand(amountBand);
        if (_entries[invoiceHash].clientIdHash != bytes32(0)) revert AlreadyRecorded(invoiceHash);

        _entries[invoiceHash] = Entry({
            clientIdHash: clientIdHash,
            freelancerIdHash: freelancerIdHash,
            dueDate: dueDate,
            paidAt: 0,
            amountBand: amountBand,
            disputed: false,
            responseHash: bytes32(0)
        });
        emit Acknowledged(invoiceHash, clientIdHash, freelancerIdHash, dueDate, amountBand);
    }

    function recordSettled(bytes32 invoiceHash, uint64 paidAt) external onlyAttester {
        Entry storage e = _existing(invoiceHash);
        if (e.paidAt != 0) revert AlreadySettled(invoiceHash);
        if (paidAt == 0) revert InvalidInput();
        e.paidAt = paidAt;
        emit Settled(invoiceHash, e.clientIdHash, paidAt);
    }

    /// @notice Relays a client-signed response. The signature is verified off-chain by the attester;
    ///         responseHash commits to the signed message so it can be checked later.
    function recordDispute(bytes32 invoiceHash, bytes32 responseHash) external onlyAttester {
        Entry storage e = _existing(invoiceHash);
        if (responseHash == bytes32(0)) revert InvalidInput();
        if (e.disputed) revert AlreadyDisputed(invoiceHash);
        e.disputed = true;
        e.responseHash = responseHash;
        emit Disputed(invoiceHash, e.clientIdHash, responseHash);
    }

    /// @notice Marks a dispute resolved so the entry counts toward scoring again. The response stays attached.
    function resolveDispute(bytes32 invoiceHash) external onlyAttester {
        Entry storage e = _existing(invoiceHash);
        if (!e.disputed) revert NotDisputed(invoiceHash);
        e.disputed = false;
        emit DisputeResolved(invoiceHash, e.clientIdHash);
    }

    function getEntry(bytes32 invoiceHash) external view returns (Entry memory) {
        return _entries[invoiceHash];
    }

    function exists(bytes32 invoiceHash) external view returns (bool) {
        return _entries[invoiceHash].clientIdHash != bytes32(0);
    }

    function _existing(bytes32 invoiceHash) private view returns (Entry storage e) {
        e = _entries[invoiceHash];
        if (e.clientIdHash == bytes32(0)) revert UnknownInvoice(invoiceHash);
    }
}
