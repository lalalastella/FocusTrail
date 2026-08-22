/**
 * Unified Gemma inference provider.
 * Priority: Ollama (local) → Google AI Studio API (cloud) → null (caller handles fallback)
 *
 * Tracks cloud call count for PrivacySurface INV-2 audit.
 */

import http from 'node:http';
import https from 'node:https';

export let cloudCallCount = 0;
let lastGoogleError = null;

// ─── Provider detection ──────────────────────────────────────────────────────

let _ollamaAvailable = null;
let _ollamaCheckedAt = 0;
const OLLAMA_CACHE_MS = 30_000;
const CODE_PATHS = {
  route: 'server/gemmaProvider.js:inferText',
  ollamaText: 'server/gemmaProvider.js:inferViaOllama',
  ollamaClassify: 'server/gemmaProvider.js:classifyViaOllama',
  googleText: 'server/gemmaProvider.js:inferViaGoogleAPI',
  googleClassify: 'server/gemmaProvider.js:classifyViaGoogleAPI',
};

function writeProviderLog(logger, level, event, payload = {}) {
  if (typeof logger !== 'function') return;
  logger(level, event, payload);
}

export async function isOllamaAvailable() {
  const now = Date.now();
  if (_ollamaAvailable !== null && now - _ollamaCheckedAt < OLLAMA_CACHE_MS) {
    return _ollamaAvailable;
  }
  const ollamaBase = process.env.GEMMA_OLLAMA_URL || 'http://localhost:11434';
  try {
    const tags = await httpGetJson(`${ollamaBase}/api/tags`, 4000);
    const models = (tags?.models || []).map((m) => String(m?.name || '').toLowerCase());
    _ollamaAvailable = models.length > 0;
  } catch {
    _ollamaAvailable = false;
  }
  _ollamaCheckedAt = now;
  return _ollamaAvailable;
}

export async function getOllamaModelName() {
  const ollamaBase = process.env.GEMMA_OLLAMA_URL || 'http://localhost:11434';
  const preferred = (process.env.GEMMA_OLLAMA_MODEL || '').trim();
  try {
    const tags = await httpGetJson(`${ollamaBase}/api/tags`, 4000);
    const names = (tags?.models || []).map((m) => String(m?.name || '').toLowerCase());
    if (preferred && names.some((n) => n.startsWith(preferred.toLowerCase()))) return preferred;
    // prefer gemma4 > gemma3 > gemma2 > gemma
    const priorities = ['gemma4', 'gemma3', 'gemma2', 'gemma'];
    for (const prefix of priorities) {
      const match = names.find((n) => n.startsWith(prefix));
      if (match) return match;
    }
    return names[0] || 'gemma3:2b';
  } catch {
    return preferred || 'gemma3:2b';
  }
}

export function hasGoogleApiKey() {
  return Boolean((process.env.GOOGLE_API_KEY || '').trim());
}

export function getGoogleModelName() {
  return (process.env.GOOGLE_GEMMA_MODEL || 'gemma-4-26b-a4b-it').trim();
}

export function getProviderInfo() {
  return {
    cloudCallCount,
    hasGoogleKey: hasGoogleApiKey(),
    googleModel: getGoogleModelName(),
    lastGoogleError,
    ollamaUrl: process.env.GEMMA_OLLAMA_URL || 'http://localhost:11434',
    ollamaModel: (process.env.GEMMA_OLLAMA_MODEL || '').trim() || 'auto-detect',
    runtimePriority: ['gemma-ollama', 'google-ai-studio', 'local-transformers', 'local-rules'],
  };
}

// ─── Focus classification via Gemma (FN-4) ───────────────────────────────────

/**
 * Classify a desktop activity event using Gemma (FN-4).
 * Returns null if no AI provider is available (caller uses rule fallback).
 */
export async function classifyActivityWithGemma(event, activeTaskSummary) {
  const prompt = buildClassifyPrompt(event, activeTaskSummary);

  if (await isOllamaAvailable()) {
    try {
      return await classifyViaOllama(prompt, event, activeTaskSummary);
    } catch (err) {
      console.error('[gemma.ollama.classify.failed]', err.message);
    }
  }

  if (hasGoogleApiKey()) {
    try {
      return await classifyViaGoogleAPI(prompt, event, activeTaskSummary);
    } catch (err) {
      console.error('[gemma.google.classify.failed]', err.message);
    }
  }

  return null;
}

