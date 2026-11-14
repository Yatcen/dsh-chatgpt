/**
 * An ordered conversation for the public SIWC Responses route. Moving tool
 * results behind later messages breaks conversation semantics and cache reuse.
 */
import { DIRECT_TOKEN_SCOPE } from "../auth/protocol.js";
export const STORE = false;
export const STREAM = true;
/** Cache options remain disabled pending route-specific validation. */
export const REFUSED_FIELDS = [
    'background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata',
    'moderation', 'multi_agent', 'prompt', 'previous_response_id', 'prompt_cache_breakpoint',
    'prompt_cache_options', 'prompt_cache_retention', 'safety_identifier', 'temperature',
    'top_logprobs', 'top_p', 'truncation', 'user',
];
function textOf(content) {
    return typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('');
}
/** Preserve message and assistant-block order; instruction roles stay in place. */
export function toResponsesBody(request) {
    const input = [];
    const leadingRole = request.messages[0]?.role;
    if (request.system && leadingRole !== 'system' && leadingRole !== 'developer') {
        input.push({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: request.system }] });
    }
    for (const message of request.messages) {
        if (message.role === 'assistant' && message.replay !== undefined) {
            // Stream fragments may omit summary; the Responses input shape requires
            // the array even when reasoning is carried solely by encrypted_content.
            input.push(...structuredClone(message.replay).map(item => item.type === 'reasoning' && item['summary'] === undefined
                ? { ...item, summary: [] } : item));
            continue;
        }
        if (message.role === 'tool') {
            if (message.toolCallId === undefined)
                continue;
            const output = textOf(message.content);
            input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.isError ? `Error: ${output}` : output });
            continue;
        }
        const role = message.role === 'system' ? 'developer' : message.role;
        const parts = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
        let content = [];
        const flush = () => {
            if (content.length > 0)
                input.push({ type: 'message', role, content });
            content = [];
        };
        for (const part of parts) {
            if (part.type === 'tool-call') {
                if (role !== 'assistant')
                    continue;
                flush();
                input.push({ type: 'function_call', call_id: part.id, name: part.name,
                    namespace: 'dsh', arguments: part.arguments });
            }
            else if (part.type === 'text') {
                if (part.text.length > 0)
                    content.push({ type: role === 'assistant' ? 'output_text' : 'input_text', text: part.text });
            }
            else if (role === 'user') {
                content.push({ type: 'input_image', image_url: part.url });
            }
        }
        flush();
    }
    return {
        model: request.model, input, stream: STREAM, store: STORE,
        ...request.cacheKey === undefined ? {} : { prompt_cache_key: request.cacheKey },
        ...request.tools?.length ? {
            tools: [{
                type: 'namespace', name: 'dsh', description: 'Tools available in DeepSeek Harness.',
                tools: request.tools.map(tool => ({
                    type: 'function', name: tool.name, description: tool.description,
                    parameters: tool.parameters, strict: false,
                })),
            }],
        } : {},
        ...request.reasoningEffort === undefined ? {} : {
            reasoning: { effort: request.reasoningEffort, summary: 'concise' }, include: ['reasoning.encrypted_content'],
        },
    };
}
export { DIRECT_TOKEN_SCOPE };
