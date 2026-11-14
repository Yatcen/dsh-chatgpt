/**
 * Calling the OpenAI API with a ChatGPT plan grant.
 *
 * Two calls matter here: what this account may use, and running one turn
 * against it. Both send the same bearer token — the plan-usage grant is the
 * credential for listing *and* inference, which is why a listing failure and an
 * inference failure usually mean the same thing.
 *
 * A non-2xx response is turned into an error carrying the endpoint's own code,
 * because the code is what tells the caller whether to retry, re-authorize, or
 * report that the plan cannot be spent: `subscription_sharing_usage_limit_exceeded`
 * and `invalid_api_key` call for three different answers.
 *
 * @module dsh-plugin-chatgpt/client
 */
import { RESOURCE } from "../auth/protocol.js";
import { createSseDecoder, decodeEvent, isPlanUsageCode } from "./events.js";
import { toResponsesBody } from "../convert/request.js";
/** The reason a call failed, in the endpoint's own terms. */
export class ApiError extends Error {
    /** Stable code, when the endpoint supplied one. */
    code;
    /** HTTP status, when the failure was a response rather than a transport fault. */
    status;
    /** Whether the account's plan is the thing refusing, so the human is told to check usage. */
    planUsage;
    /**
     * @param message - what the endpoint reported.
     * @param code - the endpoint's own error code.
     * @param status - HTTP status, when there was one.
     */
    constructor(message, code, status) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.planUsage = isPlanUsageCode(code);
        if (status !== undefined)
            this.status = status;
    }
}
/** Pull a code and message out of an error body without assuming its shape. */
function errorOf(body, status) {
    try {
        const parsed = JSON.parse(body);
        if (typeof parsed === 'object' && parsed !== null) {
            const record = parsed;
            const nested = typeof record['error'] === 'object' && record['error'] !== null
                ? record['error']
                : record;
            const candidate = typeof nested['code'] === 'string'
                ? nested['code']
                : typeof nested['type'] === 'string' ? nested['type'] : `http_${status}`;
            const code = /^[a-z][a-z0-9_]{0,63}$/i.test(candidate) ? candidate : `http_${status}`;
            return new ApiError(`OpenAI request failed (HTTP ${status}, ${code}).`, code, status);
        }
    }
    catch {
        // A non-JSON body says nothing about the code; the status is the fact.
    }
    return new ApiError(`OpenAI request failed (HTTP ${status}).`, `http_${status}`, status);
}
/** Build the headers every call carries. */
function headersFor(accessToken, cacheKey) {
    return {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...cacheKey === undefined ? {} : { session_id: cacheKey },
    };
}
/** The base URL to call, without a trailing slash. */
function baseOf(endpoints) {
    return (endpoints?.baseUrl ?? RESOURCE).replace(/\/+$/, '');
}
/**
 * List the models this account may use.
 *
 * The listing is the authority on entitlement, so nothing here filters by a
 * local list of known models: a model the account can call is offered even when
 * this plugin has no metadata for it.
 *
 * @param accessToken - the plan-usage grant's access token.
 * @param endpoints - endpoint override (tests, gateways).
 * @param signal - cancellation.
 * @returns every listed model, in the server's order.
 */
export async function listModels(accessToken, endpoints, signal) {
    const response = await (endpoints?.fetch ?? fetch)(`${baseOf(endpoints)}/models`, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
        ...signal === undefined ? {} : { signal },
    });
    if (!response.ok) {
        throw errorOf(await response.text().catch(() => ''), response.status);
    }
    const parsed = (await response.json());
    const entries = typeof parsed === 'object' && parsed !== null
        ? parsed['models']
        : undefined;
    if (!Array.isArray(entries))
        return [];
    const models = [];
    for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null)
            continue;
        const record = entry;
        const slug = record['slug'] ?? record['id'];
        if (typeof slug !== 'string' || slug.length === 0)
            continue;
        const displayName = record['display_name'];
        const visibility = record['visibility'];
        if (visibility !== 'list')
            continue;
        const description = record['description'];
        models.push({
            slug,
            ...typeof displayName === 'string' ? { displayName } : {},
            ...typeof visibility === 'string' ? { visibility } : {},
            ...typeof description === 'string' ? { description } : {},
            // The endpoint describes its own models far past the slug and display name
            // the published documentation mentions: capacities, reasoning levels, and
            // modalities all arrive here. Carrying them through is what keeps a model
            // this account can actually call from being described by a guess.
            ...typeof record['context_window'] === 'number' ? { contextWindow: record['context_window'] } : {},
            ...typeof record['max_context_window'] === 'number' ? { maxContextWindow: record['max_context_window'] } : {},
            ...Array.isArray(record['input_modalities'])
                ? { inputModalities: record['input_modalities'].filter((value) => typeof value === 'string') }
                : {},
            ...typeof record['default_reasoning_level'] === 'string'
                ? { defaultReasoningLevel: record['default_reasoning_level'] }
                : {},
            ...Array.isArray(record['supported_reasoning_levels'])
                ? {
                    reasoningLevels: record['supported_reasoning_levels'].flatMap((level) => {
                        if (typeof level !== 'object' || level === null)
                            return [];
                        const effort = level['effort'];
                        if (typeof effort !== 'string')
                            return [];
                        const detail = level['description'];
                        return [{ effort, ...typeof detail === 'string' ? { description: detail } : {} }];
                    }),
                }
                : {},
        });
    }
    return models;
}
/**
 * Run one turn and yield its events as they arrive.
 *
 * The stream is consumed to its terminal event. A stream that ends without one
 * is reported as a failure rather than as a finished turn: the server can close
 * a connection mid-answer, and treating that close as completion is how a
 * truncated answer becomes a plausible-looking wrong one.
 *
 * @param options - the grant, the request, and cancellation.
 * @returns the decoded events, in order, ending with a terminal one.
 */
export async function* streamTurn(options) {
    const body = toResponsesBody(options.request);
    const response = await (options.endpoints?.fetch ?? fetch)(`${baseOf(options.endpoints)}/responses`, {
        method: 'POST',
        headers: headersFor(options.accessToken, body.prompt_cache_key),
        body: JSON.stringify(body),
        ...options.signal === undefined ? {} : { signal: options.signal },
    });
    if (!response.ok) {
        throw errorOf(await response.text().catch(() => ''), response.status);
    }
    if (response.body === null) {
        throw new ApiError('the endpoint returned no response body', 'empty_stream', response.status);
    }
    const decoder = createSseDecoder();
    const reader = response.body.getReader();
    const text = new TextDecoder();
    let terminal = false;
    try {
        while (!terminal) {
            const { done, value } = await reader.read();
            const payloads = done === true
                ? decoder.flush()
                : decoder.push(text.decode(value, { stream: true }));
            for (const payload of payloads) {
                const event = decodeEvent(payload);
                if (event === undefined)
                    continue;
                yield event;
                if (event.kind === 'completed' || event.kind === 'failed' || event.kind === 'incomplete') {
                    terminal = true;
                    break;
                }
            }
            if (done === true)
                break;
        }
    }
    finally {
        // Releasing the reader lets the connection close promptly when a caller
        // stops early rather than draining a stream nobody will read.
        await reader.cancel().catch(() => undefined);
    }
    if (!terminal) {
        throw new ApiError('the response stream ended without a terminal event, so the turn did not finish', 'stream_ended_early');
    }
}