// ─── Text inference (for breakdown) ──────────────────────────────────────────

/**
 * Run a text-only prompt through Gemma. Returns { text, meta } or null.
 */
export async function inferText(prompt, { maxTokens = 512, requestId = '', operation = '', logger = null, signal } = {}) {
  const routeStartedAt = Date.now();
  const baseLog = {
    requestId,
    operation,
    maxTokens,
    promptChars: typeof prompt === 'string' ? prompt.length : 0,
    codePath: CODE_PATHS.route,
  };

  writeProviderLog(logger, 'info', 'gemma.provider.route.start', {
    ...baseLog,
    summary: `${operation || 'text-inference'} provider route started.`,
    candidateOrder: ['gemma-ollama', 'google-ai-studio'],
  });

  const ollamaReady = await isOllamaAvailable();
  if (ollamaReady) {
    try {
      const result = await inferViaOllama(prompt, maxTokens, requestId, operation, logger, signal);
      if (result?.text?.trim()) {
        writeProviderLog(logger, 'info', 'gemma.provider.route.success', {
          ...baseLog,
          summary: `${operation || 'text-inference'} completed via Ollama.`,
          provider: result.meta?.provider || 'gemma-ollama',
          model: result.meta?.model || null,
          source: result.meta?.source || 'local-ollama-http',
          latencyMs: Date.now() - routeStartedAt,
        });
        return result;
      }
      writeProviderLog(logger, 'info', 'gemma.provider.ollama.empty', {
        ...baseLog,
        summary: 'Ollama returned empty text; trying Google AI Studio if configured.',
        provider: 'gemma-ollama',
        source: 'local-ollama-http',
        ollamaUrl: process.env.GEMMA_OLLAMA_URL || 'http://localhost:11434',
      });
      console.warn('[gemma.ollama.infer.empty]', requestId, 'Ollama returned empty text, trying Google API');
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      writeProviderLog(logger, 'error', 'gemma.provider.ollama.failed', {
        ...baseLog,
        message: 'Ollama text inference failed; trying Google AI Studio if configured.',
        provider: 'gemma-ollama',
        source: 'local-ollama-http',
        error: err.message,
      });
      console.error('[gemma.ollama.infer.failed]', requestId, err.message);
    }
  } else {
    writeProviderLog(logger, 'info', 'gemma.provider.ollama.skipped', {
      ...baseLog,
      summary: 'Ollama is not available for this request.',
      provider: 'gemma-ollama',
      source: 'local-ollama-http',
      ollamaUrl: process.env.GEMMA_OLLAMA_URL || 'http://localhost:11434',
    });
  }

  if (hasGoogleApiKey()) {
    try {
      const result = await inferViaGoogleAPI(prompt, maxTokens, requestId, operation, logger, signal);
      lastGoogleError = null;
      writeProviderLog(logger, 'info', 'gemma.provider.route.success', {
        ...baseLog,
        summary: `${operation || 'text-inference'} completed via Google AI Studio.`,
        provider: result.meta?.provider || 'google-ai-studio',
        model: result.meta?.model || null,
        source: result.meta?.source || 'google-ai-studio-api',
        latencyMs: Date.now() - routeStartedAt,
      });
      return result;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastGoogleError = String(err.message || 'Unknown Google AI Studio error').slice(0, 500);
      writeProviderLog(logger, 'error', 'gemma.provider.google.failed', {
        ...baseLog,
        message: 'Google AI Studio text inference failed.',
        provider: 'google-ai-studio',
        source: 'google-ai-studio-api',
        error: err.message,
      });
      console.error('[gemma.google.infer.failed]', requestId, err.message);
    }
  } else {
    writeProviderLog(logger, 'info', 'gemma.provider.google.skipped', {
      ...baseLog,
      summary: 'Google AI Studio is not configured for this request.',
      provider: 'google-ai-studio',
      source: 'google-ai-studio-api',
      hasGoogleKey: false,
    });
  }

  writeProviderLog(logger, 'info', 'gemma.provider.route.none', {
    ...baseLog,
    summary: `${operation || 'text-inference'} did not complete via provider route; caller may try local Transformers or rules fallback.`,
    candidateOrder: ['gemma-ollama', 'google-ai-studio'],
    latencyMs: Date.now() - routeStartedAt,
  });

  return null;
}

