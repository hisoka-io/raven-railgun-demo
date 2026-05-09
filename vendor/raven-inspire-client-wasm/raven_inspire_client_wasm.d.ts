/* tslint:disable */
/* eslint-disable */

/**
 * Opaque handle to an active [`ClientSession`] held inside Wasm
 * memory.
 *
 * Constructed via [`build_client_session`]. The session owns the
 * precomputed InspiRING packing keys (the heavy O(d^3) one-time work)
 * and the wallet's RLWE secret key. The handle is single-threaded and
 * `!Send` to JS callers; consumers should hold one per worker.
 */
export class ClientSessionHandle {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
}

/**
 * Construct a [`ClientSessionHandle`] from the operator-side
 * instance parameters bundle (an [`WasmInstanceParamsBundle`]
 * bincode blob produced by [`build_instance_params_blob`]) and the
 * public CRS bincode blob (returned in
 * `raven_railgun_http::InstanceParams::crs_bincode`).
 *
 * Pays the one-time O(d^3) automorph-table + packing-key generation
 * cost. Subsequent [`build_seeded_query`] calls reuse the cached
 * keys.
 */
export function build_client_session(params_bundle_bincode: Uint8Array, crs_bincode: Uint8Array): ClientSessionHandle;

/**
 * Build a fresh client secret key + emit the [`WasmInstanceParamsBundle`]
 * bincode blob the SDK passes to [`build_client_session`].
 *
 * `inspire_params_bincode` is the operator-side `InspireParams`
 * bincode, distinct from the CRS. The wallet learns the params
 * either via a side-channel (config) or from the operator metadata.
 * The shipped raven-railgun-http currently only ships CRS +
 * ShardConfig over `/v1/instance/:id/params`; this helper accepts
 * `inspire_params_bincode` as a separate input so the SDK can
 * aggregate them once at boot.
 *
 * Returns a `Uint8Array` carrying the bincode'd
 * [`WasmInstanceParamsBundle`].
 */
export function build_instance_params_blob(inspire_params_bincode: Uint8Array, shard_config_bincode: Uint8Array): Uint8Array;

/**
 * Build a seeded PIR query for `target_idx` against the row layout
 * described by `shard_config_bincode`.
 *
 * Forces `PackingMode::Inspiring` to match the production server
 * stack (raven-railgun-engine's `RavenInspireScheme::respond` uses
 * `respond_seeded_inspiring_cached_with_session`).
 *
 * Returns a JS `Uint8Array` carrying the bincode of a
 * [`WasmSeededQueryOutput`] tuple. The caller should
 * [`bincode::deserialize`] the bytes (or use the typed
 * [`WasmSeededQueryOutput::decode`] helper) to recover the
 * `client_state_bincode` (kept locally) + `query_bytes` (POSTed to
 * the server).
 */
export function build_seeded_query(session: ClientSessionHandle, shard_config_bincode: Uint8Array, target_idx: bigint): Uint8Array;

/**
 * Reconstitute a [`ClientSessionHandle`] from a previously
 * serialized session blob plus the same [`WasmInstanceParamsBundle`]
 * + CRS bytes [`build_client_session`] consumed.
 *
 * Cheap path: no automorph-table search, no packing-key generation.
 * Decodes the cached `ClientSession` directly and re-attaches the
 * cached `InspireParams` so subsequent [`build_seeded_query`] calls
 * behave identically to a session built from scratch.
 *
 * Validates the params bundle's `InspireParams` against the
 * session's CRS at deserialize time so a CRS-rotation mismatch
 * surfaces as a typed `InstanceParamsDrift` error rather than a
 * silently wrong query later.
 */
export function deserialize_client_session(params_bundle_bincode: Uint8Array, crs_bincode: Uint8Array, session_bincode: Uint8Array): ClientSessionHandle;

/**
 * Decode a server response and return the plaintext row bytes.
 *
 * All inputs are bincode blobs the SDK already holds:
 * - `session`: the [`ClientSessionHandle`] that emitted the matching query
 * - `crs_bincode`: from `InstanceParams::crs_bincode`
 * - `client_state_bincode`: from [`build_seeded_query`] output
 * - `response_bytes`: from the server's `POST /v1/instance/:id/query` reply
 * - `entry_size`: from `InstanceParams::entry_size`
 *
 * Dispatches through [`extract_inspiring`] (no d-scaling, matches
 * the production `respond_seeded_inspiring_cached_with_session`
 * server path).
 *
 * `client_state_bincode` is the bincode emitted by
 * [`build_seeded_query`]. Upstream `raven_inspire::ClientState`
 * marks both `secret_key` (LWE) and `rlwe_secret_key` (RLWE) with
 * `#[serde(skip, default)]` so secret material never crosses a
 * serialization boundary by accident. The skip means a bincode
 * round-trip yields a `ClientState` whose secret keys are
 * `Default::default()` polynomials with empty `moduli` vectors;
 * passing that to `extract_inspiring` panics inside
 * `Poly::mul_ntt` (`Moduli must match`, raven-inspire poly.rs:578)
 * because the ciphertext polynomial carries the live single-modulus
 * shape but the default-built secret-key polynomial does not. The
 * native parity tests do not surface this because they hold the
 * `ClientState` Rust value in process and never bincode round-trip
 * it; only the WASM boundary forces the trip. Fix: rehydrate the
 * stripped secret keys from the in-WASM-memory session, which owns
 * the live RLWE/LWE keys, before calling the extractor. The fix is
 * lossless: `(state.index, state.shard_id, state.local_index)` are
 * the only non-skip fields and they already round-trip cleanly.
 */
