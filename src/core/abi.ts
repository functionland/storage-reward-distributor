/**
 * Minimal ABI fragments for the on-chain calls we make.
 * Keeping these inline (vs importing full ABIs) keeps the bundle small and
 * makes the surface area we depend on explicit.
 */

export const REWARD_ENGINE_ABI = [
  // Online status event — used to discover which txs submitted online status
  // in a time range.
  "event OnlineStatusSubmitted(uint32 indexed poolId, address indexed submitter, uint256 count, uint256 timestamp)",
  // The submission function — we need its signature to decode calldata.
  "function submitOnlineStatusBatchV2(uint32 poolId, bytes32[] calldata peerIds, uint256 timestamp)",
  // Our credit function.
  "function submitStorageRewardsBatch(uint32 poolId, bytes32[] calldata peerIds, uint256 amount, bool isCredit)",
  // Read getters for verification.
  "function getUnclaimedRewards(address account, bytes32 peerId, uint32 poolId) view returns (uint256 unclaimedMining, uint256 unclaimedStorage, uint256 totalUnclaimed)",
  // Storage-rewards submission event we emit — used by the status dashboard.
  "event StorageRewardsSubmitted(uint32 indexed poolId, address indexed submitter, uint256 count, uint256 amount, bool isCredit)",
  // Custom errors we want to catch by name.
  "error MonthlyCapExceeded()",
  "error BatchTooLarge()",
  "error InvalidAmount()",
  "error NotPoolCreator()",
  "error NoRewardsToClaim()",
  "error InvalidPoolId()",
  "error NotPoolMember()",
] as const;

export const STORAGE_POOL_ABI = [
  // For filtering peerIds to actual members.
  "function getPeerIdInfo(uint32 poolId, bytes32 peerId) view returns (address member, uint256 lockedTokens)",
] as const;

export const MULTICALL3_ABI = [
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calldata calls) payable returns (Result[] memory returnData)",
] as const;
