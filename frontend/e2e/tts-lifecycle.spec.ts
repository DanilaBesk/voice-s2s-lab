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

const denisModel = {
  id: "piper-ru-ru-denis-medium",
  display_name: "Piper Russian Denis Medium",
  hf_repo: null,
  source_url: null,
  license: null,
  size_bytes: null,
  size_label: null,
  tier: null,
  availability: "available",
  type: "text_to_audio",
  capabilities: ["text_to_audio", "tts"],
  voices: [
    {
      id: "ru_RU-denis-medium",
      display_name: "Denis",
      language: "ru-RU",
      gender: "male",
      sample_rate: 22050,
      notes: "Russian Piper medium voice. Place .onnx and .onnx.json files in data/models or override paths in config.",
    },
  ],
  adapter: "piper_tts",
  runtime: "subprocess",
  mode: "turn_based",
  language_notes: "Russian text-to-speech voice for local Piper runtime.",
  hardware_notes: "Runs on CPU through Piper. No GPU required.",
  install_notes: "Install Piper separately and place ru_RU-denis-medium.onnx plus ru_RU-denis-medium.onnx.json under data/models/piper. The backend never downloads these files.",
  supports_prompt: true,
  supports_streaming: false,
  input_sample_rate: 16000,
  output_sample_rate: 22050,
} satisfies ModelFixture;

const dmitriModel = {
  ...denisModel,
  id: "piper-ru-ru-dmitri-medium",
  display_name: "Piper Russian Dmitri Medium",
  install_notes: "Install Piper separately and place ru_RU-dmitri-medium.onnx plus ru_RU-dmitri-medium.onnx.json under data/models/piper. The backend never downloads these files.",
  voices: [
    {
      id: "ru_RU-dmitri-medium",
      display_name: "Dmitri",
      language: "ru-RU",
      gender: "male",
      sample_rate: 22050,
      notes: "Russian Piper medium voice. Place .onnx and .onnx.json files in data/models or override paths in config.",
    },
  ],
} satisfies ModelFixture;

