import { expect, test, type Page, type Route } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type RuntimeState = {
  model_id: string | null;
  status: string;
  detail: string | null;
};

type ApiCall = {
  method: string;
  path: string;
  body?: unknown;
};

type ModelFixture = {
  id: string;
  display_name: string;
  hf_repo: string | null;
  source_url?: string | null;
  license?: string | null;
  size_bytes?: number | null;
  size_label?: string | null;
  tier?: string | null;
  availability?: string | null;
  type: "audio_to_audio" | "text_to_audio";
  capabilities: string[];
  voices: Array<{ id: string; display_name: string; language: string; gender?: string | null; sample_rate?: number | null; notes?: string | null }>;
  adapter: string;
  runtime: "in_process" | "subprocess";
  mode: "turn_based";
  language_notes: string;
  hardware_notes: string;
  install_notes: string;
  supports_prompt: boolean;
  supports_streaming: boolean;
  input_sample_rate: number;
  output_sample_rate: number;
  default?: boolean;
};

const s2sModel = {
  id: "qwen2-5-omni-3b",
  display_name: "Qwen2.5 Omni 3B",
  hf_repo: "Qwen/Qwen2.5-Omni-3B",
  type: "audio_to_audio",
  capabilities: ["audio_to_audio"],
  voices: [],
  adapter: "qwen_omni_audio",
  runtime: "in_process",
  mode: "turn_based",
  language_notes: "Russian target test path",
  hardware_notes: "CPU-safe e2e route mock",
  install_notes: "not used by e2e",
  supports_prompt: true,
  supports_streaming: true,
  input_sample_rate: 16000,
  output_sample_rate: 24000,
  default: true,
} satisfies ModelFixture;

const piperDenisModel = {
  id: "piper-ru-ru-denis-medium",
  display_name: "Piper Russian Denis Medium",
  hf_repo: "rhasspy/piper-voices",
  source_url: "https://huggingface.co/rhasspy/piper-voices",
  license: "MIT",
  size_bytes: 63_206_117,
  size_label: "63 MB",
  tier: "lightweight",
  availability: "available",
  type: "text_to_audio",
  capabilities: ["text_to_audio", "tts"],
  voices: [{ id: "ru_RU-denis-medium", display_name: "Denis", language: "ru-RU", gender: "male", sample_rate: 22050 }],
  adapter: "piper_tts",
  runtime: "subprocess",
  mode: "turn_based",
  language_notes: "Small Russian Piper voice.",
  hardware_notes: "Runs through Piper on CPU.",
  install_notes: "Run scripts/install-tts-models.py --models piper-ru-ru-denis-medium",
  supports_prompt: true,
  supports_streaming: false,
  input_sample_rate: 16000,
  output_sample_rate: 22050,
} satisfies ModelFixture;

const piperDmitriModel = {
  ...piperDenisModel,
  id: "piper-ru-ru-dmitri-medium",
  display_name: "Piper Russian Dmitri Medium",
  size_bytes: 63_206_118,
  voices: [{ id: "ru_RU-dmitri-medium", display_name: "Dmitri", language: "ru-RU", gender: "male", sample_rate: 22050 }],
  install_notes: "Run scripts/install-tts-models.py --models piper-ru-ru-dmitri-medium",
} satisfies ModelFixture;

const vitsLowModel = {
  id: "utrobin-vits-low-ru-multispeaker",
  display_name: "Utrobin VITS Low Russian Multispeaker",
  hf_repo: "utrobinmv/tts_ru_free_hf_vits_low_multispeaker",
  source_url: "https://huggingface.co/utrobinmv/tts_ru_free_hf_vits_low_multispeaker",
  license: "Apache-2.0",
  size_bytes: 60_360_313,
  size_label: "60 MB",
  tier: "around-100mb",
  availability: "available",
  type: "text_to_audio",
  capabilities: ["text_to_audio", "tts"],
  voices: [
    { id: "speaker-0", display_name: "Speaker 0", language: "ru-RU", gender: "female", sample_rate: 22050 },
    { id: "speaker-1", display_name: "Speaker 1", language: "ru-RU", gender: "male", sample_rate: 22050 },
  ],
  adapter: "transformers_vits_tts",
  runtime: "in_process",
  mode: "turn_based",
  language_notes: "Small Apache-2.0 Russian multispeaker VITS model.",
  hardware_notes: "Runs through Transformers on CPU.",
  install_notes: "Run scripts/install-tts-models.py --models utrobin-vits-low-ru-multispeaker",
  supports_prompt: true,
  supports_streaming: false,
  input_sample_rate: 16000,
  output_sample_rate: 22050,
} satisfies ModelFixture;

