/* @ts-self-types="./raven_inspire_client_wasm.d.ts" */

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
    static __wrap(ptr) {
        const obj = Object.create(ClientSessionHandle.prototype);
        obj.__wbg_ptr = ptr;
        ClientSessionHandleFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ClientSessionHandleFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_clientsessionhandle_free(ptr, 0);
    }
}
if (Symbol.dispose) ClientSessionHandle.prototype[Symbol.dispose] = ClientSessionHandle.prototype.free;

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
 * @param {Uint8Array} params_bundle_bincode
 * @param {Uint8Array} crs_bincode
 * @returns {ClientSessionHandle}
 */
export function build_client_session(params_bundle_bincode, crs_bincode) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(params_bundle_bincode, wasm.__wbindgen_export3);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(crs_bincode, wasm.__wbindgen_export3);
        const len1 = WASM_VECTOR_LEN;
        wasm.build_client_session(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return ClientSessionHandle.__wrap(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

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
 * @param {Uint8Array} inspire_params_bincode
 * @param {Uint8Array} shard_config_bincode
 * @returns {Uint8Array}
 */
export function build_instance_params_blob(inspire_params_bincode, shard_config_bincode) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(inspire_params_bincode, wasm.__wbindgen_export3);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(shard_config_bincode, wasm.__wbindgen_export3);
        const len1 = WASM_VECTOR_LEN;
        wasm.build_instance_params_blob(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export2(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

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
 * @param {ClientSessionHandle} session
 * @param {Uint8Array} shard_config_bincode
 * @param {bigint} target_idx
 * @returns {Uint8Array}
 */
export function build_seeded_query(session, shard_config_bincode, target_idx) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        _assertClass(session, ClientSessionHandle);
        const ptr0 = passArray8ToWasm0(shard_config_bincode, wasm.__wbindgen_export3);
        const len0 = WASM_VECTOR_LEN;
        wasm.build_seeded_query(retptr, session.__wbg_ptr, ptr0, len0, target_idx);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export2(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

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
 * @param {Uint8Array} params_bundle_bincode
 * @param {Uint8Array} crs_bincode
 * @param {Uint8Array} session_bincode
 * @returns {ClientSessionHandle}
 */
export function deserialize_client_session(params_bundle_bincode, crs_bincode, session_bincode) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(params_bundle_bincode, wasm.__wbindgen_export3);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(crs_bincode, wasm.__wbindgen_export3);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(session_bincode, wasm.__wbindgen_export3);
        const len2 = WASM_VECTOR_LEN;
        wasm.deserialize_client_session(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return ClientSessionHandle.__wrap(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

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
 * @param {ClientSessionHandle} session
 * @param {Uint8Array} crs_bincode
 * @param {Uint8Array} client_state_bincode
 * @param {Uint8Array} response_bytes
 * @param {number} entry_size
 * @returns {Uint8Array}
 */
export function extract_response(session, crs_bincode, client_state_bincode, response_bytes, entry_size) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        _assertClass(session, ClientSessionHandle);
        const ptr0 = passArray8ToWasm0(crs_bincode, wasm.__wbindgen_export3);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(client_state_bincode, wasm.__wbindgen_export3);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(response_bytes, wasm.__wbindgen_export3);
        const len2 = WASM_VECTOR_LEN;
        wasm.extract_response(retptr, session.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, entry_size);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v4 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export2(r0, r1 * 1, 1);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

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
export function init_panic_hook() {
    wasm.init_panic_hook();
}

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
 * @param {number} tree_number
 * @param {number} leaf_idx
 * @returns {Uint32Array}
 */
export function path_indices_for_leaf(tree_number, leaf_idx) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.path_indices_for_leaf(retptr, tree_number, leaf_idx);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v1 = getArrayU32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export2(r0, r1 * 4, 4);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Compute the 16 flat-global row indices needed to reconstruct a Merkle
 * auth path for the per-list PPOI leaf at `idx`, encoded by the
 * server-side `PerListNodeEncoder`.
 *
 * Mirror of [`path_indices_for_leaf`] keyed on `list_key` rather than
 * `tree_number`. Validates `list_key.len() == 32` so a wrong-shape input
 * surfaces as a typed error before any layout math runs.
 * @param {Uint8Array} list_key
 * @param {number} idx
 * @returns {Uint32Array}
 */
export function path_indices_for_per_list_leaf(list_key, idx) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(list_key, wasm.__wbindgen_export3);
        const len0 = WASM_VECTOR_LEN;
        wasm.path_indices_for_per_list_leaf(retptr, ptr0, len0, idx);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v2 = getArrayU32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export2(r0, r1 * 4, 4);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

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
 * @param {ClientSessionHandle} session
 * @param {Uint8Array} instance_params_bincode
 */
export function register_client_session(session, instance_params_bincode) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        _assertClass(session, ClientSessionHandle);
        const ptr0 = passArray8ToWasm0(instance_params_bincode, wasm.__wbindgen_export3);
        const len0 = WASM_VECTOR_LEN;
        wasm.register_client_session(retptr, session.__wbg_ptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

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
 * @param {ClientSessionHandle} session
 * @returns {Uint8Array}
 */
export function serialize_client_session(session) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        _assertClass(session, ClientSessionHandle);
        wasm.serialize_client_session(retptr, session.__wbg_ptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v1 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export2(r0, r1 * 1, 1);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_function_2f0fd7ceb86e64c5: function(arg0) {
            const ret = typeof(getObject(arg0)) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_5b22ff2418063a9c: function(arg0) {
            const val = getObject(arg0);
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_eddc07a3efad52e6: function(arg0) {
            const ret = typeof(getObject(arg0)) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_244a92c34d3b6ec0: function(arg0) {
            const ret = getObject(arg0) === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_9c75d47bf9e7731e: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_a41d6421b30a32c5: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_crypto_38df2bab126b63dc: function(arg0) {
            const ret = getObject(arg0).crypto;
            return addHeapObject(ret);
        },
        __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_export2(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
            getObject(arg0).getRandomValues(getObject(arg1));
        }, arguments); },
        __wbg_length_ba3c032602efe310: function(arg0) {
            const ret = getObject(arg0).length;
            return ret;
        },
        __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
            const ret = getObject(arg0).msCrypto;
            return addHeapObject(ret);
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return addHeapObject(ret);
        },
        __wbg_new_with_length_9011f5da794bf5d9: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return addHeapObject(ret);
        },
        __wbg_node_84ea875411254db1: function(arg0) {
            const ret = getObject(arg0).node;
            return addHeapObject(ret);
        },
        __wbg_process_44c7a14e11e9f69e: function(arg0) {
            const ret = getObject(arg0).process;
            return addHeapObject(ret);
        },
        __wbg_prototypesetcall_fd4050e806e1d519: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), getObject(arg2));
        },
        __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
            getObject(arg0).randomFillSync(takeObject(arg1));
        }, arguments); },
        __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
            const ret = module.require;
            return addHeapObject(ret);
        }, arguments); },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = getObject(arg1).stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_static_accessor_GLOBAL_THIS_1c7f1bd6c6941fdb: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_GLOBAL_e039bc914f83e74e: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_SELF_8bf8c48c28420ad5: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_WINDOW_6aeee9b51652ee0f: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_subarray_fbe3cef290e1fa43: function(arg0, arg1, arg2) {
            const ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0);
            return addHeapObject(ret);
        },
        __wbg_versions_276b2795b1c6a219: function(arg0) {
            const ret = getObject(arg0).versions;
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
        __wbindgen_object_clone_ref: function(arg0) {
            const ret = getObject(arg0);
            return addHeapObject(ret);
        },
        __wbindgen_object_drop_ref: function(arg0) {
            takeObject(arg0);
        },
    };
    return {
        __proto__: null,
        "./raven_inspire_client_wasm_bg.js": import0,
    };
}

const ClientSessionHandleFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_clientsessionhandle_free(ptr, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm.__wbindgen_export(addHeapObject(e));
    }
}

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('raven_inspire_client_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