const catalogOnlyModels = [
  {
    ...denisModel,
    id: "piper-ru-ru-irina-medium",
    display_name: "Piper Russian Irina Medium",
    source_url: "https://github.com/rhasspy/piper",
    license: "Unknown",
    size_bytes: 65_000_000,
    size_label: "approx. 65 MB voice package",
    tier: "lightweight",
    availability: "license_risk",
    voices: [
      {
        id: "ru_RU-irina-medium",
        display_name: "Irina",
        language: "ru-RU",
        gender: "female",
        sample_rate: 22050,
        notes: "Russian Piper medium voice candidate. Kept catalog-only until license and asset provenance are verified.",
      },
    ],
    adapter: "catalog_only_tts",
    install_notes: "Catalog-only candidate. Do not auto-download; verify license and place matching Piper assets manually before adding a runnable adapter entry.",
  },
  {
    ...denisModel,
    id: "piper-ru-ru-ruslan-medium",
    display_name: "Piper Russian Ruslan Medium",
    source_url: "https://github.com/rhasspy/piper",
    license: "CC BY-NC-SA 4.0",
    size_bytes: 65_000_000,
    size_label: "approx. 65 MB voice package",
    tier: "lightweight",
    availability: "noncommercial",
    voices: [{ id: "ru_RU-ruslan-medium", display_name: "Ruslan", language: "ru-RU", gender: "male", sample_rate: 22050, notes: "Russian Piper medium voice candidate. Noncommercial licensing keeps it out of runnable defaults." }],
    adapter: "catalog_only_tts",
    install_notes: "Catalog-only candidate. Do not auto-download; only enable a runnable adapter after confirming license and manually providing assets.",
  },
  {
    ...denisModel,
    id: "silero-ru-v5-5",
    display_name: "Silero Russian TTS v5.5",
    source_url: "https://github.com/snakers4/silero-models",
    license: "AGPL-3.0",
    size_bytes: 145_420_684,
    size_label: "145 MB",
    tier: "around-100mb",
    availability: "available",
    voices: [
      { id: "baya", display_name: "Baya", language: "ru-RU", gender: "female", sample_rate: 48000 },
      { id: "kseniya", display_name: "Kseniya", language: "ru-RU", gender: "female", sample_rate: 48000 },
      { id: "xenia", display_name: "Xenia", language: "ru-RU", gender: "female", sample_rate: 48000 },
      { id: "aidar", display_name: "Aidar", language: "ru-RU", gender: "male", sample_rate: 48000 },
      { id: "eugene", display_name: "Eugene", language: "ru-RU", gender: "male", sample_rate: 48000 },
    ],
    adapter: "catalog_only_tts",
    runtime: "in_process",
    output_sample_rate: 48000,
    install_notes: "Catalog-only candidate. Install runtime dependencies and provide assets manually before adding an executable adapter.",
  },
  {
    ...denisModel,
    id: "utrobin-vits-low-ru-multispeaker",
    display_name: "Utrobin VITS Low Russian Multispeaker",
    source_url: "https://huggingface.co/utrobinmv/tts_ru_free_hf_vits_low_multispeaker",
    license: "Apache-2.0",
    size_bytes: 106_000_000,
    size_label: "approx. 106 MB",
    tier: "around-100mb",
    availability: "available",
    voices: [
      { id: "speaker-0", display_name: "Speaker 0", language: "ru-RU", gender: "female", sample_rate: 22050 },
      { id: "speaker-1", display_name: "Speaker 1", language: "ru-RU", gender: "male", sample_rate: 22050 },
    ],
    adapter: "catalog_only_tts",
    runtime: "in_process",
  },
  {
    ...denisModel,
    id: "utrobin-vits-high-ru-multispeaker",
    display_name: "Utrobin VITS High Russian Multispeaker",
    source_url: "https://huggingface.co/utrobinmv/tts_ru_free_hf_vits_high_multispeaker",
    license: "Apache-2.0",
    size_bytes: 162_000_000,
    size_label: "approx. 162 MB",
    tier: "around-250mb",
    availability: "closest_below_requested_tier",
    voices: [
      { id: "speaker-0", display_name: "Speaker 0", language: "ru-RU", gender: "female", sample_rate: 22050 },
      { id: "speaker-1", display_name: "Speaker 1", language: "ru-RU", gender: "male", sample_rate: 22050 },
    ],
    adapter: "catalog_only_tts",
    runtime: "in_process",
  },
  {
    ...denisModel,
    id: "bene-ges-ruslan-nemo-500mb",
    display_name: "Bene Ges Ruslan NeMo Russian TTS",
    source_url: "https://huggingface.co/bene-ges/tts_ru_ipa_fastpitch_ruslan",
    license: "CC BY-NC 4.0",
    size_bytes: 500_000_000,
    size_label: "approx. 500 MB",
    tier: "around-500mb",
    availability: "noncommercial",
    voices: [{ id: "ruslan", display_name: "Ruslan", language: "ru-RU", gender: "male", sample_rate: 22050 }],
    adapter: "catalog_only_tts",
    runtime: "in_process",
  },
  {
    ...denisModel,
    id: "frappuccino-vits2-ru-natasha",
    display_name: "Frappuccino VITS2 Russian Natasha",
    source_url: "https://huggingface.co/frappuccino/vits2_ru_natasha",
    license: "MIT",
    size_bytes: 220_000_000,
    size_label: "approx. 220 MB",
    tier: "around-500mb",
    availability: "closest_practical_runtime_below_tier",
    voices: [{ id: "natasha", display_name: "Natasha", language: "ru-RU", gender: "female", sample_rate: 22050 }],
    adapter: "catalog_only_tts",
    runtime: "in_process",
  },
  {
    ...denisModel,
    id: "facebook-tts-transformer-ru-cv7-css10",
    display_name: "Facebook TTS Transformer Russian CV7 CSS10",
    source_url: "https://huggingface.co/facebook/tts_transformer-ru-cv7_css10",
    license: "Unknown",
    size_bytes: 1_024_000_000,
    size_label: "approx. 1 GB",
    tier: "around-1gb",
    availability: "license_blocked",
    voices: [{ id: "default", display_name: "Default Russian", language: "ru-RU", sample_rate: 22050 }],
    adapter: "catalog_only_tts",
    runtime: "in_process",
  },
  {
    ...denisModel,
    id: "f5-tts-russian-voice-clone",
    display_name: "F5-TTS Russian Voice Clone",
    source_url: "https://huggingface.co/Misha24-10/F5-TTS_RUSSIAN",
    license: "CC BY-NC 4.0",
    size_bytes: 1_000_000_000,
    size_label: "approx. 1 GB",
    tier: "around-1gb",
    availability: "conditional_reference_voice",
    voices: [{ id: "reference-voice", display_name: "Reference Voice", language: "ru-RU", sample_rate: 24000, notes: "Requires user-provided reference audio for voice cloning." }],
    adapter: "catalog_only_tts",
    runtime: "in_process",
  },
] satisfies ModelFixture[];