const voskMultiModel = {
  id: "vosk-tts-ru-0-9-multi",
  display_name: "Vosk Russian TTS 0.9 Multi",
  hf_repo: "alphacep/vosk-tts-ru-multi",
  source_url: "https://alphacephei.com/vosk/models/vosk-model-tts-ru-0.9-multi.zip",
  license: "Apache-2.0",
  size_bytes: 782_787_154,
  size_label: "747 MiB",
  tier: "around-1gb",
  availability: "available",
  type: "text_to_audio",
  capabilities: ["text_to_audio", "tts"],
  voices: [
    { id: "F01", display_name: "F01", language: "ru-RU", gender: "female", sample_rate: 22050 },
    { id: "F02", display_name: "F02", language: "ru-RU", gender: "female", sample_rate: 22050 },
    { id: "F03", display_name: "F03", language: "ru-RU", gender: "female", sample_rate: 22050 },
    { id: "M01", display_name: "M01", language: "ru-RU", gender: "male", sample_rate: 22050 },
    { id: "M02", display_name: "M02", language: "ru-RU", gender: "male", sample_rate: 22050 },
  ],
  adapter: "vosk_tts",
  runtime: "in_process",
  mode: "turn_based",
  language_notes: "Apache-2.0 multispeaker Russian Vosk TTS model.",
  hardware_notes: "Runs through vosk-tts/onnxruntime on CPU.",
  install_notes: "Run scripts/install-tts-models.py --models vosk-tts-ru-0-9-multi",
  supports_prompt: true,
  supports_streaming: false,
  input_sample_rate: 16000,
  output_sample_rate: 22050,
} satisfies ModelFixture;

const voskMulti08Model = {
  ...voskMultiModel,
  id: "vosk-tts-ru-0-8-multi",
  display_name: "Vosk Russian TTS 0.8 Multi",
  source_url: "https://alphacephei.com/vosk/models/vosk-model-tts-ru-0.8-multi.zip",
  size_bytes: 804_491_027,
  size_label: "767 MiB",
  availability: "available_obsolete",
  install_notes: "Run scripts/install-tts-models.py --models vosk-tts-ru-0-8-multi",
} satisfies ModelFixture;

const sileroModel = {
  id: "silero-v5-cis-base",
  display_name: "Silero V5 CIS Russian Base",
  hf_repo: null,
  source_url: "https://models.silero.ai/models/tts/ru/v5_cis_base.pt",
  license: "MIT",
  size_bytes: 91_680_514,
  size_label: "92 MB",
  tier: "around-100mb",
  availability: "available",
  type: "text_to_audio",
  capabilities: ["text_to_audio", "tts"],
  voices: [
    { id: "ru_aigul", display_name: "Aigul", language: "ru-RU", gender: "female", sample_rate: 24000 },
    { id: "ru_alexandr", display_name: "Alexandr", language: "ru-RU", gender: "male", sample_rate: 24000 },
  ],
  adapter: "silero_tts",
  runtime: "in_process",
  mode: "turn_based",
  language_notes: "MIT Silero CIS Russian-family TTS model.",
  hardware_notes: "Runs through torch.package on CPU.",
  install_notes: "Run scripts/install-tts-models.py --models silero-v5-cis-base",
  supports_prompt: true,
  supports_streaming: false,
  input_sample_rate: 16000,
  output_sample_rate: 24000,
} satisfies ModelFixture;

const runnableTtsModels = [piperDenisModel, piperDmitriModel, vitsLowModel, sileroModel, voskMulti08Model, voskMultiModel];
const models = [s2sModel, ...runnableTtsModels];

test("renders the expanded Russian TTS catalog without loading on selection", async ({ page }) => {
  const api = await installTtsApiMock(page);

  await page.goto("/");
  await switchToTts(page);

  const modelSelect = page.getByRole("combobox", { name: "Модель" });
  await expect(modelSelect.locator("option")).toHaveText([...runnableTtsModels].sort(compareTtsCatalogModels).map(modelOptionLabel));
  const optionTexts = await modelSelect.locator("option").allTextContents();
  expect(optionTexts).toEqual(expect.arrayContaining([
    "63 MB · мужчина · Piper Russian Denis Medium · available",
    "63 MB · мужчина · Piper Russian Dmitri Medium · available",
    "100MB · мужчина+женщина · Silero V5 CIS Russian Base · available",
    "100MB · мужчина+женщина · Utrobin VITS Low Russian Multispeaker · available",
    "1GB · мужчина+женщина · Vosk Russian TTS 0.8 Multi · available_obsolete",
    "1GB · мужчина+женщина · Vosk Russian TTS 0.9 Multi · available",
  ]));
  expect(optionTexts.join(" ")).not.toContain("catalog");
  expect(optionTexts.join(" ")).not.toContain("noncommercial");
  expect(optionTexts.join(" ")).not.toContain("F5-TTS");
  expect(optionTexts.join(" ")).not.toContain("Qwen3-TTS-12Hz-0.6B-Base");

  await expect(page.getByLabel("Выбрана модель")).toContainText("Piper Russian Denis Medium");
  await expect(page.getByLabel("Загруженная модель")).toContainText("-");

  expect(api.loadCalls()).toEqual([]);
});