// ─── Ollama inference ─────────────────────────────────────────────────────────

// Ollama uses OpenAI-compatible tool format (lowercase types, "function" wrapper)
const CLASSIFY_TOOL_OLLAMA = {
  type: 'function',
  function: {
    name: 'classify_activity',
    description: 'Classify a desktop monitor event relative to the active learning task. Context-sensitive: the same window or app can be focus OR distraction depending on what the user is working on.',
    parameters: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          enum: ['focus', 'helpful', 'neutral', 'distraction'],
          description: 'focus=directly on task; helpful=supports task; neutral=unrelated but not harmful; distraction=off-task',
        },
        confidence: { type: 'number', description: 'confidence 0-1' },
        reason: { type: 'string', description: 'Brief human-readable explanation referencing the active task' },
        suggestedAction: {
          type: 'string',
          enum: ['continue', 'return_to_task', 'start_2_min_reset', 'ask_user'],
        },
      },
      required: ['label', 'confidence', 'reason', 'suggestedAction'],
    },
  },
};

async function classifyViaOllama(prompt, event, taskSummary) {
  const ollamaBase = process.env.GEMMA_OLLAMA_URL || 'http://localhost:11434';
  const model = await getOllamaModelName();

  // Try chat API with native tool calling first
  try {
    const chatBody = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '/no_think' },
        { role: 'user', content: prompt },
      ],
      tools: [CLASSIFY_TOOL_OLLAMA],
      stream: false,
      think: false,
      options: { temperature: 0, num_predict: 512 },
    });

    const raw = await httpPost(`${ollamaBase}/api/chat`, chatBody, 60_000);
    const parsed = JSON.parse(raw);

    const toolCall = parsed?.message?.tool_calls?.[0];
    if (toolCall?.function?.name === 'classify_activity') {
      const rawArgs = toolCall.function.arguments;
      const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
      return {
        label: args.label || 'neutral',
        confidence: Math.min(1, Math.max(0, Number(args.confidence) || 0.7)),
        reason: args.reason || '',
        suggestedAction: args.suggestedAction || 'continue',
        method: 'gemma-fn-call',
        toolCallsUsed: ['FN-4'],
        provider: 'gemma-ollama',
        model,
        local: true,
      };
    }

    // Chat returned text — try parsing JSON from the response
    const responseText = parsed?.message?.content || '';
    if (responseText.trim()) {
      const result = parseClassifyJson(responseText, 'gemma-ollama', model);
      if (result.method !== 'gemma-json-fallback' || result.label !== 'neutral') return result;
    }
  } catch (err) {
    console.warn('[gemma.ollama.chat.failed]', err.message, '— falling back to generate API');
  }

  // Fallback: use /api/generate with a structured JSON prompt (more reliable for small models)
  const jsonPrompt = buildClassifyJsonPrompt(event, taskSummary);
  const genBody = JSON.stringify({
    model,
    prompt: jsonPrompt,
    stream: false,
    format: 'json',
    think: false,
    options: { temperature: 0, num_predict: 256 },
  });

  const genRaw = await httpPost(`${ollamaBase}/api/generate`, genBody, 90_000);
  const genParsed = JSON.parse(genRaw);
  const genText = genParsed?.response || '';
  return parseClassifyJson(genText, 'gemma-ollama', model);
}

async function inferViaOllama(prompt, maxTokens, requestId, operation, logger = null, signal) {
  const ollamaBase = process.env.GEMMA_OLLAMA_URL || 'http://localhost:11434';
  const model = await getOllamaModelName();
  const startedAt = Date.now();

  writeProviderLog(logger, 'info', 'gemma.provider.ollama.start', {
    requestId,
    operation,
    summary: `${operation || 'text-inference'} attempting Ollama text inference.`,
    provider: 'gemma-ollama',
    source: 'local-ollama-http',
    codePath: CODE_PATHS.ollamaText,
    endpoint: `${ollamaBase}/api/generate`,
    model,
    maxTokens,
    think: false,
  });

  const body = JSON.stringify({
    model,
    prompt,
    stream: false,
    think: false,
    options: { temperature: 0, num_predict: maxTokens },
  });

  const raw = await httpPost(`${ollamaBase}/api/generate`, body, 120_000, signal);
  const parsed = JSON.parse(raw);
  const text = parsed?.response || '';

  writeProviderLog(logger, 'info', 'gemma.provider.ollama.response', {
    requestId,
    operation,
    summary: `${operation || 'text-inference'} received Ollama response.`,
    provider: 'gemma-ollama',
    source: 'local-ollama-http',
    codePath: CODE_PATHS.ollamaText,
    endpoint: `${ollamaBase}/api/generate`,
    model,
    responseChars: text.length,
    doneReason: parsed?.done_reason || null,
    promptEvalCount: parsed?.prompt_eval_count ?? null,
    evalCount: parsed?.eval_count ?? null,
    latencyMs: Date.now() - startedAt,
  });

  return {
    text,
    meta: {
      provider: 'gemma-ollama',
      model,
      local: true,
      source: 'local-ollama-http',
      codePath: CODE_PATHS.ollamaText,
      endpoint: `${ollamaBase}/api/generate`,
      fallbackUsed: false,
      toolCallsUsed: [],
      requestId,
    },
  };
}