const runnableTtsModels = [denisModel, dmitriModel];
const models = [s2sModel, ...runnableTtsModels, ...catalogOnlyModels];
const catalogOnlyModelIds = new Set(catalogOnlyModels.map((model) => model.id));

test("renders the expanded Russian TTS catalog without loading on selection", async ({ page }) => {
  const api = await installTtsApiMock(page);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "TTS" })).toBeVisible();
  await page.getByRole("button", { name: "TTS" }).click();

  const modelSelect = page.getByRole("combobox", { name: "Модель" });
  await expect(modelSelect.locator("option")).toHaveText([...runnableTtsModels, ...catalogOnlyModels].map((model) => model.display_name));

  await expect(page.getByLabel("Выбрана модель")).toContainText("Piper Russian Denis Medium");
  await expect(page.getByLabel("Загруженная модель")).toContainText("-");

  for (const model of catalogOnlyModels) {
    await modelSelect.selectOption(model.id);
    await expect(page.getByLabel("Выбрана модель")).toContainText(model.display_name);
    await expect(page.getByLabel("Загруженная модель")).toContainText("-");
  }

  expect(api.loadCalls()).toEqual([]);
});

test("shows expanded catalog metadata and male female multispeaker voice choices", async ({ page }) => {
  await installTtsApiMock(page);

  await page.goto("/");
  await page.getByRole("button", { name: "TTS" }).click();

  const modelSelect = page.getByRole("combobox", { name: "Модель" });
  await modelSelect.selectOption("piper-ru-ru-irina-medium");
  await expect(page.getByLabel("Метаданные модели")).toContainText("Unknown");
  await expect(page.getByLabel("Метаданные модели")).toContainText("license_risk");
  await expect(page.getByLabel("Голоса модели")).toContainText("Irina");
  await expect(page.getByLabel("Голоса модели")).toContainText("ru-RU · female · 22050 Hz");
  await expect(page.getByRole("combobox", { name: "Голос" })).toHaveValue("ru_RU-irina-medium");

  await modelSelect.selectOption("piper-ru-ru-ruslan-medium");
  await expect(page.getByLabel("Метаданные модели")).toContainText("CC BY-NC-SA 4.0");
  await expect(page.getByLabel("Голоса модели")).toContainText("Ruslan");
  await expect(page.getByLabel("Голоса модели")).toContainText("ru-RU · male · 22050 Hz");
  await expect(page.getByRole("combobox", { name: "Голос" })).toHaveValue("ru_RU-ruslan-medium");

  await modelSelect.selectOption("silero-ru-v5-5");
  const voiceSelect = page.getByRole("combobox", { name: "Голос" });
  await expect(page.getByLabel("Метаданные модели")).toContainText("145 MB");
  await expect(page.getByLabel("Метаданные модели")).toContainText("around-100mb");
  await expect(page.getByLabel("Голоса модели")).toContainText("Baya");
  await expect(page.getByLabel("Голоса модели")).toContainText("Aidar");
  await expect(voiceSelect.locator("option")).toHaveText(["Baya", "Kseniya", "Xenia", "Aidar", "Eugene"]);
  await voiceSelect.selectOption("aidar");
  await expect(voiceSelect).toHaveValue("aidar");

  await modelSelect.selectOption("utrobin-vits-high-ru-multispeaker");
  await expect(page.getByLabel("Метаданные модели")).toContainText("around-250mb");
  await expect(page.getByLabel("Голоса модели")).toContainText("Speaker 0");
  await expect(page.getByLabel("Голоса модели")).toContainText("Speaker 1");
  await expect(page.getByRole("combobox", { name: "Голос" })).toHaveValue("speaker-0");
});

test("blocks catalog-only runtime and keeps generation unavailable", async ({ page }) => {
  const api = await installTtsApiMock(page);

  await page.goto("/");
  await page.getByRole("button", { name: "TTS" }).click();
  await page.getByRole("combobox", { name: "Модель" }).selectOption("silero-ru-v5-5");
  await page.getByLabel("Текст").fill("Привет из e2e");

  const generateButton = page.getByRole("button", { name: /сгенерировать/i });
  await expect(generateButton).toBeDisabled();
  await page.getByRole("button", { name: /запустить модель/i }).click();

  await expect(page.getByRole("alert")).toContainText("Catalog-only TTS entry is not installed");
  await expect(page.getByLabel("Загруженная модель")).toContainText("-");
  await expect(generateButton).toBeDisabled();
  expect(api.count("POST", "/api/models/silero-ru-v5-5/load")).toBe(1);
  expect(api.count("POST", "/api/tts")).toBe(0);
});