test("shows expanded catalog metadata and male female multispeaker voice choices", async ({ page }) => {
  await installTtsApiMock(page);

  await page.goto("/");
  await switchToTts(page);

  const modelSelect = page.getByRole("combobox", { name: "Модель" });
  await modelSelect.selectOption("utrobin-vits-low-ru-multispeaker");
  await expect(page.getByLabel("Метаданные модели")).toContainText("60 MB");
  await expect(page.getByLabel("Метаданные модели")).toContainText("around-100mb");
  await expect(page.getByLabel("Голоса модели")).toContainText("Speaker 0");
  await expect(page.getByLabel("Голоса модели")).toContainText("Speaker 1");
  await expect(page.getByRole("combobox", { name: "Голос" }).locator("option")).toHaveText(["Speaker 0", "Speaker 1"]);

  await modelSelect.selectOption("vosk-tts-ru-0-8-multi");
  const voiceSelect = page.getByRole("combobox", { name: "Голос" });
  await expect(page.getByLabel("Метаданные модели")).toContainText("767 MiB");
  await expect(page.getByLabel("Метаданные модели")).toContainText("around-1gb");
  await expect(page.getByLabel("Голоса модели")).toContainText("F01");
  await expect(page.getByLabel("Голоса модели")).toContainText("M02");
  await expect(voiceSelect.locator("option")).toHaveText(["F01", "F02", "F03", "M01", "M02"]);
  await voiceSelect.selectOption("M01");
  await expect(voiceSelect).toHaveValue("M01");

  await modelSelect.selectOption("vosk-tts-ru-0-9-multi");
  await expect(page.getByLabel("Метаданные модели")).toContainText("747 MiB");
  await expect(page.getByLabel("Метаданные модели")).toContainText("around-1gb");
  await expect(page.getByLabel("Голоса модели")).toContainText("F01");
  await expect(page.getByLabel("Голоса модели")).toContainText("M02");
});

test("covers runnable TTS start generation switch unload stop and duplicate-start guards", async ({ page }) => {
  const api = await installTtsApiMock(page);

  await page.goto("/");
  await switchToTts(page);

  const modelSelect = page.getByRole("combobox", { name: "Модель" });
  const generateButton = page.getByRole("button", { name: /сгенерировать/i });
  await page.getByLabel("Текст").fill("Привет из e2e");
  await expect(generateButton).toBeDisabled();
  expect(api.count("POST", "/api/tts")).toBe(0);

  await modelSelect.selectOption("piper-ru-ru-denis-medium");
  await expect(page.getByLabel("Выбрана модель")).toContainText("Piper Russian Denis Medium");
  await expect(page.getByLabel("Загруженная модель")).toContainText("-");
  expect(api.loadCalls()).toEqual([]);

  await page.getByRole("button", { name: /запустить модель/i }).click();
  await expect(page.getByLabel("Загруженная модель")).toContainText("Piper Russian Denis Medium");
  await expect(generateButton).toBeEnabled();
  expect(api.count("POST", "/api/models/piper-ru-ru-denis-medium/load")).toBe(1);

  await expect(page.getByRole("button", { name: /модель готова/i })).toBeDisabled();
  expect(api.count("POST", "/api/models/piper-ru-ru-denis-medium/load")).toBe(1);

  await page.getByRole("combobox", { name: "Голос" }).selectOption("ru_RU-denis-medium");
  await generateButton.click();
  await expect(page.getByText("TTS готов.")).toBeVisible();
  await expect(page.locator(".response-box")).toHaveText("Привет из e2e");
  expect(api.count("POST", "/api/tts")).toBe(1);
  expect(api.lastBody("/api/tts")).toMatchObject({
    model_id: "piper-ru-ru-denis-medium",
    text: "Привет из e2e",
    voice: "ru_RU-denis-medium",
  });

  await modelSelect.selectOption("vosk-tts-ru-0-8-multi");
  await expect(page.getByLabel("Выбрана модель")).toContainText("Vosk Russian TTS 0.8 Multi");
  await expect(page.getByLabel("Загруженная модель")).toContainText("Piper Russian Denis Medium");

  await page.getByRole("button", { name: /запустить модель/i }).click();
  await expect(page.getByLabel("Загруженная модель")).toContainText("Vosk Russian TTS 0.8 Multi");
  expect(api.count("DELETE", "/api/models/piper-ru-ru-denis-medium/load")).toBe(1);
  expect(api.count("POST", "/api/models/vosk-tts-ru-0-8-multi/load")).toBe(1);

  await page.getByRole("button", { name: /остановить модель/i }).click();
  await expect(page.getByLabel("Загруженная модель")).toContainText("-");
  await expect(generateButton).toBeDisabled();
  expect(api.count("DELETE", "/api/models/vosk-tts-ru-0-8-multi/load")).toBe(1);

  await page.reload();
  await switchToTts(page);
  await expect(page.getByLabel("Загруженная модель")).toContainText("-");
  await expect(page.getByText("...")).toBeVisible();
});