// ─── Google AI Studio API ────────────────────────────────────────────────────

const CLASSIFY_TOOL = {
  functionDeclarations: [
    {
      name: 'classify_activity',
      description: 'Classify a desktop monitor event relative to the active learning task. Context-sensitive: the same window or app can be focus OR distraction depending on what the user is working on.',
      parameters: {
        type: 'OBJECT',
        properties: {
          label: {
            type: 'STRING',
            enum: ['focus', 'helpful', 'neutral', 'distraction'],
            description: 'focus=directly on task; helpful=supports task; neutral=unrelated but not harmful; distraction=off-task',
          },
          confidence: { type: 'NUMBER', description: 'confidence 0-1' },
          reason: { type: 'STRING', description: 'Brief human-readable explanation referencing the active task' },
          suggestedAction: {
            type: 'STRING',
            enum: ['continue', 'return_to_task', 'start_2_min_reset', 'ask_user'],
          },
        },
        required: ['label', 'confidence', 'reason', 'suggestedAction'],
      },
    },
  ],
};

async function classifyViaGoogleAPI(prompt, event, taskSummary) {
  cloudCallCount += 1;
  const apiKey = process.env.GOOGLE_API_KEY;
  const model = getGoogleModelName();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [CLASSIFY_TOOL],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['classify_activity'] } },
    generationConfig: { temperature: 0, maxOutputTokens: 256 },
  });

  const raw = await httpPost(url, body, 30_000);
  const data = JSON.parse(raw);

  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const fnCall = parts.find((p) => p.functionCall?.name === 'classify_activity');

  if (fnCall?.functionCall?.args) {
    const args = fnCall.functionCall.args;
    return {
      label: args.label || 'neutral',
      confidence: Number(args.confidence) || 0.7,
      reason: args.reason || '',
      suggestedAction: args.suggestedAction || 'continue',
      method: 'gemma-fn-call',
      toolCallsUsed: ['FN-4'],
      provider: 'google-ai-studio',
      model,
      local: false,
    };
  }

  // fallback: parse text response
  const textPart = parts.find((p) => p.text)?.text || '';
  return parseClassifyJson(textPart, 'google-ai-studio', model);
}

async function inferViaGoogleAPI(prompt, maxTokens, requestId, operation, logger = null, signal) {
  cloudCallCount += 1;
  const apiKey = process.env.GOOGLE_API_KEY;
  const model = getGoogleModelName();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const startedAt = Date.now();

  writeProviderLog(logger, 'info', 'gemma.provider.google.start', {
    requestId,
    operation,
    summary: `${operation || 'text-inference'} attempting Google AI Studio text inference.`,
    provider: 'google-ai-studio',
    source: 'google-ai-studio-api',
    codePath: CODE_PATHS.googleText,
    endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    model,
    maxTokens,
  });

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: maxTokens },
  });

  const raw = await httpPost(url, body, 60_000, signal);
  const data = JSON.parse(raw);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  writeProviderLog(logger, 'info', 'gemma.provider.google.response', {
    requestId,
    operation,
    summary: `${operation || 'text-inference'} received Google AI Studio response.`,
    provider: 'google-ai-studio',
    source: 'google-ai-studio-api',
    codePath: CODE_PATHS.googleText,
    endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    model,
    responseChars: text.length,
    latencyMs: Date.now() - startedAt,
  });

  return {
    text,
    meta: {
      provider: 'google-ai-studio',
      model,
      local: false,
      source: 'google-ai-studio-api',
      codePath: CODE_PATHS.googleText,
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      fallbackUsed: false,
      toolCallsUsed: [],
      requestId,
    },
  };
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildClassifyPrompt(event, taskSummary) {
  const app = event.appName || 'Unknown App';
  const title = event.windowTitle || '';
  const domain = event.domain || '';
  const task = taskSummary || 'No active task';

  return `You are a focus sentinel for a student learning assistant.

Active learning task: "${task}"

Current desktop activity:
- App: ${app}
- Window title: ${title}${domain ? `\n- Domain: ${domain}` : ''}

Classify whether this activity is helping or hurting the student's focus on their active task.

Key rule: The SAME app or website can be "focus" in one task context and "distraction" in another. For example:
- YouTube showing a lecture on cell biology = focus when the task is "Read Cell Signaling chapter"
- YouTube showing entertainment = distraction when the task is a history essay
- Google Docs = focus when writing; distraction if playing games

Invoke the classify_activity function with your classification.`;
}

