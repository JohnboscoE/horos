import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const paymentRecordAbi = parseAbi([
  "function recordAcknowledged(bytes32 invoiceHash, bytes32 clientIdHash, bytes32 freelancerIdHash, uint64 dueDate, uint8 amountBand)",
  "function recordSettled(bytes32 invoiceHash, uint64 paidAt)",
  "function recordDispute(bytes32 invoiceHash, bytes32 responseHash)",
  "function resolveDispute(bytes32 invoiceHash)",
  "function exists(bytes32 invoiceHash) view returns (bool)",
  "error AlreadyRecorded(bytes32 invoiceHash)",
  "error AlreadySettled(bytes32 invoiceHash)",
  "error AlreadyDisputed(bytes32 invoiceHash)",
  "error NotDisputed(bytes32 invoiceHash)",
  "error UnknownInvoice(bytes32 invoiceHash)",
  "error NotAttester()",
]);

export const decisionAnchorAbi = parseAbi([
  "function anchor(bytes32 chainHead, uint256 count)",
  "function latest() view returns ((bytes32 chainHead, uint256 count, uint64 anchoredAt))",
  "error CountNotIncreasing(uint256 previous, uint256 given)",
  "error NotAttester()",
]);
