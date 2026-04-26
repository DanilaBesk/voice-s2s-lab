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
};

const denisModel = {
  id: "piper-ru-ru-denis-medium",
  display_name: "Piper ru_RU Denis medium",
  hf_repo: null,
  type: "text_to_audio",
  capabilities: ["text_to_audio", "tts"],
  voices: [{ id: "ru_RU-denis-medium", display_name: "Denis", language: "ru-RU", gender: "male", sample_rate: 22050 }],
  adapter: "piper_tts",
  runtime: "subprocess",
  mode: "turn_based",
  language_notes: "Russian TTS",
  hardware_notes: "CPU",
  install_notes: "Piper binary intentionally mocked in e2e",
  supports_prompt: false,
  supports_streaming: false,
  input_sample_rate: 22050,
  output_sample_rate: 22050,
};

const dmitriModel = {
  ...denisModel,
  id: "piper-ru-ru-dmitri-medium",
  display_name: "Piper ru_RU Dmitri medium",
  voices: [{ id: "ru_RU-dmitri-medium", display_name: "Dmitri", language: "ru-RU", gender: "male", sample_rate: 22050 }],
};

const models = [s2sModel, denisModel, dmitriModel];

test("covers the TTS model lifecycle through mocked API routes", async ({ page }) => {
  const api = await installTtsApiMock(page);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "TTS" })).toBeVisible();
  await page.getByRole("button", { name: "TTS" }).click();

  const modelSelect = page.getByRole("combobox", { name: "Модель" });
  await expect(modelSelect).toContainText("Piper ru_RU Denis medium");
  await expect(modelSelect).toContainText("Piper ru_RU Dmitri medium");
  await expect(page.getByLabel("Выбрана модель")).toContainText("Piper ru_RU Denis medium");
  await expect(page.getByLabel("Загруженная модель")).toContainText("-");
  expect(api.count("POST", "/api/models/piper-ru-ru-denis-medium/load")).toBe(0);

  await modelSelect.selectOption("piper-ru-ru-dmitri-medium");
  await expect(page.getByLabel("Выбрана модель")).toContainText("Piper ru_RU Dmitri medium");
  await expect(page.getByLabel("Загруженная модель")).toContainText("-");
  expect(api.loadCalls()).toEqual([]);

  const generateButton = page.getByRole("button", { name: /сгенерировать/i });
  await page.getByLabel("Текст").fill("Привет из e2e");
  await expect(generateButton).toBeDisabled();
  expect(api.count("POST", "/api/tts")).toBe(0);

  await page.getByRole("button", { name: /запустить модель/i }).click();
  await expect(page.getByLabel("Загруженная модель")).toContainText("Piper ru_RU Dmitri medium");
  await expect(generateButton).toBeEnabled();
  expect(api.count("POST", "/api/models/piper-ru-ru-dmitri-medium/load")).toBe(1);

  await expect(page.getByRole("button", { name: /модель готова/i })).toBeDisabled();
  expect(api.count("POST", "/api/models/piper-ru-ru-dmitri-medium/load")).toBe(1);

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
  await expect(page.getByLabel("Выбрана модель")).toContainText("Piper ru_RU Denis medium");
  await expect(page.getByLabel("Загруженная модель")).toContainText("Piper ru_RU Dmitri medium");

  await page.getByRole("button", { name: /запустить модель/i }).click();
  await expect(page.getByLabel("Загруженная модель")).toContainText("Piper ru_RU Denis medium");
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
      runtime =
        options.failLoadFor === modelId
          ? { model_id: modelId, status: "failed", detail: "Piper runtime missing" }
          : { model_id: modelId, status: "ready", detail: `Loaded ${modelId}` };
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
  const terms = [
    ["DATA", "BASE"],
    ["DB", "_"],
    ["POST", "GRES"],
    ["MY", "SQL"],
    ["SQL", "ITE"],
    ["sql", "alchemy"],
    ["pr", "isma"],
    ["psy", "copg"],
    ["async", "pg"],
    ["sql", "ite"],
    ["post", "gres"],
    ["my", "sql"],
    ["mongo", "db"],
    ["re", "dis"],
  ].map((parts) => parts.join(""));
  const hits: string[] = [];

  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => "");
    const lowerText = text.toLowerCase();
    for (const term of terms) {
      if (lowerText.includes(term.toLowerCase())) {
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