function buildClassifyJsonPrompt(event, taskSummary) {
  const app = event.appName || 'Unknown App';
  const title = event.windowTitle || '';
  const domain = event.domain || '';
  const task = taskSummary || 'No active task';

  return `You are a focus classification AI. Reply ONLY with valid JSON, no explanation.

Active task: "${task}"
App: ${app}
Title: ${title}${domain ? `\nDomain: ${domain}` : ''}

Choose label: "focus" (directly on task), "helpful" (supports task), "neutral" (unrelated), "distraction" (off-task).
Same app/site can be focus or distraction depending on the task context.

Reply with exactly this JSON format:
{"label":"focus","confidence":0.9,"reason":"short explanation","suggestedAction":"continue"}`;
}

// ─── JSON parse fallback ──────────────────────────────────────────────────────

function parseClassifyJson(text, provider, model) {
  const VALID_LABELS = new Set(['focus', 'helpful', 'neutral', 'distraction']);
  const isLocal = provider.startsWith('ollama') || provider === 'gemma-ollama';
  let obj = null;

  try {
    const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1] || text;
    const brace = fenced.slice(fenced.indexOf('{'), fenced.lastIndexOf('}') + 1);
    obj = JSON.parse(brace);
  } catch {
    obj = null;
  }

  if (obj && VALID_LABELS.has(obj.label)) {
    return {
      label: obj.label,
      confidence: Math.min(1, Math.max(0, Number(obj.confidence) || 0.7)),
      reason: String(obj.reason || ''),
      suggestedAction: obj.suggestedAction || 'continue',
      method: 'gemma-json-fallback',
      toolCallsUsed: [],
      provider,
      model,
      local: isLocal,
    };
  }

  // Last resort: look for label keyword anywhere in the text
  const lower = text.toLowerCase();
  for (const label of ['focus', 'helpful', 'distraction', 'neutral']) {
    if (lower.includes(label)) {
      return {
        label,
        confidence: 0.55,
        reason: text.slice(0, 120).trim() || `Gemma classified as ${label}.`,
        suggestedAction: label === 'distraction' ? 'return_to_task' : 'continue',
        method: 'gemma-text-parse',
        toolCallsUsed: [],
        provider,
        model,
        local: isLocal,
      };
    }
  }

  return {
    label: 'neutral',
    confidence: 0.3,
    reason: 'Gemma returned an unrecognised format; treated as neutral.',
    suggestedAction: 'continue',
    method: 'gemma-json-fallback',
    toolCallsUsed: [],
    provider,
    model,
    local: isLocal,
  };
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function httpGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON parse failed')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function httpPost(url, body, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      method: 'POST',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs,
    };
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abortRequest);
      callback(value);
    };
    const abortRequest = () => {
      const error = new Error('Request aborted');
      error.name = 'AbortError';
      req.destroy(error);
      finish(reject, error);
    };
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          finish(reject, new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        } else {
          finish(resolve, data);
        }
      });
    });
    req.on('timeout', () => {
      const error = new Error(`timeout after ${timeoutMs}ms`);
      req.destroy(error);
      finish(reject, error);
    });
    req.on('error', (error) => finish(reject, error));
    if (signal?.aborted) {
      abortRequest();
      return;
    }
    signal?.addEventListener('abort', abortRequest, { once: true });
    req.write(body);
    req.end();
  });
}