export function extract_response(session: ClientSessionHandle, crs_bincode: Uint8Array, client_state_bincode: Uint8Array, response_bytes: Uint8Array, entry_size: number): Uint8Array;

/**
 * Install the [`console_error_panic_hook`] so Rust panics inside the
 * WASM module surface as structured JS exceptions
 * (`Error: panicked at '<msg>', <file>:<line>`) instead of opaque
 * `RuntimeError: unreachable executed` traps that erase all
 * diagnostic context.
 *
 * SDKs MUST call this once at module load before invoking any other
 * function in this crate. Idempotent: subsequent calls are no-ops
 * (the hook installer guards against multiple installs internally).
 *
 * Safety net only: every documented surface in this crate returns
 * `Result<_, JsValue>` for malformed inputs; the hook covers
 * pathological cases where raven-inspire's runtime hits a
 * panic-asserting invariant (e.g. polynomial-coefficient indexing
 * past the underlying ring dimension when a malformed
 * `ServerResponse` is paired with an inflated `entry_size`).
 */
export function init_panic_hook(): void;

/**
 * Compute the 16 flat-global row indices needed to reconstruct a Merkle
 * auth path for `leaf_idx` against a single commitment tree, encoded by
 * the server-side `PerNodeEncoder`.
 *
 * The returned `Vec<u32>` has length `TREE_DEPTH = 16` and is indexed by
 * level (level 0 = sibling of the leaf; last entry = sibling at the level
 * just below the root). The wallet POSTs one PIR query per index to
 * `POST /v1/instance/<commit-tree-N>/batch` and reconstructs the path
 * locally.
 *
 * Pure function; deterministic; no I/O. Validates `leaf_idx <
 * 2^TREE_DEPTH` so a wallet bug surfaces as a typed error rather than as
 * a wraparound that quietly queries a wrong row.
 */
export function path_indices_for_leaf(tree_number: number, leaf_idx: number): Uint32Array;

/**
 * Compute the 16 flat-global row indices needed to reconstruct a Merkle
 * auth path for the per-list PPOI leaf at `idx`, encoded by the
 * server-side `PerListNodeEncoder`.
 *
 * Mirror of [`path_indices_for_leaf`] keyed on `list_key` rather than
 * `tree_number`. Validates `list_key.len() == 32` so a wrong-shape input
 * surfaces as a typed error before any layout math runs.
 */
export function path_indices_for_per_list_leaf(list_key: Uint8Array, idx: number): Uint32Array;

/**
 * Imprint operator-side instance parameters on this client session.
 *
 * Preserved for API symmetry with the Rust adapter's
 * `register_client_session(session, &InspireServerState)`. The
 * browser/Node wallet does not own a [`raven_inspire::ServerSessionStore`]
 * (the store is server-side state) and the upstream
 * `raven_inspire::ClientSession` does not expose a public setter for
 * its `session_handle`. As a result, the Wasm boundary always emits
 * queries with the InspiRING packing keys inlined; the server's
 * `respond_inspiring_cached_with_session` resolves correctness in
 * both inline-keys and handle-referenced paths. The ~48 KiB
 * per-query wire-size compression that the handle path enables in
 * the Rust adapter is unavailable here without an upstream setter.
 *
 * This call validates that the supplied `instance_params_bincode`
 * decodes into a [`WasmInstanceParamsBundle`] whose CRS-side params
 * match what the session was built against (catching CRS / params
 * drift at session-bind time rather than at first query).
 */
export function register_client_session(session: ClientSessionHandle, instance_params_bincode: Uint8Array): void;

/**
 * Serialize a fully constructed [`ClientSessionHandle`] to a
 * bincode blob that can be persisted across browser tabs / page
 * reloads / process boundaries.
 *
 * Pairs with [`deserialize_client_session`] to amortise the heavy
 * O(d^3) automorph-table + packing-key generation that
 * [`build_client_session`] runs (~12.6 s for the production-cell
 * d=2048 params). The SDK persists the blob to IndexedDB keyed by
 * `(instanceId, sha256(crsBincode))`; on subsequent loads it
 * reconstitutes the session via [`deserialize_client_session`] in
 * milliseconds rather than re-running the cold path.
 *
 * Wire shape: `bincode::serialize(&ClientSession)`. The
 * `InspireParams` cached on the handle are NOT included in the
 * session blob — they are recovered by re-decoding the params
 * bundle at deserialize time, so the cached blob is keyed only on
 * CRS material.
 */
export function serialize_client_session(session: ClientSessionHandle): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_clientsessionhandle_free: (a: number, b: number) => void;
    readonly build_client_session: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly build_instance_params_blob: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly build_seeded_query: (a: number, b: number, c: number, d: number, e: bigint) => void;
    readonly deserialize_client_session: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly extract_response: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly init_panic_hook: () => void;
    readonly path_indices_for_leaf: (a: number, b: number, c: number) => void;
    readonly path_indices_for_per_list_leaf: (a: number, b: number, c: number, d: number) => void;
    readonly register_client_session: (a: number, b: number, c: number, d: number) => void;
    readonly serialize_client_session: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export3: (a: number, b: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
