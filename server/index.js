import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import mammoth from "mammoth";
import XLSX from "xlsx";
import JSZip from "jszip";
import {
  readStatsData, writeStatsData, computeStats, toSafeNumber, addDistractionEvent, addFocusSession,
} from "./statsStore.js";
import monitorRouter from "./monitor/routes.js";
import { recoverCrashedSessions } from "./monitor/store.js";
import { startHeartbeat } from "./monitor/stream.js";
import { maybeStartMonitorAgent } from "./monitor/agent.js";
import { inferText, isOllamaAvailable, hasGoogleApiKey, getProviderInfo } from "./gemmaProvider.js";
import {
  buildDeterministicReplan,
  buildReplanPrompt,
  normalizeModelProposal,
  normalizeReplanRequest,
} from "./replan.js";

dotenv.config({ override: true });

const app = express();
const contextStore = new Map();
const CONTEXT_TTL_MS = Number(process.env.CONTEXT_TTL_MS || 0) || 1000 * 60 * 60 * 24 * 7;
const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IS_VERCEL = Boolean(process.env.VERCEL);
const RUNTIME_DATA_ROOT = IS_VERCEL
  ? path.join(os.tmpdir(), "focus-trail-server")
  : __dirname;
const LOG_DIR = path.join(RUNTIME_DATA_ROOT, "logs");
const DATA_DIR = path.join(RUNTIME_DATA_ROOT, "data");
const CONTEXT_STORE_DIR = path.join(DATA_DIR, "contexts");
const TEMP_ROOT_DIR = path.join(os.tmpdir(), "flow-crusade-gemma");
const DEFAULT_GEMMA_MODEL_ID = "google/gemma-4-E2B-it";
const DEFAULT_GEMMA_MODEL_DIR = path.join(__dirname, "..", "models", "gemma-4-E2B-it");
const LOCAL_TRANSFORMERS_PROVIDER = "local-transformers";
const LOCAL_TRANSFORMERS_SOURCE = "python-huggingface-transformers";
const LOCAL_TRANSFORMERS_CODE_PATH = "server/index.js:callGemma";
const LOCAL_RULES_PROVIDER = "local-rules";
const LOCAL_RULES_CODE_PATH = "server/index.js:deterministic-fallback";

const SUPPORTED_TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/html",
  "text/csv",
  "text/xml",
  "application/json",
  "application/xml",
  "application/yaml",
  "text/yaml",
]);

const DIRECT_GEMMA_MIME_TYPES = new Set([
  "application/pdf",
]);

const NATIVE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/x-png",
  "image/webp",
  "image/bmp",
  "image/gif",
  "image/tiff",
  "image/tif",
  "image/apng",
]);

const IMAGE_FILE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".jfif",
  ".webp",
  ".bmp",
  ".gif",
  ".tif",
  ".tiff",
  ".apng",
]);

const DOCX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const PRESENTATION_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const SPREADSHEET_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

const OFFICE_TO_PDF_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.oasis.opendocument.text",
  "application/rtf",
  "text/rtf",
]);

class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AppError";
    this.statusCode = options.statusCode || 500;
    this.publicMessage = options.publicMessage || message;
    this.details = options.details || message;
  }
}

function ensureDirectorySync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

ensureDirectorySync(LOG_DIR);
ensureDirectorySync(DATA_DIR);
ensureDirectorySync(CONTEXT_STORE_DIR);
ensureDirectorySync(TEMP_ROOT_DIR);

function readLocalConfig() {
  const configPath = path.join(__dirname, "..", "config.json");
  try {
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    writeLog("error", "config.read.failed", { error: error.message });
    return {};
  }
}

const LOCAL_CONFIG = readLocalConfig();
const PORT = process.env.PORT || LOCAL_CONFIG.port || 8787;

app.use(cors());
app.use(express.json({ limit: "120mb" }));

function getLogFilePath() {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `flow-crusade-${day}.log`);
}