test("covers runnable TTS start generation switch unload stop and duplicate-start guards", async ({ page }) => {
  const api = await installTtsApiMock(page);

  await page.goto("/");
  await page.getByRole("button", { name: "TTS" }).click();

  const modelSelect = page.getByRole("combobox", { name: "Модель" });
  const generateButton = page.getByRole("button", { name: /сгенерировать/i });
  await page.getByLabel("Текст").fill("Привет из e2e");
  await expect(generateButton).toBeDisabled();
  expect(api.count("POST", "/api/tts")).toBe(0);

  await modelSelect.selectOption("piper-ru-ru-dmitri-medium");
  await expect(page.getByLabel("Выбрана модель")).toContainText("Piper Russian Dmitri Medium");
  await expect(page.getByLabel("Загруженная модель")).toContainText("-");
  expect(api.loadCalls()).toEqual([]);

  await page.getByRole("button", { name: /запустить модель/i }).click();
  await expect(page.getByLabel("Загруженная модель")).toContainText("Piper Russian Dmitri Medium");
  await expect(generateButton).toBeEnabled();
  expect(api.count("POST", "/api/models/piper-ru-ru-dmitri-medium/load")).toBe(1);

  await expect(page.getByRole("button", { name: /модель готова/i })).toBeDisabled();
  expect(api.count("POST", "/api/models/piper-ru-ru-dmitri-medium/load")).toBe(1);

  await page.getByRole("combobox", { name: "Голос" }).selectOption("ru_RU-dmitri-medium");
  await generateButton.click();
  await expect(page.getByText("TTS готов.")).toBeVisible();
  await expect(page.locator(".response-box")).toHaveText("Привет из e2e");
  expect(api.count("POST", "/api/tts")).toBe(1);
  expect(api.lastBody("/api/tts")).toMatchObject({
    model_id: "piper-ru-ru-dmitri-medium",
    text: "Привет из e2e",
    voice: "ru_RU-dmitri-medium",
  });

  await modelSelect.selectOption("piper-ru-ru-denis-medium");
  await expect(page.getByLabel("Выбрана модель")).toContainText("Piper Russian Denis Medium");
  await expect(page.getByLabel("Загруженная модель")).toContainText("Piper Russian Dmitri Medium");

  await page.getByRole("button", { name: /запустить модель/i }).click();
  await expect(page.getByLabel("Загруженная модель")).toContainText("Piper Russian Denis Medium");
  expect(api.count("DELETE", "/api/models/piper-ru-ru-dmitri-medium/load")).toBe(1);
  expect(api.count("POST", "/api/models/piper-ru-ru-denis-medium/load")).toBe(1);

  await page.getByRole("button", { name: /остановить модель/i }).click();
  await expect(page.getByLabel("Загруженная модель")).toContainText("-");
  await expect(generateButton).toBeDisabled();
  expect(api.count("DELETE", "/api/models/piper-ru-ru-denis-medium/load")).toBe(1);

  await page.reload();
  await page.getByRole("button", { name: "TTS" }).click();
  await expect(page.getByLabel("Загруженная модель")).toContainText("-");
  await expect(page.getByText("...")).toBeVisible();
});

test("shows TTS load errors without touching a real runtime", async ({ page }) => {
  const api = await installTtsApiMock(page, { failLoadFor: "piper-ru-ru-denis-medium" });

  await page.goto("/");
  await page.getByRole("button", { name: "TTS" }).click();
  await page.getByRole("button", { name: /запустить модель/i }).click();

  await expect(page.getByRole("alert")).toContainText("Piper runtime missing");
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
      if (catalogOnlyModelIds.has(modelId)) {
        runtime = { model_id: modelId, status: "failed", detail: "Catalog-only TTS entry is not installed. Add a runtime adapter and local model assets before loading." };
        return fulfillJson(route, runtime);
      }
      runtime = options.failLoadFor === modelId ? { model_id: modelId, status: "failed", detail: "Piper runtime missing" } : { model_id: modelId, status: "ready", detail: `Loaded ${modelId}` };
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
      files.push(...(await listFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && /\.(py|ts|tsx|js|jsx|json|toml|yaml|yml|env|md)$/.test(entry.name) && !entry.name.endsWith("-lock.json")) {
      if (!fullPath.includes(`${path.sep}frontend${path.sep}e2e${path.sep}`)) files.push(fullPath);
    }
  }

  return files;
}
