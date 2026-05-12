/**
 * ChainClient — provider, signer (lazy), and contract instances per chain.
 *
 * Designed so the rest of the codebase doesn't need to know which chain it's
 * talking to except through ChainName.
 */
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  FetchRequest,
} from "ethers";
import {
  CHAINS,
  ChainConfig,
  ChainName,
  getOperatorPrivateKey,
} from "./config.js";
import {
  REWARD_ENGINE_ABI,
  STORAGE_POOL_ABI,
  MULTICALL3_ABI,
} from "./abi.js";
import { RPC_CALL_TIMEOUT_MS } from "./constants.js";

export class ChainClient {
  readonly config: ChainConfig;
  readonly provider: JsonRpcProvider;
  private _signer?: Wallet;
  readonly rewardEngine: Contract; // read-only view
  readonly storagePool: Contract; // read-only view
  readonly multicall3?: Contract;

  constructor(chain: ChainName) {
    this.config = CHAINS[chain];

    const req = new FetchRequest(this.config.rpcUrl);
    req.timeout = RPC_CALL_TIMEOUT_MS;
    this.provider = new JsonRpcProvider(req, this.config.chainId, {
      staticNetwork: true,
    });

    this.rewardEngine = new Contract(
      this.config.rewardEngine,
      REWARD_ENGINE_ABI as unknown as string[],
      this.provider,
    );
    this.storagePool = new Contract(
      this.config.storagePool,
      STORAGE_POOL_ABI as unknown as string[],
      this.provider,
    );
    if (this.config.multicall3) {
      this.multicall3 = new Contract(
        this.config.multicall3,
        MULTICALL3_ABI as unknown as string[],
        this.provider,
      );
    }
  }

  /** Lazily-created signer. Throws if OPERATOR_PRIVATE_KEY is not set. */
  signer(): Wallet {
    if (this._signer) return this._signer;
    const pk = getOperatorPrivateKey();
    if (!pk) {
      throw new Error(
        "OPERATOR_PRIVATE_KEY is not set. Required for on-chain writes. " +
          "Set DRY_RUN=true to skip broadcasts during local testing.",
      );
    }
    const normalized = pk.startsWith("0x") ? pk : `0x${pk}`;
    this._signer = new Wallet(normalized, this.provider);
    return this._signer;
  }

  /** RewardEngine connected to the operator signer (for write calls). */
  rewardEngineForWrite(): Contract {
    return this.rewardEngine.connect(this.signer()) as Contract;
  }
}

/** Singleton clients per chain — created on first access. */
const _clients = new Map<ChainName, ChainClient>();

export function getClient(chain: ChainName): ChainClient {
  let c = _clients.get(chain);
  if (!c) {
    c = new ChainClient(chain);
    _clients.set(chain, c);
  }
  return c;
}

export const CHAIN_NAMES: readonly ChainName[] = ["skale", "base"];