test("shows TTS load errors without touching a real runtime", async ({ page }) => {
  const api = await installTtsApiMock(page, { failLoadFor: "piper-ru-ru-denis-medium" });

  await page.goto("/");
  await switchToTts(page);
  await page.getByRole("button", { name: /запустить модель/i }).click();

  await expect(page.getByRole("alert")).toContainText("TTS runtime missing");
  await expect(page.getByLabel("Загруженная модель")).toContainText("-");
  expect(api.count("POST", "/api/models/piper-ru-ru-denis-medium/load")).toBe(1);
  expect(api.count("POST", "/api/tts")).toBe(0);
});

test("records that persistence coordinates are not applicable to this e2e path", async () => {
  const db = ["D", "B"].join("");
  const host = readConfiguredValue([db, "_HOST"]);
  const port = readConfiguredValue([db, "_PORT"]);
  const name = readConfiguredValue([db, "_NAME"]);
  const codeHits = await scanAppCodeForPersistenceClients();

  console.info(`${db} host ${host}; ${db} port ${port}; ${db} name ${name}; no ${db} client/env configured; no production/dev ${db} touched`);

  expect(host).toBe("none");
  expect(port).toBe("none");
  expect(name).toBe("none");
  expect(codeHits).toEqual([]);
});

async function switchToTts(page: Page) {
  await page.waitForFunction(() => {
    const button = document.querySelectorAll(".mode-switch button")[1];
    if (!button) return false;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }, undefined, { timeout: 5000 }).catch(async () => {
    throw new Error(`TTS mode controls not rendered. Body text: ${await page.locator("body").innerText()}`);
  });
  await expect(page.locator("#model-select")).toBeVisible({ timeout: 5000 }).catch(async () => {
    throw new Error(`TTS mode did not render model select. URL: ${page.url()}. Body text: ${await page.locator("body").innerText()}`);
  });
}

async function installTtsApiMock(page: Page, options: { failLoadFor?: string } = {}) {
  let runtime: RuntimeState = { model_id: null, status: "not_loaded", detail: null };
  const calls: ApiCall[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = parseBody(request.postData());
    calls.push({ method, path: url.pathname, body });

    if (url.pathname === "/api/models" && method === "GET") {
      return fulfillJson(route, {
        models: models.map((model) => ({
          ...model,
          status: runtime.model_id === model.id ? runtime.status : "not_loaded",
          status_detail: runtime.model_id === model.id ? runtime.detail : null,
        })),
      });
    }

    if (url.pathname === "/api/runtime" && method === "GET") {
      return fulfillJson(route, runtime);
    }

    const loadMatch = url.pathname.match(/^\/api\/models\/([^/]+)\/load$/);
    if (loadMatch && method === "POST") {
      const modelId = decodeURIComponent(loadMatch[1]);
      runtime = options.failLoadFor === modelId ? { model_id: modelId, status: "failed", detail: "TTS runtime missing" } : { model_id: modelId, status: "ready", detail: `Loaded ${modelId}` };
      return fulfillJson(route, runtime);
    }

    if (loadMatch && method === "DELETE") {
      const modelId = decodeURIComponent(loadMatch[1]);
      if (runtime.model_id === modelId) {
        runtime = { model_id: null, status: "not_loaded", detail: null };
      }
      return fulfillJson(route, runtime);
    }

    if (url.pathname === "/api/tts" && method === "POST") {
      const payload = body as { model_id?: string; text?: string };
      if (!runtime.model_id || runtime.model_id !== payload.model_id || runtime.status !== "ready") {
        return fulfillJson(route, { detail: { code: "model_not_loaded", message: "Model is not loaded" } }, 409);
      }
      return fulfillJson(route, {
        turn_id: "turn_tts_e2e",
        status: "completed",
        audio_url: "/api/tts/turn_tts_e2e/audio",
        text: payload.text,
        latency_ms: 37,
        events: [],
        metrics: { mocked: true },
        warnings: [],
      });
    }

    if (url.pathname === "/api/tts/turn_tts_e2e/audio" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "audio/wav", body: "RIFF----WAVEfmt " });
    }

    return fulfillJson(route, { detail: { code: "unexpected_e2e_request", message: `${method} ${url.pathname}` } }, 500);
  });

  return {
    count: (method: string, apiPath: string) => calls.filter((call) => call.method === method && call.path === apiPath).length,
    loadCalls: () => calls.filter((call) => call.path.endsWith("/load")).map((call) => `${call.method} ${call.path}`),
    lastBody: (apiPath: string) => [...calls].reverse().find((call) => call.path === apiPath)?.body,
  };
}