function redactLongText(value, max = 220) {
  if (typeof value !== "string") return value;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function writeLog(level, event, payload = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...payload,
  };

  try {
    fs.appendFileSync(getLogFilePath(), `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.error("[log.write.failed]", error.message);
  }

  const line = payload.message || payload.error || payload.summary || "";
  const suffix = payload.requestId ? ` (requestId: ${payload.requestId})` : "";
  if (level === "error") {
    console.error(`[${event}] ${line}${suffix}`.trim());
  } else {
    console.log(`[${event}] ${line}${suffix}`.trim());
  }
}

function buildFileMetaForLogs(file) {
  if (!file) return null;
  return {
    name: file.originalName || file.name || null,
    processedName: file.name || null,
    mimeType: file.originalMimeType || file.mimeType || null,
    processedMimeType: file.mimeType || null,
    size: Number(file.originalSize || file.size || 0),
    processedSize: Number(file.size || 0),
    wasConvertedToPdf: Boolean(file.wasConvertedToPdf),
    wasExtractedToText: Boolean(file.wasExtractedToText),
    inputKind: file.inputKind || null,
    extractionMethod: file.extractionMethod || null,
  };
}

function inferMimeTypeFromName(filename = "") {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".odt":
      return "application/vnd.oasis.opendocument.text";
    case ".rtf":
      return "application/rtf";
    case ".txt":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".csv":
      return "text/csv";
    case ".json":
      return "application/json";
    case ".xml":
      return "application/xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
    case ".jfif":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".apng":
      return "image/apng";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function getNormalizedMimeType(file) {
  const explicitMime = String(file?.mimeType || "").trim().toLowerCase();
  const inferredMime = inferMimeTypeFromName(file?.name || "").toLowerCase();
  const mimeType = explicitMime && explicitMime !== "application/octet-stream"
    ? explicitMime
    : inferredMime;

  switch (mimeType) {
    case "image/jpg":
    case "image/pjpeg":
      return "image/jpeg";
    case "image/x-png":
      return "image/png";
    case "image/tif":
      return "image/tiff";
    default:
      return mimeType || "application/octet-stream";
  }
}

function isNativeImageMimeType(mimeType = "") {
  return NATIVE_IMAGE_MIME_TYPES.has(getNormalizedMimeType({ mimeType }));
}

function isImageLikeFile(file) {
  const mimeType = getNormalizedMimeType(file);
  const ext = path.extname(file?.name || "").toLowerCase();
  return mimeType.startsWith("image/") || IMAGE_FILE_EXTENSIONS.has(ext);
}

function canSendRawToGemma(mimeType = "") {
  const normalizedMimeType = getNormalizedMimeType({ mimeType });
  return DIRECT_GEMMA_MIME_TYPES.has(normalizedMimeType) || isNativeImageMimeType(normalizedMimeType);
}

function isTextFile(file) {
  const mimeType = getNormalizedMimeType(file);
  const ext = path.extname(file?.name || "").toLowerCase();
  return SUPPORTED_TEXT_MIME_TYPES.has(mimeType) || [".txt", ".md", ".markdown", ".csv", ".json", ".xml", ".html", ".htm", ".yaml", ".yml"].includes(ext);
}

function isDocxFile(file) {
  const mimeType = getNormalizedMimeType(file);
  const ext = path.extname(file?.name || "").toLowerCase();
  return DOCX_MIME_TYPES.has(mimeType) || ext === ".docx";
}

function isPresentationFile(file) {
  const mimeType = getNormalizedMimeType(file);
  const ext = path.extname(file?.name || "").toLowerCase();
  return PRESENTATION_MIME_TYPES.has(mimeType) || ext === ".pptx";
}

function isSpreadsheetFile(file) {
  const mimeType = getNormalizedMimeType(file);
  const ext = path.extname(file?.name || "").toLowerCase();
  return SPREADSHEET_MIME_TYPES.has(mimeType) || [".xlsx", ".xls"].includes(ext);
}

function shouldConvertOfficeDocumentToPdf(file) {
  const mimeType = getNormalizedMimeType(file);
  if (OFFICE_TO_PDF_MIME_TYPES.has(mimeType)) return true;

  const ext = path.extname(file?.name || "").toLowerCase();
  return [".doc", ".odt", ".rtf"].includes(ext);
}

function resolveRepoPath(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.join(__dirname, "..", value);
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDeviceMap(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "auto";
  if (["gpu", "cuda", "cuda:0"].includes(normalized)) return "auto";
  if (["auto", "balanced", "balanced_low_0", "sequential", "cpu"].includes(normalized)) return normalized;
  return "auto";
}

function getGemmaConfig() {
  const config = LOCAL_CONFIG.gemma || {};
  const modelId = (process.env.GEMMA_MODEL_ID || config.modelId || DEFAULT_GEMMA_MODEL_ID).trim();
  const modelDir = resolveRepoPath(process.env.GEMMA_MODEL_DIR || config.modelDir, DEFAULT_GEMMA_MODEL_DIR);
  const runnerPath = resolveRepoPath(process.env.GEMMA_RUNNER_PATH || config.runnerPath, path.join(__dirname, "gemma_runner.py"));
  const cacheDir = resolveRepoPath(process.env.GEMMA_CACHE_DIR || config.cacheDir || process.env.HF_HOME || process.env.TRANSFORMERS_CACHE, path.join(__dirname, "..", "models", ".cache", "huggingface"));
  const python = (process.env.GEMMA_PYTHON || config.python || "python").trim();
  const timeoutMs = parsePositiveNumber(process.env.GEMMA_TIMEOUT_MS || config.timeoutMs, 600000);
  const maxNewTokens = parsePositiveNumber(process.env.GEMMA_MAX_NEW_TOKENS || config.maxNewTokens, 384);
  const initialMaxNewTokens = parsePositiveNumber(process.env.GEMMA_INITIAL_MAX_NEW_TOKENS || config.initialMaxNewTokens, Math.min(maxNewTokens, 384));
  const nodeMaxNewTokens = parsePositiveNumber(process.env.GEMMA_NODE_MAX_NEW_TOKENS || config.nodeMaxNewTokens, Math.min(maxNewTokens, 320));
  const regenerateMaxNewTokens = parsePositiveNumber(process.env.GEMMA_REGENERATE_MAX_NEW_TOKENS || config.regenerateMaxNewTokens, Math.min(maxNewTokens, 160));
  const initialContextChars = parsePositiveNumber(process.env.GEMMA_INITIAL_CONTEXT_CHARS || config.initialContextChars, 6000);
  const nodeContextChars = parsePositiveNumber(process.env.GEMMA_NODE_CONTEXT_CHARS || config.nodeContextChars, 2400);
  const regenerateContextChars = parsePositiveNumber(process.env.GEMMA_REGENERATE_CONTEXT_CHARS || config.regenerateContextChars, 1600);
  const deviceMap = normalizeDeviceMap(process.env.GEMMA_DEVICE_MAP || config.deviceMap || "auto");
  const dtype = (process.env.GEMMA_DTYPE || config.dtype || "float16").trim();
  const quantization = (process.env.GEMMA_QUANTIZATION || config.quantization || "auto").trim();
  const gpuMemoryFraction = parsePositiveNumber(process.env.GEMMA_GPU_MEMORY_FRACTION || config.gpuMemoryFraction, 0.58);
  const gpuMaxMemory = (process.env.GEMMA_GPU_MAX_MEMORY || config.gpuMaxMemory || "").trim();
  const cpuMaxMemory = (process.env.GEMMA_CPU_MAX_MEMORY || config.cpuMaxMemory || "48GiB").trim();
  const persistentWorker = parseBool(process.env.GEMMA_PERSISTENT_WORKER ?? config.persistentWorker, true);

  return {
    provider: "gemma",
    modelId,
    modelDir,
    runnerPath,
    cacheDir,
    python,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180000,
    maxNewTokens,
    initialMaxNewTokens,
    nodeMaxNewTokens,
    regenerateMaxNewTokens,
    initialContextChars,
    nodeContextChars,
    regenerateContextChars,
    deviceMap,
    dtype,
    quantization,
    gpuMemoryFraction,
    gpuMaxMemory,
    cpuMaxMemory,
    persistentWorker,
    local: true,
    cloudFallback: false,
  };
}

function hasLocalGemmaModel(config = getGemmaConfig()) {
  return fs.existsSync(path.join(config.modelDir, "config.json"));
}

function getProviderHealth() {
  const config = getGemmaConfig();
  const pInfo = getProviderInfo();
  return {
    provider: "runtime-router",
    runtimePriority: pInfo.runtimePriority,
    ollamaUrl: pInfo.ollamaUrl,
    ollamaModel: pInfo.ollamaModel,
    localTransformersProvider: LOCAL_TRANSFORMERS_PROVIDER,
    localTransformersModel: config.modelId,
    localTransformersModelDir: config.modelDir,
    model: config.modelId,
    modelDir: config.modelDir,
    local: true,
    modelAvailable: hasLocalGemmaModel(config),
    runnerPath: config.runnerPath,
    localTransformersRunnerPath: config.runnerPath,
    cacheDir: config.cacheDir,
    deviceMap: config.deviceMap,
    dtype: config.dtype,
    quantization: config.quantization,
    gpuMemoryFraction: config.gpuMemoryFraction,
    gpuMaxMemory: config.gpuMaxMemory || null,
    cpuMaxMemory: config.cpuMaxMemory,
    persistentWorker: config.persistentWorker,
    maxNewTokens: {
      initial: config.initialMaxNewTokens,
      breakdownNode: config.nodeMaxNewTokens,
      regenerateNode: config.regenerateMaxNewTokens,
    },
    contextChars: {
      initial: config.initialContextChars,
      breakdownNode: config.nodeContextChars,
      regenerateNode: config.regenerateContextChars,
    },
    cloudFallback: pInfo.hasGoogleKey,
    cloudCallCount: pInfo.cloudCallCount,
    googleApiKeySet: pInfo.hasGoogleKey,
    googleModel: pInfo.googleModel,
    deterministicFallback: LOCAL_RULES_PROVIDER,
  };
}

function getContextFilePath(contextId) {
  const safeId = String(contextId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) return null;
  return path.join(CONTEXT_STORE_DIR, `${safeId}.json`);
}

async function persistContext(contextId, context) {
  const filePath = getContextFilePath(contextId);
  if (!filePath) return;
  const payload = {
    ...context,
    contextId,
    updatedAt: Date.now(),
  };
  contextStore.set(contextId, payload);
  await fsp.writeFile(filePath, JSON.stringify(payload), "utf8");
}

async function loadStoredContext(contextId) {
  if (!contextId) return null;
  const cached = contextStore.get(contextId);
  if (cached) return cached;

  const filePath = getContextFilePath(contextId);
  if (!filePath) return null;

  try {
    const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
    if (!parsed?.createdAt || Date.now() - parsed.createdAt > CONTEXT_TTL_MS) {
      await fsp.rm(filePath, { force: true }).catch(() => {});
      return null;
    }
    contextStore.set(contextId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function pruneOldContexts() {
  const now = Date.now();
  for (const [key, value] of contextStore.entries()) {
    if (!value?.createdAt || now - value.createdAt > CONTEXT_TTL_MS) {
      contextStore.delete(key);
    }
  }

  try {
    const files = await fsp.readdir(CONTEXT_STORE_DIR);
    await Promise.all(files
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const filePath = path.join(CONTEXT_STORE_DIR, name);
        try {
          const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
          if (!parsed?.createdAt || now - parsed.createdAt > CONTEXT_TTL_MS) {
            await fsp.rm(filePath, { force: true });
          }
        } catch {
          await fsp.rm(filePath, { force: true }).catch(() => {});
        }
      }));
  } catch (error) {
    writeLog("error", "context.prune.failed", { error: error.message });
  }
}

function safeJsonParse(text) {
  if (!text || typeof text !== "string") return null;

  const candidates = [text];
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1]);

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(text.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  return null;
}

function sanitizeTitle(text, fallback = "Uploaded Task") {
  if (!text || typeof text !== "string") return fallback;
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 80) || fallback;
}

function sanitizeFilename(filename = "uploaded-file") {
  return filename.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim() || "uploaded-file";
}

function makeStep(idPrefix, index, title, desc) {
  return {
    id: `${idPrefix}-${index + 1}`,
    title,
    desc,
    estimatedMinutes: 10 + index * 5,
    priority: index + 1,
    status: "pending",
    children: [],
  };
}

function buildLocalInitialBreakdown(taskInput = "", fileMeta = null) {
  const sourceLabel = taskInput?.trim() || fileMeta?.originalName || fileMeta?.name || "uploaded task";
  const isNativeImage = fileMeta?.inputKind === "native-image";
  const title = sanitizeTitle(
    taskInput?.trim() ||
      (fileMeta?.originalName || fileMeta?.name || "Uploaded Task").replace(/\.[^.]+$/, "") ||
      "Uploaded Task"
  );
  const rootDescription = taskInput?.trim()
    ? `Complete: ${taskInput.trim()}`
    : `Work through the uploaded ${isNativeImage ? "image" : "file"}${fileMeta?.originalName || fileMeta?.name ? ` (${fileMeta.originalName || fileMeta.name})` : ""} and turn it into an actionable plan.`;

  if (isNativeImage) {
    return {
      rootTitle: title,
      rootDescription,
      steps: [
        makeStep("fallback-image", 0, "Inspect the visible requirements", `Review the screenshot or photo and note the clearest task details in ${sourceLabel}.`),
        makeStep("fallback-image", 1, "List deadlines and deliverables", "Write down any dates, deliverables, and unclear handwritten items you can verify."),
        makeStep("fallback-image", 2, "Start the first tiny action", "Open the work area and complete the first visible requirement from the image."),
      ],
      source: "local-rules",
    };
  }

  return {
    rootTitle: title,
    rootDescription,
    steps: [
      makeStep("fallback-step", 0, "Understand the requirements", `Review the main goal and constraints for ${sourceLabel}.`),
      makeStep("fallback-step", 1, "Prepare the needed inputs", "Collect the key information, assets, or references required to execute the task."),
      makeStep("fallback-step", 2, "Execute the first concrete deliverable", "Produce the first visible output so the task starts moving forward."),
    ],
    source: "local-rules",
  };
}

function buildLocalChildBreakdown(targetTitle = "Subtask") {
  return {
    steps: [
      makeStep("fallback-child", 0, `Clarify ${targetTitle}`, `Define exactly what success looks like for ${targetTitle}.`),
      makeStep("fallback-child", 1, `Do the core work for ${targetTitle}`, `Complete the main action required for ${targetTitle}.`),
      makeStep("fallback-child", 2, `Review and finalize ${targetTitle}`, `Check that ${targetTitle} is complete and ready to move on.`),
    ],
    source: "local-rules",
  };
}

function buildLocalRegeneratedStep(targetNode, slotIndex = 0) {
  return {
    step: {
      id: targetNode?.id || `regen-${slotIndex + 1}`,
      title: sanitizeTitle(targetNode?.title || `Refined subtask ${slotIndex + 1}`),
      desc: targetNode?.desc || "Clarify this step with a more precise scope and outcome.",
      estimatedMinutes: targetNode?.estimatedMinutes || 15,
      priority: slotIndex + 1,
      status: "pending",
      children: [],
    },
    source: "local-rules",
  };
}

function clipTextAroundAnchors(text = "", maxChars = 12000, anchors = []) {
  const source = String(text || "");
  if (!source || source.length <= maxChars) return source;

  const normalizedAnchors = anchors
    .filter((anchor) => typeof anchor === "string" && anchor.trim().length >= 4)
    .map((anchor) => anchor.replace(/\s+/g, " ").trim().slice(0, 80).toLowerCase());

  const lower = source.toLowerCase();
  const snippets = [];
  const used = [];
  const snippetBudget = Math.max(1200, Math.floor(maxChars / Math.max(1, Math.min(normalizedAnchors.length, 3))));

  for (const anchor of normalizedAnchors.slice(0, 4)) {
    const idx = lower.indexOf(anchor);
    if (idx === -1) continue;

    const start = Math.max(0, idx - Math.floor(snippetBudget / 3));
    const end = Math.min(source.length, start + snippetBudget);
    if (used.some(([a, b]) => start < b && end > a)) continue;
    used.push([start, end]);
    snippets.push(source.slice(start, end).trim());
  }

  const reserved = snippets.join("\n\n...\n\n").length;
  const remaining = Math.max(1200, maxChars - reserved - 240);
  const head = source.slice(0, Math.floor(remaining * 0.65)).trim();
  const tail = source.slice(Math.max(0, source.length - Math.floor(remaining * 0.35))).trim();
  const body = [head, ...snippets, tail].filter(Boolean).join("\n\n...\n\n").slice(0, maxChars);

  return `[Excerpted from ${source.length} characters for local performance.]\n${body}`;
}

function buildFilePart(file, options = {}) {
  if (file?.textContent) {
    const textContent = clipTextAroundAnchors(
      file.textContent,
      options.maxTextChars || 12000,
      options.anchors || []
    );

    return {
      text: `\n\n--- Uploaded file content: ${file.originalName || file.name || "uploaded file"} ---\n${textContent}\n--- End uploaded file content ---`,
    };
  }

  if (!file?.dataBase64 || !file?.mimeType) return null;
  return {
    inlineData: {
      mimeType: file.mimeType,
      data: file.dataBase64,
    },
  };
}

function getFileSummaryText(file) {
  if (!file) return "No uploaded file.";

  const originalName = file.originalName || file.name || "unnamed file";
  const originalMime = file.originalMimeType || file.mimeType || "unknown mime";
  const originalSize = Number(file.originalSize || file.size || 0);

  if (file.inputKind === "native-image") {
    return `Uploaded image: ${originalName} (${originalMime}, ${originalSize} bytes). It is passed to local Gemma as native pixels, so inspect screenshots, photos, and handwriting directly. If handwriting is unclear, prefer uncertainty over inventing details.`;
  }

  if (file.wasConvertedToPdf) {
    return `Uploaded file: ${originalName} (${originalMime}, ${originalSize} bytes). It was converted to PDF for local Gemma processing as ${file.name} (${file.size || 0} bytes).`;
  }

  if (file.wasExtractedToText) {
    return `Uploaded file: ${originalName} (${originalMime}, ${originalSize} bytes). It was extracted to text for local Gemma processing as ${file.name} (${file.size || 0} bytes).`;
  }

  return `Uploaded file: ${originalName} (${originalMime}, ${originalSize} bytes).`;
}


function decodeBase64Text(dataBase64) {
  return Buffer.from(dataBase64 || "", "base64").toString("utf8");
}

function normalizeExtractedText(text = "") {
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function decodeXmlEntities(text = "") {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function xmlTextToPlainText(xml = "") {
  return decodeXmlEntities(
    xml
      .replace(/<a:br\s*\/>/g, "\n")
      .replace(/<w:br\s*\/>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  ).trim();
}

async function extractTextFile(file, requestId) {
  const originalName = file?.name || "uploaded-text";
  const originalMimeType = getNormalizedMimeType(file);
  const originalSize = Number(file?.size || 0);

  writeLog("info", "file.text.extract.start", {
    requestId,
    message: `Reading text content from ${originalName}.`,
    file: { name: originalName, mimeType: originalMimeType, size: originalSize },
  });

  const textContent = normalizeExtractedText(decodeBase64Text(file.dataBase64));
  if (!textContent) {
    throw new AppError("The uploaded text file is empty.", {
      statusCode: 400,
      publicMessage: `The uploaded file ${originalName} does not contain readable text.`,
    });
  }

  writeLog("info", "file.text.extract.success", {
    requestId,
    message: `Read text content from ${originalName} successfully.`,
    file: { name: originalName, mimeType: originalMimeType, size: originalSize },
    extractedCharacters: textContent.length,
  });

  return {
    name: `${path.basename(originalName, path.extname(originalName)) || "uploaded-text"}.txt`,
    mimeType: "text/plain",
    size: Buffer.byteLength(textContent, "utf8"),
    textContent,
    originalName,
    originalMimeType,
    originalSize,
    wasExtractedToText: true,
    wasConvertedToPdf: false,
    inputKind: "text-file",
    extractionMethod: "text-read",
  };
}

async function extractDocxToText(file, requestId) {
  const originalName = file?.name || "uploaded-document.docx";
  const originalMimeType = getNormalizedMimeType(file);
  const originalSize = Number(file?.size || 0);
  const buffer = Buffer.from(file.dataBase64, "base64");

  writeLog("info", "file.docx.extract.start", {
    requestId,
    message: `Extracting text from ${originalName} for local Gemma processing.`,
    file: { name: originalName, mimeType: originalMimeType, size: originalSize },
  });

  try {
    const result = await mammoth.extractRawText({ buffer });
    const textContent = normalizeExtractedText(result.value || "");

    if (!textContent) {
      throw new Error("DOCX did not contain readable text.");
    }

    writeLog("info", "file.docx.extract.success", {
      requestId,
      message: `Extracted text from ${originalName} successfully.`,
      file: { name: originalName, mimeType: originalMimeType, size: originalSize },
      extractedCharacters: textContent.length,
      warnings: result.messages?.map((message) => message.message).slice(0, 5) || [],
    });

    return {
      name: `${path.basename(originalName, path.extname(originalName)) || "uploaded-document"}.txt`,
      mimeType: "text/plain",
      size: Buffer.byteLength(textContent, "utf8"),
      textContent,
      originalName,
      originalMimeType,
      originalSize,
      wasExtractedToText: true,
      wasConvertedToPdf: false,
      inputKind: "office-document",
      extractionMethod: "document-parse",
    };
  } catch (error) {
    writeLog("error", "file.docx.extract.failed", {
      requestId,
      message: `Failed to extract text from ${originalName}.`,
      error: error.message,
      stack: error.stack,
      file: { name: originalName, mimeType: originalMimeType, size: originalSize },
    });

    throw new AppError(error.message, {
      statusCode: 400,
      publicMessage: `Failed to read ${originalName}. Please upload a PDF, TXT, or simpler DOCX file.`,
      details: error.message,
    });
  }
}

async function extractPptxToText(file, requestId) {
  const originalName = file?.name || "uploaded-presentation.pptx";
  const originalMimeType = getNormalizedMimeType(file);
  const originalSize = Number(file?.size || 0);
  const buffer = Buffer.from(file.dataBase64, "base64");

  writeLog("info", "file.pptx.extract.start", {
    requestId,
    message: `Extracting slide text from ${originalName} for local Gemma processing.`,
    file: { name: originalName, mimeType: originalMimeType, size: originalSize },
  });

  try {
    const zip = await JSZip.loadAsync(buffer);
    const slideEntries = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0) - Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0));

    const slides = [];
    for (const entry of slideEntries) {
      const xml = await zip.files[entry].async("string");
      const slideNumber = entry.match(/slide(\d+)\.xml/i)?.[1] || String(slides.length + 1);
      const text = normalizeExtractedText(xmlTextToPlainText(xml));
      if (text) slides.push(`Slide ${slideNumber}:\n${text}`);
    }

    const textContent = normalizeExtractedText(slides.join("\n\n"));
    if (!textContent) {
      throw new Error("PPTX did not contain readable slide text.");
    }

    writeLog("info", "file.pptx.extract.success", {
      requestId,
      message: `Extracted slide text from ${originalName} successfully.`,
      file: { name: originalName, mimeType: originalMimeType, size: originalSize },
      slideCount: slides.length,
      extractedCharacters: textContent.length,
    });

    return {
      name: `${path.basename(originalName, path.extname(originalName)) || "uploaded-presentation"}.txt`,
      mimeType: "text/plain",
      size: Buffer.byteLength(textContent, "utf8"),
      textContent,
      originalName,
      originalMimeType,
      originalSize,
      wasExtractedToText: true,
      wasConvertedToPdf: false,
      inputKind: "office-document",
      extractionMethod: "document-parse",
    };
  } catch (error) {
    writeLog("error", "file.pptx.extract.failed", {
      requestId,
      message: `Failed to extract slide text from ${originalName}.`,
      error: error.message,
      stack: error.stack,
      file: { name: originalName, mimeType: originalMimeType, size: originalSize },
    });

    throw new AppError(error.message, {
      statusCode: 400,
      publicMessage: `Failed to read ${originalName}. Please upload a PDF, TXT, or simpler PPTX file.`,
      details: error.message,
    });
  }
}

async function extractSpreadsheetToText(file, requestId) {
  const originalName = file?.name || "uploaded-spreadsheet.xlsx";
  const originalMimeType = getNormalizedMimeType(file);
  const originalSize = Number(file?.size || 0);
  const buffer = Buffer.from(file.dataBase64, "base64");

  writeLog("info", "file.spreadsheet.extract.start", {
    requestId,
    message: `Extracting spreadsheet text from ${originalName} for local Gemma processing.`,
    file: { name: originalName, mimeType: originalMimeType, size: originalSize },
  });

  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetText = workbook.SheetNames.map((sheetName) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false });
      return csv.trim() ? `Sheet: ${sheetName}\n${csv.trim()}` : "";
    }).filter(Boolean);

    const textContent = normalizeExtractedText(sheetText.join("\n\n"));
    if (!textContent) {
      throw new Error("Spreadsheet did not contain readable cells.");
    }

    writeLog("info", "file.spreadsheet.extract.success", {
      requestId,
      message: `Extracted spreadsheet text from ${originalName} successfully.`,
      file: { name: originalName, mimeType: originalMimeType, size: originalSize },
      sheetCount: sheetText.length,
      extractedCharacters: textContent.length,
    });

    return {
      name: `${path.basename(originalName, path.extname(originalName)) || "uploaded-spreadsheet"}.txt`,
      mimeType: "text/plain",
      size: Buffer.byteLength(textContent, "utf8"),
      textContent,
      originalName,
      originalMimeType,
      originalSize,
      wasExtractedToText: true,
      wasConvertedToPdf: false,
      inputKind: "office-document",
      extractionMethod: "document-parse",
    };
  } catch (error) {
    writeLog("error", "file.spreadsheet.extract.failed", {
      requestId,
      message: `Failed to extract spreadsheet text from ${originalName}.`,
      error: error.message,
      stack: error.stack,
      file: { name: originalName, mimeType: originalMimeType, size: originalSize },
    });

    throw new AppError(error.message, {
      statusCode: 400,
      publicMessage: `Failed to read ${originalName}. Please upload a PDF, CSV, TXT, or simpler spreadsheet file.`,
      details: error.message,
    });
  }
}

async function convertOfficeDocumentToPdf(file, requestId) {
  const originalName = file?.name || "uploaded-document";
  const originalMimeType = getNormalizedMimeType(file);
  const originalSize = Number(file?.size || 0);
  const safeName = sanitizeFilename(originalName);
  const requestDir = path.join(TEMP_ROOT_DIR, requestId);
  const inputDir = path.join(requestDir, "input");
  const outputDir = path.join(requestDir, "output");
  const ext = path.extname(safeName) || ".bin";
  const baseName = path.basename(safeName, ext) || "uploaded-document";
  const inputPath = path.join(inputDir, `${baseName}${ext}`);
  const expectedPdfPath = path.join(outputDir, `${baseName}.pdf`);

  writeLog("info", "file.convert.start", {
    requestId,
    message: `Converting ${originalName} to PDF for local Gemma processing.`,
    file: {
      name: originalName,
      mimeType: originalMimeType,
      size: originalSize,
    },
  });

  try {
    await fsp.mkdir(inputDir, { recursive: true });
    await fsp.mkdir(outputDir, { recursive: true });
    await fsp.writeFile(inputPath, Buffer.from(file.dataBase64, "base64"));

    const args = ["--headless", "--convert-to", "pdf", "--outdir", outputDir, inputPath];
    const { stdout = "", stderr = "" } = await execFileAsync("soffice", args, {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: process.env.HOME || os.homedir(),
      },
    });

    let pdfPath = expectedPdfPath;
    const exists = await fsp
      .access(pdfPath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      const outputFiles = await fsp.readdir(outputDir).catch(() => []);
      const fallbackPdf = outputFiles.find((name) => name.toLowerCase().endsWith(".pdf"));
      if (!fallbackPdf) {
        throw new Error(`LibreOffice completed without producing a PDF. stdout=${stdout} stderr=${stderr}`);
      }
      pdfPath = path.join(outputDir, fallbackPdf);
    }

    const pdfBuffer = await fsp.readFile(pdfPath);
    writeLog("info", "file.convert.success", {
      requestId,
      message: `Converted ${originalName} to PDF successfully.`,
      file: {
        name: originalName,
        mimeType: originalMimeType,
        size: originalSize,
      },
      conversion: {
        outputName: path.basename(pdfPath),
        outputSize: pdfBuffer.length,
        stdout: redactLongText(stdout, 1200),
        stderr: redactLongText(stderr, 1200),
      },
    });

    return {
      name: path.basename(pdfPath),
      mimeType: "application/pdf",
      size: pdfBuffer.length,
      dataBase64: pdfBuffer.toString("base64"),
      originalName,
      originalMimeType,
      originalSize,
      wasConvertedToPdf: true,
      wasExtractedToText: false,
      inputKind: "pdf-document",
      extractionMethod: "office-pipeline",
    };
  } catch (error) {
    writeLog("error", "file.convert.failed", {
      requestId,
      message: `Failed to convert ${originalName} to PDF.`,
      error: error.message,
      stack: error.stack,
      file: {
        name: originalName,
        mimeType: originalMimeType,
        size: originalSize,
      },
    });

    throw new AppError(error.message, {
      statusCode: 400,
      publicMessage: `Failed to convert ${originalName} to PDF for local Gemma processing.`,
      details: error.message,
    });
  } finally {
    await fsp.rm(requestDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function prepareFileForGemma(file, requestId) {
  if (!file?.dataBase64) return null;

  const normalizedMimeType = getNormalizedMimeType(file);
  const isNativeImage = isNativeImageMimeType(normalizedMimeType);
  const normalizedFile = {
    name: file.name || "uploaded-file",
    mimeType: normalizedMimeType,
    size: Number(file.size) || 0,
    dataBase64: file.dataBase64,
    originalName: file.name || "uploaded-file",
    originalMimeType: normalizedMimeType,
    originalSize: Number(file.size) || 0,
    wasConvertedToPdf: false,
    wasExtractedToText: false,
  };

  // PDF and supported images stay local; supported images are passed to Gemma as pixels.
  if (canSendRawToGemma(normalizedMimeType)) {
    normalizedFile.inputKind = isNativeImage ? "native-image" : "pdf-document";
    normalizedFile.extractionMethod = isNativeImage ? "native-multimodal" : "document-parse";

    writeLog("info", "file.prepare.raw", {
      requestId,
      message: isNativeImage
        ? `Using ${normalizedFile.originalName} as a native image input for local Gemma.`
        : `Using ${normalizedFile.originalName} as a raw local Gemma input.`,
      file: buildFileMetaForLogs(normalizedFile),
    });
    return normalizedFile;
  }

  if (isImageLikeFile(normalizedFile)) {
    writeLog("error", "file.prepare.unsupported-image", {
      requestId,
      message: `Unsupported image type for local Gemma processing: ${normalizedFile.originalName}.`,
      file: buildFileMetaForLogs({
        ...normalizedFile,
        inputKind: "unsupported-image",
        extractionMethod: "unsupported",
      }),
    });

    throw new AppError("Unsupported image type", {
      statusCode: 400,
      publicMessage: `Unsupported image type: ${normalizedFile.originalName}. Please upload screenshots or handwritten photos as PNG, JPG/JPEG, WebP, BMP, GIF, or TIFF.`,
      details: `Unsupported mime type: ${normalizedMimeType}`,
    });
  }

  // TXT/MD/CSV/JSON/XML/HTML/YAML are read into the prompt as text.
  if (isTextFile(normalizedFile)) {
    return extractTextFile(normalizedFile, requestId);
  }

  // DOCX is parsed locally instead of being converted to PDF.
  if (isDocxFile(normalizedFile)) {
    return extractDocxToText(normalizedFile, requestId);
  }

  // PPTX is parsed locally into slide text.
  if (isPresentationFile(normalizedFile)) {
    return extractPptxToText(normalizedFile, requestId);
  }

  // XLS/XLSX is parsed locally into sheet text / CSV-like content.
  if (isSpreadsheetFile(normalizedFile)) {
    return extractSpreadsheetToText(normalizedFile, requestId);
  }

  // Legacy office formats are converted to PDF only as a fallback strategy.
  if (shouldConvertOfficeDocumentToPdf(normalizedFile)) {
    return convertOfficeDocumentToPdf(normalizedFile, requestId);
  }

  writeLog("error", "file.prepare.unsupported", {
    requestId,
    message: `Unsupported upload type for local Gemma processing: ${normalizedFile.originalName}.`,
    file: buildFileMetaForLogs(normalizedFile),
  });

  throw new AppError("Unsupported upload type", {
    statusCode: 400,
    publicMessage: `Unsupported file type: ${normalizedFile.originalName}. Please upload PDF, PNG/JPG/WebP/BMP/GIF/TIFF screenshots or photos, TXT/MD, DOCX, PPTX, XLSX, or legacy DOC/RTF/ODT files.`,
    details: `Unsupported mime type: ${normalizedMimeType}`,
  });
}

function getMaxNewTokensForOperation(config, operation) {
  if (operation === "breakdown-node") return config.nodeMaxNewTokens;
  if (operation === "regenerate-node") return config.regenerateMaxNewTokens;
  return config.initialMaxNewTokens;
}

function requestHasNativeImageInput(parts = []) {
  return parts.some((part) => {
    const inlineData = part?.inlineData || part?.inline_data;
    const mimeType = String(inlineData?.mimeType || inlineData?.mime_type || "").toLowerCase();
    return mimeType.startsWith("image/");
  });
}

function buildGemmaRunnerArgs(config, extraArgs = []) {
  return [
    config.runnerPath,
    "--model-dir",
    config.modelDir,
    "--model-id",
    config.modelId,
    "--device-map",
    config.deviceMap,
    "--dtype",
    config.dtype,
    "--quantization",
    config.quantization,
    "--gpu-memory-fraction",
    String(config.gpuMemoryFraction),
    "--cpu-max-memory",
    config.cpuMaxMemory,
    ...(config.gpuMaxMemory ? ["--gpu-max-memory", config.gpuMaxMemory] : []),
    ...extraArgs,
  ];
}

function buildGemmaEnv(config) {
  return {
    ...process.env,
    HF_HOME: config.cacheDir,
    TRANSFORMERS_CACHE: config.cacheDir,
    HF_DEACTIVATE_ASYNC_LOAD: "1",
    HF_ENABLE_PARALLEL_LOADING: "false",
    HF_PARALLEL_LOADING_WORKERS: "1",
    PYTHONFAULTHANDLER: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTORCH_CUDA_ALLOC_CONF: "max_split_size_mb:128",
    TOKENIZERS_PARALLELISM: "false",
  };
}

function getWorkerSignature(config) {
  return JSON.stringify({
    python: config.python,
    runnerPath: config.runnerPath,
    modelDir: config.modelDir,
    modelId: config.modelId,
    deviceMap: config.deviceMap,
    dtype: config.dtype,
    quantization: config.quantization,
    gpuMemoryFraction: config.gpuMemoryFraction,
    gpuMaxMemory: config.gpuMaxMemory,
    cpuMaxMemory: config.cpuMaxMemory,
  });
}

let gemmaWorker = null;

class GemmaWorker {
  constructor(config) {
    this.config = config;
    this.signature = getWorkerSignature(config);
    this.pending = new Map();
    this.stdoutBuffer = "";
    this.stderrTail = "";
    this.closed = false;
    this.proc = spawn(
      config.python,
      buildGemmaRunnerArgs(config, ["--serve"]),
      {
        windowsHide: true,
        env: buildGemmaEnv(config),
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    this.ready = false;
    this.startupError = null;
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.proc.stderr.on("data", (chunk) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-8000);
    });
    this.proc.on("error", (error) => {
      this.startupError = error;
      this.failAll(error);
    });
    this.proc.on("close", (code, signal) => {
      this.closed = true;
      const error = new Error(`Local Gemma worker exited code=${code ?? "null"} signal=${signal ?? "null"} ${this.stderrTail}`.trim());
      this.failAll(error);
      if (gemmaWorker === this) gemmaWorker = null;
    });
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.stderrTail = (this.stderrTail + `\n[stdout] ${line}`).slice(-8000);
        continue;
      }

      if (message.ready) {
        this.ready = true;
        writeLog("info", "gemma.worker.ready", {
          message: `Local Gemma worker is ready for ${this.config.modelId}.`,
          model: this.config.modelId,
        });
        continue;
      }

      const pending = this.pending.get(message.requestId);
      if (!pending) continue;
      clearTimeout(pending.timeout);
      this.pending.delete(message.requestId);

      if (message.ok) {
        pending.resolve(message);
      } else {
        const error = new Error(message.error || "Local Gemma worker request failed.");
        if (message.traceback) {
          error.stack = message.traceback;
        }
        pending.reject(error);
      }
    }
  }

  request(payload, timeoutMs) {
    if (this.startupError) {
      return Promise.reject(this.startupError);
    }
    if (this.closed || !this.proc?.stdin?.writable) {
      return Promise.reject(new Error("Local Gemma worker is not writable."));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(payload.requestId);
        reject(new Error(`Local Gemma worker timed out after ${timeoutMs}ms.`));
        this.kill();
      }, timeoutMs);

      this.pending.set(payload.requestId, { resolve, reject, timeout });

      try {
        this.proc.stdin.write(`${JSON.stringify(payload)}\n`, "utf8", (error) => {
          if (!error) return;
          clearTimeout(timeout);
          this.pending.delete(payload.requestId);
          reject(error);
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(payload.requestId);
        reject(error);
      }
    });
  }

  kill() {
    if (this.closed) return;
    this.closed = true;
    this.proc.kill();
  }

  failAll(error) {
    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(requestId);
    }
  }
}

async function runGemmaOneShot(config, requestPath, maxNewTokens) {
  const { stdout, stderr } = await execFileAsync(
    config.python,
    [
      ...buildGemmaRunnerArgs(config),
      "--request-file",
      requestPath,
      "--max-new-tokens",
      String(maxNewTokens),
    ],
    {
      timeout: config.timeoutMs,
      maxBuffer: 1024 * 1024 * 20,
      windowsHide: true,
      env: buildGemmaEnv(config),
    }
  );

  return { stdout, stderr };
}

function getGemmaWorker(config) {
  const signature = getWorkerSignature(config);
  if (gemmaWorker && gemmaWorker.signature === signature && !gemmaWorker.closed) {
    return gemmaWorker;
  }

  if (gemmaWorker && !gemmaWorker.closed) {
    gemmaWorker.kill();
  }

  gemmaWorker = new GemmaWorker(config);
  return gemmaWorker;
}

async function callGemmaViaProvider(parts, { requestId, operation, maxNewTokens, signal }) {
  // Build a plain text prompt from the parts array
  const promptText = parts.map((p) => {
    if (typeof p?.text === "string") return p.text;
    if (p?.inlineData) return "[image attached]";
    return "";
  }).filter(Boolean).join("\n\n");

  const result = await inferText(promptText, { maxTokens: maxNewTokens, requestId, operation, logger: writeLog, signal });
  if (!result) return null;

  return {
    candidates: [{ content: { parts: [{ text: result.text }] } }],
    meta: result.meta || {},
  };
}

async function callGemma(parts, { requestId, operation, signal }) {
  const config = getGemmaConfig();
  const maxNewTokens = getMaxNewTokensForOperation(config, operation);

  // Try Ollama or Google API first (faster, works on 8GB RAM)
  const hasNativeImage = requestHasNativeImageInput(parts);
  if (!hasNativeImage) {
    try {
      const providerResult = await callGemmaViaProvider(parts, { requestId, operation, maxNewTokens, signal });
      if (providerResult) {
        writeLog("info", "gemma.provider.success", {
          requestId,
          summary: `${operation} succeeded via ${providerResult.meta?.provider || "unknown provider"}.`,
          operation,
          provider: providerResult.meta?.provider || "unknown",
          source: providerResult.meta?.source || null,
          codePath: providerResult.meta?.codePath || null,
          endpoint: providerResult.meta?.endpoint || null,
          model: providerResult.meta?.model || null,
          local: providerResult.meta?.local ?? null,
        });
        return providerResult;
      }
    } catch (providerErr) {
      if (providerErr.name === "AbortError") throw providerErr;
      writeLog("info", "gemma.provider.failed", {
        requestId,
        message: `gemmaProvider failed for ${operation}: ${providerErr.message}. Trying HuggingFace runner.`,
        operation,
        provider: "runtime-router",
        source: "provider-route",
        codePath: "server/index.js:callGemmaViaProvider",
        nextProvider: LOCAL_TRANSFORMERS_PROVIDER,
      });
    }
  } else {
    writeLog("info", "gemma.provider.skipped", {
      requestId,
      summary: `${operation} skipped Ollama/Google provider route because native image input requires local Transformers.`,
      operation,
      provider: "runtime-router",
      source: "provider-route",
      codePath: "server/index.js:callGemma",
      reason: "native-image-input",
      nextProvider: LOCAL_TRANSFORMERS_PROVIDER,
    });
  }

  if (!hasLocalGemmaModel(config)) {
    writeLog("info", "gemma.local.unavailable", {
      requestId,
      message: `Local Gemma model was not found at ${config.modelDir}. Using deterministic local fallback.`,
      provider: LOCAL_TRANSFORMERS_PROVIDER,
      source: LOCAL_TRANSFORMERS_SOURCE,
      codePath: LOCAL_TRANSFORMERS_CODE_PATH,
      nextProvider: LOCAL_RULES_PROVIDER,
      model: config.modelId,
      modelDir: config.modelDir,
    });
    throw new Error(`Local Gemma model is unavailable at ${config.modelDir}`);
  }

  if (signal?.aborted) {
    const error = new Error("Request aborted");
    error.name = "AbortError";
    throw error;
  }

  const requestDir = await fsp.mkdtemp(path.join(TEMP_ROOT_DIR, `${requestId}-${operation}-`));
  const requestPath = path.join(requestDir, "request.json");
  const startedAt = Date.now();
  const hasNativeImageInput = requestHasNativeImageInput(parts);

  await fsp.writeFile(requestPath, JSON.stringify({ parts, requestId, operation }), "utf8");

  try {
    writeLog("info", "gemma.request.start", {
      requestId,
      summary: `${operation} via ${LOCAL_TRANSFORMERS_PROVIDER} (${config.modelId}).`,
      provider: LOCAL_TRANSFORMERS_PROVIDER,
      source: LOCAL_TRANSFORMERS_SOURCE,
      codePath: LOCAL_TRANSFORMERS_CODE_PATH,
      model: config.modelId,
      modelDir: config.modelDir,
      runnerPath: config.runnerPath,
      runnerCodePath: "server/gemma_runner.py",
      python: config.python,
      cacheDir: config.cacheDir,
      maxNewTokens,
      deviceMap: config.deviceMap,
      gpuMemoryFraction: config.gpuMemoryFraction,
      operation,
    });

    if (config.persistentWorker && !hasNativeImageInput) {
      try {
        const worker = getGemmaWorker(config);
        const parsed = await worker.request({
          requestId,
          operation,
          parts,
          maxNewTokens,
        }, config.timeoutMs);
        const content = typeof parsed?.text === "string" ? parsed.text : "";
        if (!content.trim()) {
          throw new Error("Local Gemma worker returned an empty response.");
        }

        writeLog("info", "gemma.request.success", {
          requestId,
          summary: `${operation} succeeded with ${LOCAL_TRANSFORMERS_PROVIDER} (${config.modelId}).`,
          provider: LOCAL_TRANSFORMERS_PROVIDER,
          source: LOCAL_TRANSFORMERS_SOURCE,
          codePath: LOCAL_TRANSFORMERS_CODE_PATH,
          model: config.modelId,
          modelDir: config.modelDir,
          runnerPath: config.runnerPath,
          operation,
          latencyMs: Date.now() - startedAt,
          worker: "persistent",
        });

        return {
          candidates: [{ content: { parts: [{ text: content }] } }],
          meta: {
            ...(parsed?.meta || {}),
            provider: LOCAL_TRANSFORMERS_PROVIDER,
            model: config.modelId,
            local: true,
            source: LOCAL_TRANSFORMERS_SOURCE,
            codePath: LOCAL_TRANSFORMERS_CODE_PATH,
            runnerPath: config.runnerPath,
            worker: "persistent",
          },
        };
      } catch (workerError) {
        const workerTimedOut = /timed out/i.test(workerError.message || "");
        const canRetryOneShot = !workerTimedOut && (!gemmaWorker || (!gemmaWorker.ready && (gemmaWorker.closed || gemmaWorker.startupError)));
        writeLog("error", "gemma.worker.failed", {
          requestId,
          message: canRetryOneShot
            ? `Persistent Gemma worker failed; trying one-shot runner.`
            : `Persistent Gemma worker failed after startup.`,
          provider: LOCAL_TRANSFORMERS_PROVIDER,
          source: LOCAL_TRANSFORMERS_SOURCE,
          codePath: LOCAL_TRANSFORMERS_CODE_PATH,
          runnerPath: config.runnerPath,
          python: config.python,
          error: redactLongText(workerError.message, 2000),
          stack: redactLongText(workerError.stack, 4000),
          operation,
        });
        if (gemmaWorker && gemmaWorker.startupError) {
          gemmaWorker = null;
        }
        if (!canRetryOneShot) {
          throw workerError;
        }
      }
    }

    if (config.persistentWorker && hasNativeImageInput) {
      writeLog("info", "gemma.worker.skipped", {
        requestId,
        message: "Using one-shot Gemma runner for native image input to avoid Gemma4Processor persistent-worker tokenizer instability.",
        provider: LOCAL_TRANSFORMERS_PROVIDER,
        source: LOCAL_TRANSFORMERS_SOURCE,
        codePath: LOCAL_TRANSFORMERS_CODE_PATH,
        runnerPath: config.runnerPath,
        operation,
      });
    }

    writeLog("info", "gemma.oneshot.start", {
      requestId,
      summary: `${operation} attempting one-shot ${LOCAL_TRANSFORMERS_PROVIDER}.`,
      provider: LOCAL_TRANSFORMERS_PROVIDER,
      source: LOCAL_TRANSFORMERS_SOURCE,
      codePath: LOCAL_TRANSFORMERS_CODE_PATH,
      runnerPath: config.runnerPath,
      requestPath,
      python: config.python,
      model: config.modelId,
      modelDir: config.modelDir,
      operation,
    });

    const { stdout, stderr } = await runGemmaOneShot(config, requestPath, maxNewTokens);

    if (stderr?.trim()) {
      writeLog("info", "gemma.runner.stderr", {
        requestId,
        provider: LOCAL_TRANSFORMERS_PROVIDER,
        source: LOCAL_TRANSFORMERS_SOURCE,
        codePath: LOCAL_TRANSFORMERS_CODE_PATH,
        runnerPath: config.runnerPath,
        message: redactLongText(stderr, 1800),
      });
    }

    const parsed = safeJsonParse(stdout);
    const content = typeof parsed?.text === "string" ? parsed.text : "";
    if (!content.trim()) {
      throw new Error("Local Gemma runner returned an empty response.");
    }

    writeLog("info", "gemma.request.success", {
      requestId,
      summary: `${operation} succeeded with one-shot ${LOCAL_TRANSFORMERS_PROVIDER} (${config.modelId}).`,
      provider: LOCAL_TRANSFORMERS_PROVIDER,
      source: LOCAL_TRANSFORMERS_SOURCE,
      codePath: LOCAL_TRANSFORMERS_CODE_PATH,
      model: config.modelId,
      modelDir: config.modelDir,
      runnerPath: config.runnerPath,
      operation,
      latencyMs: Date.now() - startedAt,
    });

    return {
      candidates: [{ content: { parts: [{ text: content }] } }],
      meta: {
        ...(parsed?.meta || {}),
        provider: LOCAL_TRANSFORMERS_PROVIDER,
        model: config.modelId,
        local: true,
        source: LOCAL_TRANSFORMERS_SOURCE,
        codePath: LOCAL_TRANSFORMERS_CODE_PATH,
        runnerPath: config.runnerPath,
        worker: "one-shot",
      },
    };
  } catch (error) {
    writeLog("error", "gemma.request.error", {
      requestId,
      message: `${operation} failed with local ${config.modelId}.`,
      provider: LOCAL_TRANSFORMERS_PROVIDER,
      source: LOCAL_TRANSFORMERS_SOURCE,
      codePath: LOCAL_TRANSFORMERS_CODE_PATH,
      model: config.modelId,
      modelDir: config.modelDir,
      runnerPath: config.runnerPath,
      python: config.python,
      operation,
      exitCode: error.code ?? null,
      signal: error.signal ?? null,
      error: redactLongText(error.message, 4000),
      stderr: redactLongText(error.stderr || "", 8000),
      stdout: redactLongText(error.stdout || "", 4000),
    });
    throw error;
  } finally {
    await fsp.rm(requestDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function generateInitialBreakdown({ taskInput, file, requestId, signal }) {
  const config = getGemmaConfig();
  const instruction = `
You are a task decomposition engine for a productivity MVP.

Use the user's typed input and/or uploaded file to infer the overall task and break it into EXACTLY 3 top-level subtasks.

Rules:
- Return VALID JSON only.
- Return compact JSON only: no markdown, no prose, no comments.
- Output exactly 3 top-level subtasks.
- The 3 subtasks must be parallel, non-overlapping, and together cover the full task.
- Make titles action-oriented and concise.
- Make descriptions concrete and useful, 16 words max.
- Priorities must be 1, 2, 3 in order.
- estimatedMinutes should be an integer from 5 to 30.
- status must be "pending".
- children must be [].
- If the typed input is empty, infer the task from the uploaded file.
- If the upload is a screenshot, handwritten photo, or other image, inspect the pixels directly for visible deadlines, deliverables, rubric items, and course context.
- For handwriting or blurry screenshots, use only legible details and reflect uncertainty in rootDescription instead of inventing facts.
- rootTitle should be concise and UI-friendly.
- rootDescription should summarize the goal and any key constraints you can infer.

JSON shape:
{
  "rootTitle": "string",
  "rootDescription": "string",
  "steps": [
    {
      "id": "step-1",
      "title": "string",
      "desc": "string",
      "estimatedMinutes": 10,
      "priority": 1,
      "status": "pending",
      "children": []
    }
  ]
}

Typed input:
${taskInput?.trim() || "<empty>"}

${getFileSummaryText(file)}
`.trim();

  const parts = [{ text: instruction }];
  const filePart = buildFilePart(file, {
    maxTextChars: config.initialContextChars,
    anchors: [taskInput],
  });
  if (filePart) parts.push(filePart);

  try {
    const data = await callGemma(parts, { requestId, operation: "initial-breakdown", signal });
    const providerMeta = data.meta || {};
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = safeJsonParse(content);

    if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length !== 3) {
      writeLog("info", "gemma.fallback.initial", {
        requestId,
        message: "Gemma provider returned an invalid initial breakdown shape. Falling back to deterministic rules.",
        provider: providerMeta.provider || "unknown",
        source: providerMeta.source || null,
        codePath: providerMeta.codePath || null,
        model: providerMeta.model || null,
        nextProvider: LOCAL_RULES_PROVIDER,
        fallbackCodePath: LOCAL_RULES_CODE_PATH,
        contentPreview: redactLongText(content, 1200),
      });
      return buildLocalInitialBreakdown(taskInput, file);
    }

    return {
      rootTitle: sanitizeTitle(parsed.rootTitle, sanitizeTitle(taskInput || (file?.originalName || file?.name || "Uploaded Task").replace(/\.[^.]+$/, ""))),
      rootDescription: parsed.rootDescription || taskInput || `Plan derived from ${file?.originalName || file?.name || "uploaded file"}.`,
      steps: parsed.steps.slice(0, 3).map((step, index) => ({
        id: `step-${index + 1}`,
        title: sanitizeTitle(step.title, `Step ${index + 1}`),
        desc: step.desc || "",
        estimatedMinutes: Number(step.estimatedMinutes) || 10,
        priority: index + 1,
        status: "pending",
        children: [],
      })),
      source: providerMeta.provider || "gemma",
    };
  } catch (error) {
    if (error.name === "AbortError") throw error;
    writeLog("info", "gemma.fallback.initial", {
      requestId,
      message: "Initial breakdown fell back to deterministic local generation.",
      provider: LOCAL_RULES_PROVIDER,
      source: "deterministic-local-rules",
      codePath: LOCAL_RULES_CODE_PATH,
      previousProvider: "runtime-router",
      error: error.message,
    });
    return buildLocalInitialBreakdown(taskInput, file);
  }
}

async function generateNodeBreakdown({ rootContext, targetNode, parentNode, file, requestId }) {
  const config = getGemmaConfig();
  const instruction = `
You are decomposing ONE selected subtask into EXACTLY 3 child subtasks.

Rules:
- Return VALID JSON only.
- Return compact JSON only: no markdown, no prose, no comments.
- Stay strictly within the selected subtask's scope.
- Do NOT expand back out to the whole project or overlap with sibling top-level tasks.
- If the original upload is an image, keep using the visible screenshot/photo content as context.
- Output exactly 3 child subtasks.
- Make them sequential and concrete.
- Titles should be concise and action-oriented.
- Descriptions should be specific and useful, 16 words max.
- priority must be 1, 2, 3.
- estimatedMinutes should be an integer from 5 to 25.
- status must be "pending".
- children must be [].

JSON shape:
{
  "steps": [
    {
      "id": "child-1",
      "title": "string",
      "desc": "string",
      "estimatedMinutes": 10,
      "priority": 1,
      "status": "pending",
      "children": []
    }
  ]
}

Original typed input:
${rootContext?.originalTaskInput?.trim() || "<empty>"}

Root task:
- Title: ${rootContext?.rootTitle || ""}
- Description: ${rootContext?.rootDescription || ""}

Parent scope:
- Title: ${parentNode?.title || rootContext?.rootTitle || ""}
- Description: ${parentNode?.desc || rootContext?.rootDescription || ""}

Selected subtask to expand:
- Title: ${targetNode?.title || ""}
- Description: ${targetNode?.desc || ""}

${getFileSummaryText(file)}
`.trim();

  const parts = [{ text: instruction }];
  const filePart = buildFilePart(file, {
    maxTextChars: config.nodeContextChars,
    anchors: [
      targetNode?.title,
      targetNode?.desc,
      parentNode?.title,
      rootContext?.rootTitle,
    ],
  });
  if (filePart) parts.push(filePart);

  try {
    const data = await callGemma(parts, { requestId, operation: "breakdown-node" });
    const providerMeta = data.meta || {};
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = safeJsonParse(content);

    if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length !== 3) {
      writeLog("info", "gemma.fallback.breakdown-node", {
        requestId,
        message: "Gemma provider returned an invalid child breakdown shape. Falling back to deterministic rules.",
        provider: providerMeta.provider || "unknown",
        source: providerMeta.source || null,
        codePath: providerMeta.codePath || null,
        model: providerMeta.model || null,
        nextProvider: LOCAL_RULES_PROVIDER,
        fallbackCodePath: LOCAL_RULES_CODE_PATH,
        contentPreview: redactLongText(content, 1200),
      });
      return buildLocalChildBreakdown(targetNode?.title);
    }

    return {
      steps: parsed.steps.slice(0, 3).map((step, index) => ({
        id: `child-${index + 1}`,
        title: sanitizeTitle(step.title, `Sub-step ${index + 1}`),
        desc: step.desc || "",
        estimatedMinutes: Number(step.estimatedMinutes) || 10,
        priority: index + 1,
        status: "pending",
        children: [],
      })),
      source: providerMeta.provider || "gemma",
    };
  } catch (error) {
    writeLog("info", "gemma.fallback.breakdown-node", {
      requestId,
      message: "Child breakdown fell back to deterministic local generation.",
      provider: LOCAL_RULES_PROVIDER,
      source: "deterministic-local-rules",
      codePath: LOCAL_RULES_CODE_PATH,
      previousProvider: "runtime-router",
      error: error.message,
    });
    return buildLocalChildBreakdown(targetNode?.title);
  }
}

async function regenerateSingleNode({ rootContext, parentNode, targetNode, siblingNodes, slotIndex, file, requestId }) {
  const config = getGemmaConfig();
  const siblingSummary = (siblingNodes || [])
    .map((node, index) => `- Slot ${index + 1}: ${node.title} :: ${node.desc || ""}`)
    .join("\n");

  const instruction = `
You are regenerating ONLY ONE selected subtask in a task planner.

Rules:
- Return VALID JSON only.
- Output exactly one step object under the key "step".
- Keep the regenerated step in the SAME semantic lane as the current selected step.
- Keep it appropriate for slot ${slotIndex + 1} among its siblings.
- Do NOT absorb or duplicate the responsibilities of sibling steps.
- Do NOT rewrite the whole plan.
- If the original upload is an image, keep the regenerated step grounded in visible screenshot/photo details.
- Make the wording clearer and more specific.
- status must be "pending".
- children must be [].

JSON shape:
{
  "step": {
    "id": "slot-${slotIndex + 1}",
    "title": "string",
    "desc": "string",
    "estimatedMinutes": 10,
    "priority": ${slotIndex + 1},
    "status": "pending",
    "children": []
  }
}

Original typed input:
${rootContext?.originalTaskInput?.trim() || "<empty>"}

Root task:
- Title: ${rootContext?.rootTitle || ""}
- Description: ${rootContext?.rootDescription || ""}

Parent scope:
- Title: ${parentNode?.title || rootContext?.rootTitle || ""}
- Description: ${parentNode?.desc || rootContext?.rootDescription || ""}

Sibling list for guardrails:
${siblingSummary || "<none>"}

Selected step to regenerate (slot ${slotIndex + 1}):
- Title: ${targetNode?.title || ""}
- Description: ${targetNode?.desc || ""}

${getFileSummaryText(file)}
`.trim();

  const parts = [{ text: instruction }];
  const filePart = buildFilePart(file, {
    maxTextChars: config.regenerateContextChars,
    anchors: [
      targetNode?.title,
      targetNode?.desc,
      parentNode?.title,
    ],
  });
  if (filePart) parts.push(filePart);

  try {
    const data = await callGemma(parts, { requestId, operation: "regenerate-node" });
    const providerMeta = data.meta || {};
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = safeJsonParse(content);

    if (!parsed?.step) {
      writeLog("info", "gemma.fallback.regenerate-node", {
        requestId,
        message: "Gemma provider returned an invalid regenerate-node shape. Falling back to deterministic rules.",
        provider: providerMeta.provider || "unknown",
        source: providerMeta.source || null,
        codePath: providerMeta.codePath || null,
        model: providerMeta.model || null,
        nextProvider: LOCAL_RULES_PROVIDER,
        fallbackCodePath: LOCAL_RULES_CODE_PATH,
      });
      return buildLocalRegeneratedStep(targetNode, slotIndex);
    }

    return {
      step: {
        id: targetNode?.id || `slot-${slotIndex + 1}`,
        title: sanitizeTitle(parsed.step.title, sanitizeTitle(targetNode?.title, `Step ${slotIndex + 1}`)),
        desc: parsed.step.desc || targetNode?.desc || "",
        estimatedMinutes: Number(parsed.step.estimatedMinutes) || targetNode?.estimatedMinutes || 10,
        priority: slotIndex + 1,
        status: "pending",
        children: [],
      },
      source: providerMeta.provider || "gemma",
    };
  } catch (error) {
    writeLog("info", "gemma.fallback.regenerate-node", {
      requestId,
      message: "Regenerate-node fell back to deterministic local generation.",
      provider: LOCAL_RULES_PROVIDER,
      source: "deterministic-local-rules",
      codePath: LOCAL_RULES_CODE_PATH,
      previousProvider: "runtime-router",
      error: error.message,
    });
    return buildLocalRegeneratedStep(targetNode, slotIndex);
  }
}


// ================= STATS API + LOCAL JSON STORAGE =================
// Stats functions are in statsStore.js; imported at the top.

app.use("/api/monitor", monitorRouter);

app.get("/api/stats", (req, res) => {
  const data = readStatsData();
  res.json(computeStats(data));
});

app.post("/api/stats/focus-session", (req, res) => {
  const { taskId, taskTitle, minutes, startedAt, endedAt } = req.body ?? {};
  const safeMinutes = Math.max(0, toSafeNumber(minutes));

  if (!taskId || safeMinutes <= 0) {
    return res.status(400).json({ error: "taskId and positive minutes are required." });
  }

  const data = readStatsData();
  data.focusSessions.push({
    id: crypto.randomUUID(),
    taskId,
    taskTitle: taskTitle || "Untitled Task",
    minutes: safeMinutes,
    startedAt: startedAt || new Date().toISOString(),
    endedAt: endedAt || new Date().toISOString(),
  });

  writeStatsData(data);
  res.json(computeStats(data));
});

app.post("/api/stats/completed-task", (req, res) => {
  const { taskId, taskTitle, estimatedMinutes, completedAt } = req.body ?? {};

  if (!taskId) {
    return res.status(400).json({ error: "taskId is required." });
  }

  const data = readStatsData();
  const alreadyCompleted = data.completedTasks.some((task) => task.taskId === taskId);

  if (!alreadyCompleted) {
    data.completedTasks.push({
      id: crypto.randomUUID(),
      taskId,
      taskTitle: taskTitle || "Untitled Task",
      estimatedMinutes: Math.max(1, toSafeNumber(estimatedMinutes, 10)),
      completedAt: completedAt || new Date().toISOString(),
    });
    writeStatsData(data);
  }

  res.json(computeStats(data));
});

app.post("/api/stats/distraction", (req, res) => {
  const { appName, source, minutes, timestamp } = req.body ?? {};
  const safeMinutes = Math.max(1, toSafeNumber(minutes, 1));
  const data = readStatsData();

  data.distractionEvents.push({
    id: crypto.randomUUID(),
    appName: appName || source || "Unknown",
    minutes: safeMinutes,
    timestamp: timestamp || new Date().toISOString(),
  });

  writeStatsData(data);
  res.json(computeStats(data));
});

app.get("/api/provider/health", (req, res) => {
  res.json(getProviderHealth());
});

app.post("/api/replan", async (req, res) => {
  const requestId = crypto.randomUUID();
  let request;
  try {
    request = normalizeReplanRequest(req.body ?? {});
  } catch (error) {
    writeLog("error", "replan.request.invalid", { requestId, message: error.message });
    return res.status(400).json({ error: error.message, requestId });
  }

  writeLog("info", "replan.request.received", {
    requestId,
    summary: "Received an adaptive recovery request.",
    rootTaskId: request.rootTask.id,
    activeTaskId: request.activeTaskId,
    planVersion: request.planVersion,
    delayMinutes: request.delayMinutes,
    availableMinutes: request.availableMinutes,
    reason: request.reason,
  });

  try {
    const data = await callGemma([{ text: buildReplanPrompt(request) }], { requestId, operation: "adaptive-replan" });
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const proposal = normalizeModelProposal(safeJsonParse(content), request);
    proposal.provider = data.meta?.provider || "gemma";
    writeLog("info", "replan.request.succeeded", {
      requestId,
      summary: "Generated and validated an adaptive recovery proposal.",
      provider: proposal.provider,
      changeCount: proposal.changes.length,
      feasible: proposal.feasible,
    });
    return res.json({ ...proposal, requestId });
  } catch (error) {
    const proposal = buildDeterministicReplan(request);
    writeLog("info", "replan.fallback.used", {
      requestId,
      summary: "Adaptive recovery used the deterministic fallback.",
      error: error.message,
      changeCount: proposal.changes.length,
      feasible: proposal.feasible,
    });
    return res.json({ ...proposal, requestId });
  }
});

app.post("/api/breakdown", async (req, res) => {
  const requestId = crypto.randomUUID();
  const { mode = "initial" } = req.body ?? {};
  const requestController = new AbortController();
  const abortRequest = () => {
    if (!res.writableEnded) requestController.abort();
  };
  req.on("aborted", abortRequest);
  res.on("close", abortRequest);

  try {
    await pruneOldContexts();

    writeLog("info", "request.received", {
      requestId,
      mode,
      summary: `Received ${mode} request.`,
    });

    if (mode === "initial") {
      const { taskInput = "", file = null } = req.body ?? {};
      const trimmedTaskInput = typeof taskInput === "string" ? taskInput.trim() : "";
      const hasTaskInput = trimmedTaskInput.length > 0;
      const hasFile = Boolean(file?.dataBase64);

      writeLog("info", "request.user-action", {
        requestId,
        mode,
        summary: hasFile && hasTaskInput
          ? "User submitted text plus a file for initial breakdown."
          : hasFile
            ? "User submitted a file-only initial breakdown request."
            : "User submitted a text-only initial breakdown request.",
        taskInputPreview: redactLongText(trimmedTaskInput),
        hasTaskInput,
        hasFile,
        file: hasFile
          ? {
              name: file.name || null,
              mimeType: getNormalizedMimeType(file),
              size: Number(file.size || 0),
            }
          : null,
      });

      if (!hasTaskInput && !hasFile) {
        throw new AppError("Please enter a task or upload a file before sending.", {
          statusCode: 400,
          publicMessage: "Please enter a task or upload a file before sending.",
        });
      }

      const processedFile = hasFile ? await prepareFileForGemma(file, requestId) : null;
      const contextId = crypto.randomUUID();

      await persistContext(contextId, {
        createdAt: Date.now(),
        taskInput: trimmedTaskInput,
        file: processedFile,
      });

      const result = await generateInitialBreakdown({
        taskInput: trimmedTaskInput,
        file: processedFile,
        requestId,
        signal: requestController.signal,
      });

      writeLog("info", "request.succeeded", {
        requestId,
        mode,
        contextId,
        summary: `Completed ${mode} request successfully.`,
        source: result.source,
        file: buildFileMetaForLogs(processedFile),
      });

      return res.json({
        ...result,
        contextId,
        requestId,
      });
    }

    const { contextId, rootContext, targetNode, parentNode, siblingNodes = [] } = req.body ?? {};
    let storedContext = await loadStoredContext(contextId);
    if (!storedContext) {
      storedContext = {
        createdAt: Date.now(),
        taskInput: rootContext?.originalTaskInput || rootContext?.rootDescription || rootContext?.rootTitle || "",
        file: null,
        recoveredFromPayload: true,
      };
      writeLog("info", "context.recovered.from-payload", {
        requestId,
        mode,
        contextId: contextId || null,
        message: "Original context was not found on disk; continuing with root/task payload only.",
      });
    } else {
      storedContext.createdAt = Date.now();
      storedContext.updatedAt = Date.now();
      if (contextId) {
        await persistContext(contextId, storedContext).catch((error) => {
          writeLog("error", "context.persist.failed", { requestId, contextId, error: error.message });
        });
      }
    }

    writeLog("info", "request.user-action", {
      requestId,
      mode,
      contextId,
      summary:
        mode === "breakdown-node"
          ? "User requested a deeper breakdown for a single subtask."
          : mode === "regenerate-node"
            ? "User requested regenerate for a single subtask."
            : `User requested ${mode}.`,
      targetNode: targetNode
        ? {
            id: targetNode.id || null,
            title: targetNode.title || null,
            descPreview: redactLongText(targetNode.desc || ""),
          }
        : null,
      parentNode: parentNode
        ? {
            id: parentNode.id || null,
            title: parentNode.title || null,
          }
        : null,
      hasOriginalFile: Boolean(storedContext.file),
      originalTaskInputPreview: redactLongText(storedContext.taskInput || ""),
    });

    if (!targetNode?.id) {
      throw new AppError("targetNode is required", {
        statusCode: 400,
        publicMessage: "targetNode is required.",
      });
    }

    if (mode === "breakdown-node") {
      const result = await generateNodeBreakdown({
        rootContext: {
          ...rootContext,
          originalTaskInput: storedContext.taskInput,
        },
        targetNode,
        parentNode,
        file: storedContext.file,
        requestId,
      });

      writeLog("info", "request.succeeded", {
        requestId,
        mode,
        contextId,
        summary: `Completed ${mode} request successfully.`,
        source: result.source,
      });

      return res.json({
        ...result,
        requestId,
      });
    }

    if (mode === "regenerate-node") {
      const slotIndex = Math.max(0, siblingNodes.findIndex((node) => node.id === targetNode.id));
      const result = await regenerateSingleNode({
        rootContext: {
          ...rootContext,
          originalTaskInput: storedContext.taskInput,
        },
        parentNode,
        targetNode,
        siblingNodes,
        slotIndex,
        file: storedContext.file,
        requestId,
      });

      writeLog("info", "request.succeeded", {
        requestId,
        mode,
        contextId,
        summary: `Completed ${mode} request successfully.`,
        source: result.source,
      });

      return res.json({
        ...result,
        requestId,
      });
    }

    throw new AppError("Unsupported breakdown mode", {
      statusCode: 400,
      publicMessage: "Unsupported breakdown mode.",
    });
  } catch (error) {
    if (error.name === "AbortError" || requestController.signal.aborted) {
      writeLog("info", "request.cancelled", {
        requestId,
        mode,
        summary: `User cancelled ${mode} generation.`,
      });
      return;
    }
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    const publicMessage = error instanceof AppError ? error.publicMessage : "Internal server error";
    const details = error instanceof AppError ? error.details : error.message;

    writeLog("error", "request.failed", {
      requestId,
      mode,
      message: `Request failed while handling ${mode}.`,
      error: error.message,
      details,
      stack: error.stack,
    });

    return res.status(statusCode).json({
      error: publicMessage,
      requestId,
    });
  }
});

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  app.listen(PORT, () => {
  recoverCrashedSessions();
  startHeartbeat();
  const agent = maybeStartMonitorAgent({ apiBase: `http://localhost:${PORT}` });
  const provider = getProviderHealth();
  console.log(`Local AI server running at http://localhost:${PORT}`);
  console.log(`Gemma runtime router: ${provider.runtimePriority.join(" -> ")}`);
  console.log(`Ollama provider: ${provider.ollamaUrl}, model=${provider.ollamaModel}`);
  console.log(`Local Transformers provider: model=${provider.localTransformersModel}, modelDir=${provider.localTransformersModelDir}`);
  console.log(`Local Transformers runner: ${provider.localTransformersRunnerPath}`);
  console.log(`Google AI Studio provider: ${provider.googleApiKeySet ? "configured" : "not configured"}, cloud-call-count=${provider.cloudCallCount}`);
  console.log(`Deterministic fallback provider: ${provider.deterministicFallback}`);
  console.log(`Request logs: ${LOG_DIR}`);
  if (agent.started) {
    console.log(`Monitor agent restored for active session.`);
  }
  });
}

export default app;

process.on("exit", () => {
  if (gemmaWorker && !gemmaWorker.closed) gemmaWorker.kill();
});
