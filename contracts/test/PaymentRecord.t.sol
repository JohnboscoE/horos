// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PaymentRecord} from "../src/PaymentRecord.sol";
import {Attested} from "../src/Attested.sol";

contract PaymentRecordTest is Test {
    PaymentRecord rec;
    address owner = makeAddr("owner");
    address attester = makeAddr("attester");
    address attester2 = makeAddr("attester2");
    address rando = makeAddr("rando");

    bytes32 constant INV = keccak256("invoice-1");
    bytes32 constant CLIENT = keccak256("acme-dao|salt");
    bytes32 constant FREELANCER = keccak256("freelancer-1");
    uint64 constant DUE = 1_760_000_000;

    function setUp() public {
        rec = new PaymentRecord(owner, attester);
    }

    function _ack() internal {
        vm.prank(attester);
        rec.recordAcknowledged(INV, CLIENT, FREELANCER, DUE, 1);
    }

    // ---- constructor ----

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(Attested.ZeroAddress.selector);
        new PaymentRecord(address(0), attester);
        vm.expectRevert(Attested.ZeroAddress.selector);
        new PaymentRecord(owner, address(0));
    }

    // ---- access control ----

    function test_recordAcknowledged_onlyAttester() public {
        vm.prank(rando);
        vm.expectRevert(Attested.NotAttester.selector);
        rec.recordAcknowledged(INV, CLIENT, FREELANCER, DUE, 1);

        // owner is not implicitly an attester
        vm.prank(owner);
        vm.expectRevert(Attested.NotAttester.selector);
        rec.recordAcknowledged(INV, CLIENT, FREELANCER, DUE, 1);
    }

    function test_recordSettled_onlyAttester() public {
        _ack();
        vm.prank(rando);
        vm.expectRevert(Attested.NotAttester.selector);
        rec.recordSettled(INV, DUE - 1);
    }

    function test_recordDispute_onlyAttester() public {
        _ack();
        vm.prank(rando);
        vm.expectRevert(Attested.NotAttester.selector);
        rec.recordDispute(INV, keccak256("resp"));
    }

    function test_setAttester_onlyOwner() public {
        vm.prank(attester);
        vm.expectRevert(Attested.NotOwner.selector);
        rec.setAttester(attester2, true);
    }

    function test_transferOwnership() public {
        vm.prank(rando);
        vm.expectRevert(Attested.NotOwner.selector);
        rec.transferOwnership(rando);

        vm.prank(owner);
        rec.transferOwnership(rando);
        assertEq(rec.owner(), rando);

        vm.prank(owner);
        vm.expectRevert(Attested.NotOwner.selector);
        rec.setAttester(attester2, true);
    }

    // ---- happy path ----

    function test_acknowledgeThenSettle() public {
        vm.expectEmit(true, true, true, true);
        emit PaymentRecord.Acknowledged(INV, CLIENT, FREELANCER, DUE, 1);
        _ack();

        assertTrue(rec.exists(INV));
        PaymentRecord.Entry memory e = rec.getEntry(INV);
        assertEq(e.clientIdHash, CLIENT);
        assertEq(e.freelancerIdHash, FREELANCER);
        assertEq(e.dueDate, DUE);
        assertEq(e.paidAt, 0);
        assertEq(e.amountBand, 1);
        assertFalse(e.disputed);

        vm.expectEmit(true, true, false, true);
        emit PaymentRecord.Settled(INV, CLIENT, DUE + 3 days);
        vm.prank(attester);
        rec.recordSettled(INV, DUE + 3 days);
        assertEq(rec.getEntry(INV).paidAt, DUE + 3 days);
    }

    // ---- duplicate writes / invalid input ----

    function test_duplicateAcknowledge_reverts() public {
        _ack();
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(PaymentRecord.AlreadyRecorded.selector, INV));
        rec.recordAcknowledged(INV, keccak256("other"), FREELANCER, DUE + 1, 2);
    }

    function test_duplicateSettle_reverts() public {
        _ack();
        vm.startPrank(attester);
        rec.recordSettled(INV, DUE);
        vm.expectRevert(abi.encodeWithSelector(PaymentRecord.AlreadySettled.selector, INV));
        rec.recordSettled(INV, DUE + 1);
        vm.stopPrank();
    }

    function test_settleUnknown_reverts() public {
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(PaymentRecord.UnknownInvoice.selector, INV));
        rec.recordSettled(INV, DUE);
    }

    function test_invalidBand_reverts() public {
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(PaymentRecord.InvalidAmountBand.selector, uint8(4)));
        rec.recordAcknowledged(INV, CLIENT, FREELANCER, DUE, 4);
    }

    function test_zeroInputs_revert() public {
        vm.startPrank(attester);
        vm.expectRevert(PaymentRecord.InvalidInput.selector);
        rec.recordAcknowledged(bytes32(0), CLIENT, FREELANCER, DUE, 0);
        vm.expectRevert(PaymentRecord.InvalidInput.selector);
        rec.recordAcknowledged(INV, bytes32(0), FREELANCER, DUE, 0);
        vm.expectRevert(PaymentRecord.InvalidInput.selector);
        rec.recordAcknowledged(INV, CLIENT, FREELANCER, 0, 0);
        rec.recordAcknowledged(INV, CLIENT, FREELANCER, DUE, 0);
        vm.expectRevert(PaymentRecord.InvalidInput.selector);
        rec.recordSettled(INV, 0);
        vm.stopPrank();
    }

    // ---- dispute flow ----

    function test_disputeFlow() public {
        _ack();
        bytes32 resp = keccak256("work was delivered late");

        vm.expectEmit(true, true, false, true);
        emit PaymentRecord.Disputed(INV, CLIENT, resp);
        vm.prank(attester);
        rec.recordDispute(INV, resp);

        PaymentRecord.Entry memory e = rec.getEntry(INV);
        assertTrue(e.disputed);
        assertEq(e.responseHash, resp);

        // cannot dispute twice while open
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(PaymentRecord.AlreadyDisputed.selector, INV));
        rec.recordDispute(INV, keccak256("again"));

        // settlement can still be recorded while disputed (facts stay facts)
        vm.prank(attester);
        rec.recordSettled(INV, DUE + 10 days);

        vm.prank(attester);
        rec.resolveDispute(INV);
        e = rec.getEntry(INV);
        assertFalse(e.disputed);
        assertEq(e.responseHash, resp, "response stays attached after resolution");

        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(PaymentRecord.NotDisputed.selector, INV));
        rec.resolveDispute(INV);
    }

    function test_disputeUnknown_reverts() public {
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(PaymentRecord.UnknownInvoice.selector, INV));
        rec.recordDispute(INV, keccak256("r"));
    }

    function test_disputeZeroResponse_reverts() public {
        _ack();
        vm.prank(attester);
        vm.expectRevert(PaymentRecord.InvalidInput.selector);
        rec.recordDispute(INV, bytes32(0));
    }

    // ---- attester rotation ----

    function test_attesterRotation() public {
        vm.startPrank(owner);
        rec.setAttester(attester2, true);
        rec.setAttester(attester, false);
        vm.stopPrank();

        assertFalse(rec.isAttester(attester));
        assertTrue(rec.isAttester(attester2));

        vm.prank(attester);
        vm.expectRevert(Attested.NotAttester.selector);
        rec.recordAcknowledged(INV, CLIENT, FREELANCER, DUE, 1);

        vm.prank(attester2);
        rec.recordAcknowledged(INV, CLIENT, FREELANCER, DUE, 1);
        assertTrue(rec.exists(INV));
    }

    function test_setAttester_rejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(Attested.ZeroAddress.selector);
        rec.setAttester(address(0), true);
    }

    function testFuzz_bandBounds(uint8 band) public {
        vm.prank(attester);
        if (band > 3) {
            vm.expectRevert(abi.encodeWithSelector(PaymentRecord.InvalidAmountBand.selector, band));
        }
        rec.recordAcknowledged(INV, CLIENT, FREELANCER, DUE, band);
    }
}