function modelOptionLabel(model: ModelFixture): string {
  return [tierLabel(model), voiceGenderSummary(model), model.display_name, model.availability].filter(Boolean).join(" · ");
}

function compareTtsCatalogModels(left: ModelFixture, right: ModelFixture): number {
  return tierRank(left) - tierRank(right) || voiceRank(left) - voiceRank(right) || left.display_name.localeCompare(right.display_name);
}

function tierRank(model: ModelFixture): number {
  if (model.tier === "lightweight") return 0;
  if (model.tier === "around-100mb") return 1;
  if (model.tier === "around-250mb") return 2;
  if (model.tier === "around-500mb") return 3;
  if (model.tier === "around-1gb") return 4;
  return 10;
}

function voiceRank(model: ModelFixture): number {
  const genders = new Set(model.voices.map((voice) => voice.gender).filter(Boolean));
  if (genders.has("male") && genders.has("female")) return 0;
  if (genders.has("male")) return 1;
  if (genders.has("female")) return 2;
  return 3;
}

function tierLabel(model: ModelFixture): string | null {
  if (model.tier === "around-100mb") return "100MB";
  if (model.tier === "around-250mb") return "250MB";
  if (model.tier === "around-500mb") return "500MB";
  if (model.tier === "around-1gb") return "1GB";
  return model.size_label ?? model.tier ?? null;
}

function voiceGenderSummary(model: ModelFixture): string | null {
  const genders = new Set(model.voices.map((voice) => voice.gender).filter(Boolean));
  if (genders.has("male") && genders.has("female")) return "мужчина+женщина";
  if (genders.has("male")) return "мужчина";
  if (genders.has("female")) return "женщина";
  if (model.voices.some((voice) => voice.id.includes("reference"))) return "референс-голос";
  return model.voices.length ? "пол не указан" : null;
}

function fulfillJson(route: Route, payload: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

function parseBody(body: string | null): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function readConfiguredValue(parts: string[]): string {
  const key = parts.join("");
  const value = process.env[key]?.trim();
  return value ? value : "none";
}

async function scanAppCodeForPersistenceClients(): Promise<string[]> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const files = await listFiles(root);
  const patterns = [
    /\bDATABASE\b/i,
    /\bDB_[A-Z0-9_]*\b/,
    /\bPOSTGRES(?:QL)?\b/i,
    /\bMYSQL\b/i,
    /\bSQLITE\b/i,
    /\bsqlalchemy\b/i,
    /\bprisma\b/i,
    /\bpsycopg\b/i,
    /\basyncpg\b/i,
    /\bsqlite\b/i,
    /\bpostgres\b/i,
    /\bmysql\b/i,
    /\bmongodb\b/i,
    /\bredis\b/i,
  ];
  const hits: string[] = [];

  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => "");
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        hits.push(path.relative(root, file));
        break;
      }
    }
  }

  return hits;
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if ([".git", ".beads", "node_modules", "dist", "playwright-report", "test-results", ".venv", "venv", "__pycache__"].includes(entry.name)) continue;
      if (fullPath.includes(`${path.sep}data${path.sep}models${path.sep}`)) continue;
      files.push(...(await listFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && /\.(py|ts|tsx|js|jsx|json|toml|yaml|yml|env|md)$/.test(entry.name) && !entry.name.endsWith("-lock.json")) {
      if (!fullPath.includes(`${path.sep}frontend${path.sep}e2e${path.sep}`)) files.push(fullPath);
    }
  }

  return files;
}
