import { Phone, Play, Power, Square, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  API_BASE_URL,
  createSession,
  fetchModels,
  fetchRuntime,
  generateTts,
  interruptSession,
  loadModel,
  ModelEntry,
  RuntimeResponse,
  SessionResponse,
  submitTurn,
  TtsReferenceVoice,
  TtsResponse,
  TurnResponse,
  unloadModel,
  uploadTtsReferenceVoice,
} from "./api";
import { encodePcmToWav, resampleLinear } from "./audioUtils";
import { UtteranceVad } from "./audioVad";
import { StatusPill } from "./components/StatusPill";

const DEFAULT_PERSONA =
  "Ты Алекс, живой собеседник в голосовом звонке. Говори по-русски естественно, спокойно, кратко и практично. Не говори, что ты AI-модель, если тебя прямо об этом не спрашивают. Отвечай короткими репликами, без длинных монологов, задавай один короткий уточняющий вопрос, когда это действительно полезно. Держи ответы короче 20 секунд. Предпочитай прямые ответы, практические примеры и дружелюбный, но не театральный тон. Оставайся в роли полезного русскоязычного партнера по разговору.";

const DEFAULT_TURN_OPTIONS = {
  thinker_max_new_tokens: 8,
  talker_max_new_tokens: 64,
};

const TALKER_TOKENS_PER_SECOND = 50;
const QWEN_TTS_MAX_NEW_TOKENS = 80;

type AppMode = "s2s" | "tts";
type CallStatus = "idle" | "connecting" | "listening" | "capturing" | "processing" | "playing" | "ending" | "ended";
type TtsStatus = "idle" | "generating" | "completed";
type CatalogModelMetadata = ModelEntry & {
  source_url?: string | null;
  license?: string | null;
  size_bytes?: number | null;
  size_label?: string | null;
  tier?: string | null;
  availability?: string | null;
};

const EMPTY_RUNTIME: RuntimeResponse = { model_id: null, status: "not_loaded", detail: null };

export function App() {
  const [appMode, setAppMode] = useState<AppMode>("s2s");
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [runtime, setRuntime] = useState<RuntimeResponse>(EMPTY_RUNTIME);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelBusy, setModelBusy] = useState(false);
  const [persona, setPersona] = useState(DEFAULT_PERSONA);
  const [turnOptions, setTurnOptions] = useState(DEFAULT_TURN_OPTIONS);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [lastTurn, setLastTurn] = useState<TurnResponse | null>(null);
  const [ttsTurn, setTtsTurn] = useState<TtsResponse | null>(null);
  const [ttsText, setTtsText] = useState("");
  const [ttsVoice, setTtsVoice] = useState("");
  const [ttsStatus, setTtsStatus] = useState<TtsStatus>("idle");
  const [qwenReferenceFile, setQwenReferenceFile] = useState<File | null>(null);
  const [qwenReferenceName, setQwenReferenceName] = useState("");
  const [qwenReferenceText, setQwenReferenceText] = useState("");
  const [qwenReferenceVoice, setQwenReferenceVoice] = useState<TtsReferenceVoice | null>(null);
  const [qwenXVectorOnly, setQwenXVectorOnly] = useState(true);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [inputLevel, setInputLevel] = useState(0);
  const [activity, setActivity] = useState("Выберите режим и модель.");
  const [microphoneName, setMicrophoneName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const muteNodeRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const callActiveRef = useRef(false);
  const turnInFlightRef = useRef(false);
  const sessionRef = useRef<SessionResponse | null>(null);
  const selectedModelRef = useRef<ModelEntry | undefined>(undefined);
  const runtimeRef = useRef<RuntimeResponse>(EMPTY_RUNTIME);
  const restoredRuntimeModeRef = useRef(false);
  const vadRef = useRef(new UtteranceVad());

  const modeModels = useMemo(() => {
    const candidates = models.filter((model) => (appMode === "tts" ? supportsTts(model) : supportsS2s(model)));
    return appMode === "tts" ? [...candidates].sort(compareTtsCatalogModels) : candidates;
  }, [appMode, models]);
  const selectedModel = useMemo(() => models.find((model) => model.id === selectedModelId), [models, selectedModelId]);
  const selectedCatalogModel = selectedModel as CatalogModelMetadata | undefined;
  const loadedModel = useMemo(() => models.find((model) => model.id === runtime.model_id), [models, runtime.model_id]);
  const callActive = callStatus === "connecting" || callStatus === "listening" || callStatus === "capturing" || callStatus === "processing" || callStatus === "playing";
  const selectedModelReady = Boolean(selectedModel && runtime.model_id === selectedModel.id && runtime.status === "ready");
  const estimatedVoiceSeconds = turnOptions.talker_max_new_tokens / TALKER_TOKENS_PER_SECOND;
  const ttsReady = appMode === "tts" && Boolean(selectedModel && supportsTts(selectedModel) && selectedModelReady);
  const qwenReferenceControlsVisible = appMode === "tts" && selectedModel?.adapter === "qwen3_tts";
  const displayedText = appMode === "tts" ? ttsTurn?.text : lastTurn?.text;

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  useEffect(() => {
    setSelectedModelId((current) => {
      if (modeModels.some((model) => model.id === current)) return current;
      const nextDefault = modeModels.find((model) => model.default) ?? modeModels[0];
      return nextDefault?.id ?? "";
    });
  }, [modeModels]);

  useEffect(() => {
    if (selectedModel?.voices.some((voice) => voice.id === ttsVoice)) return;
    setTtsVoice(selectedModel?.voices[0]?.id ?? "");
  }, [selectedModel, ttsVoice]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    async function loadSystem() {
      try {
        const [loadedModels, nextRuntime] = await Promise.all([fetchModels(), fetchRuntime()]);
        if (cancelled) return;
        setModels(loadedModels);
        setRuntime(nextRuntime);
        runtimeRef.current = nextRuntime;
        restoreModeFromRuntime(loadedModels, nextRuntime);
        if (loadedModels.some((model) => model.status === "loading" || model.status === "not_checked") || nextRuntime.status === "loading") {
          timeoutId = window.setTimeout(loadSystem, 3000);
        }
      } catch (err) {
        if (cancelled) return;
        setError(humanError(err));
        timeoutId = window.setTimeout(loadSystem, 3000);
      }
    }

    void loadSystem();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      stopAudioGraph();
    };
  }, []);

  async function refreshSystem() {
    const [loadedModels, nextRuntime] = await Promise.all([fetchModels(), fetchRuntime()]);
    setModels(loadedModels);
    setRuntime(nextRuntime);
    runtimeRef.current = nextRuntime;
  }

  function restoreModeFromRuntime(loadedModels: ModelEntry[], nextRuntime: RuntimeResponse) {
    if (restoredRuntimeModeRef.current || !nextRuntime.model_id) return;
    const runtimeModel = loadedModels.find((model) => model.id === nextRuntime.model_id);
    if (!runtimeModel) return;
    const nextMode = modeForModel(runtimeModel);
    if (!nextMode) return;
    restoredRuntimeModeRef.current = true;
    setAppMode(nextMode);
    setSelectedModelId(runtimeModel.id);
    setActivity(nextMode === "tts" ? "Введите текст для озвучки." : "Нажмите кнопку и говорите.");
  }

  function switchMode(nextMode: AppMode) {
    setAppMode(nextMode);
    const candidates = models.filter((model) => (nextMode === "tts" ? supportsTts(model) : supportsS2s(model)));
    const nextDefault = candidates.find((model) => model.default) ?? candidates[0];
    setSelectedModelId(nextDefault?.id ?? "");
    setError(null);
    setActivity(nextMode === "tts" ? "Введите текст для озвучки." : "Нажмите кнопку и говорите.");
  }

  async function ensureModelReady(model: ModelEntry): Promise<boolean> {
    if (runtimeRef.current.model_id === model.id && runtimeRef.current.status === "ready") return true;

    setModelBusy(true);
    setError(null);
    setActivity("Запускаю модель.");
    try {
      const currentRuntime = runtimeRef.current;
      if (currentRuntime.model_id && currentRuntime.model_id !== model.id) {
        const afterUnload = await unloadModel(currentRuntime.model_id);
        setRuntime(afterUnload);
        runtimeRef.current = afterUnload;
      }

      const nextRuntime = await loadModel(model.id);
      setRuntime(nextRuntime);
      runtimeRef.current = nextRuntime;
      if (nextRuntime.status !== "ready") {
        throw new Error(nextRuntime.detail || `Модель не готова: ${nextRuntime.status}`);
      }
      setActivity("Модель готова.");
      await refreshSystem();
      return true;
    } catch (err) {
      setActivity("Модель не загрузилась.");
      setError(humanError(err));
      await refreshSystem().catch(() => undefined);
      return false;
    } finally {
      setModelBusy(false);
    }
  }

  async function startSelectedModel() {
    const model = selectedModelRef.current ?? selectedModel;
    if (!model) return;
    await ensureModelReady(model);
  }

  async function stopLoadedModel() {
    const modelId = runtimeRef.current.model_id;
    if (!modelId) return;
    setModelBusy(true);
    setError(null);
    try {
      if (callActiveRef.current) await endCall();
      const nextRuntime = await unloadModel(modelId);
      setRuntime(nextRuntime);
      runtimeRef.current = nextRuntime;
      setSession(null);
      sessionRef.current = null;
      setActivity("Модель остановлена.");
      await refreshSystem();
    } catch (err) {
      setError(humanError(err));
    } finally {
      setModelBusy(false);
    }
  }

  async function startCall() {
    const model = selectedModelRef.current ?? selectedModel;
    if (!model || !supportsS2s(model)) return;
    setError(null);
    if (!(await ensureModelReady(model))) {
      setCallStatus("idle");
      return;
    }
    setActivity("Подключаю микрофон...");
    setCallStatus("connecting");
    try {
      const nextSession = sessionRef.current ?? (await createSession(model.id, persona));
      setSession(nextSession);
      sessionRef.current = nextSession;
      await startAudioGraph();
      callActiveRef.current = true;
      setCallStatus("listening");
      setActivity("Слушаю.");
    } catch (err) {
      callActiveRef.current = false;
      stopAudioGraph();
      setCallStatus("idle");
      setActivity("Ошибка микрофона.");
      setError(humanError(err));
    }
  }

  async function endCall() {
    callActiveRef.current = false;
    setCallStatus("ending");
    flushCapture();
    stopAudioGraph();
    audioRef.current?.pause();
    setInputLevel(0);
    setActivity("Звонок завершен.");
    setCallStatus("ended");
  }

  async function toggleCall() {
    if (callActive) {
      await endCall();
    } else {
      await startCall();
    }
  }

  async function startAudioGraph() {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) throw new Error("This browser does not expose AudioContext.");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const audioContext = new AudioContextCtor();
    await audioContext.resume().catch(() => undefined);
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(2048, 1, 1);
    const muteNode = audioContext.createGain();
    muteNode.gain.value = 0;
    const sampleRate = audioContext.sampleRate;

    processor.onaudioprocess = (event) => handleAudioProcess(event.inputBuffer.getChannelData(0), sampleRate);
    source.connect(processor);
    processor.connect(muteNode);
    muteNode.connect(audioContext.destination);

    streamRef.current = stream;
    audioContextRef.current = audioContext;
    sourceRef.current = source;
    processorRef.current = processor;
    muteNodeRef.current = muteNode;
    setMicrophoneName(stream.getAudioTracks()[0]?.label || "микрофон");
  }

  function stopAudioGraph() {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    muteNodeRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close().catch(() => undefined);
    processorRef.current = null;
    sourceRef.current = null;
    muteNodeRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
    vadRef.current.reset();
    setMicrophoneName("");
  }

  function handleAudioProcess(input: Float32Array, sampleRate: number) {
    if (!callActiveRef.current || turnInFlightRef.current) return;

    const event = vadRef.current.process(input, sampleRate);
    setInputLevel(event.level);

    if (event.type === "speech-start") {
      setCallStatus("capturing");
      setActivity("Слышу речь.");
    } else if (event.type === "utterance") {
      setInputLevel(0);
      setActivity("Отправляю фразу.");
      sendSamples(event.samples, sampleRate);
    } else if (event.type === "idle" && callStatus === "capturing") {
      setCallStatus("listening");
    }
  }

  function flushCapture(sampleRate = audioContextRef.current?.sampleRate ?? 16000) {
    const samples = vadRef.current.flushPending();
    if (!samples) return;
    setInputLevel(0);
    setActivity("Отправляю фразу.");
    sendSamples(samples, sampleRate);
  }

  function sendSamples(samples: Float32Array, sampleRate: number) {
    const targetRate = selectedModelRef.current?.input_sample_rate ?? 16000;
    const wavBlob = encodePcmToWav(resampleLinear(samples, sampleRate, targetRate), targetRate);
    void sendAudio(wavBlob);
  }

  async function sendAudio(blob: Blob) {
    const model = selectedModelRef.current;
    if (!model) return;
    const activeSession = sessionRef.current ?? (await createSession(model.id, persona));
    if (!sessionRef.current) {
      setSession(activeSession);
      sessionRef.current = activeSession;
    }

    turnInFlightRef.current = true;
    setCallStatus("processing");
    setActivity("Жду ответ модели.");
    setError(null);
    try {
      const turn = await submitTurn(activeSession.session_id, blob, turnOptions);
      setLastTurn(turn);
      if (turn.audio_url) {
        await playModelAudio(new URL(turn.audio_url, API_BASE_URL).toString());
      } else {
        setActivity("Ответ без аудио.");
      }
    } catch (err) {
      setActivity("Ошибка ответа.");
      setError(humanError(err));
    } finally {
      turnInFlightRef.current = false;
      if (callActiveRef.current) {
        setCallStatus("listening");
        setActivity("Слушаю.");
      }
    }
  }

  async function playModelAudio(src: string) {
    const audio = audioRef.current;
    if (!audio) return;
    setCallStatus("playing");
    setActivity("Воспроизвожу ответ.");
    audio.src = src;
    let blocked = false;
    await audio.play().catch((err) => {
      blocked = true;
      setActivity("Нажмите play в аудио.");
      setError(humanError(err));
    });
    if (blocked) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        audio.removeEventListener("ended", done);
        audio.removeEventListener("error", done);
        audio.removeEventListener("stalled", done);
        audio.removeEventListener("abort", done);
        window.clearTimeout(timeoutId);
        resolve();
      };
      const timeoutId = window.setTimeout(done, 120_000);
      audio.addEventListener("ended", done, { once: true });
      audio.addEventListener("error", done, { once: true });
      audio.addEventListener("stalled", done, { once: true });
      audio.addEventListener("abort", done, { once: true });
      if (audio.ended || audio.paused) done();
    });
  }

  async function handleInterrupt() {
    if (!sessionRef.current) return;
    await interruptSession(sessionRef.current.session_id);
  }

  async function generateTtsTurn() {
    const model = selectedModelRef.current ?? selectedModel;
    if (!model || !ttsReady || !ttsText.trim()) return;
    setError(null);
    setTtsStatus("generating");
    setActivity("Генерирую TTS.");
    try {
      const options = await ttsOptionsForModel(model);
      const turn = await generateTts(model.id, ttsText, ttsVoice, options);
      setTtsTurn(turn);
      if (turn.audio_url && audioRef.current) {
        audioRef.current.src = new URL(turn.audio_url, API_BASE_URL).toString();
      }
      setActivity("TTS готов.");
      setTtsStatus("completed");
    } catch (err) {
      setActivity("Ошибка TTS.");
      setError(humanError(err));
      setTtsStatus("idle");
    }
  }

  async function ttsOptionsForModel(model: ModelEntry): Promise<Record<string, unknown>> {
    if (model.adapter !== "qwen3_tts") return {};
    let reference = qwenReferenceVoice;
    if (qwenReferenceFile && !reference) {
      setActivity("Загружаю референс-голос.");
      reference = await uploadTtsReferenceVoice(qwenReferenceFile, qwenReferenceName.trim() || qwenReferenceFile.name, qwenReferenceText);
      setQwenReferenceVoice(reference);
    }
    if (!reference) return {};
    return {
      ref_audio_path: reference.ref_audio_path,
      ref_text: qwenReferenceText.trim() || reference.ref_text,
      x_vector_only_mode: qwenXVectorOnly,
      max_new_tokens: QWEN_TTS_MAX_NEW_TOKENS,
    };
  }

  function updateThinkerTokens(value: number) {
    setTurnOptions((current) => ({
      ...current,
      thinker_max_new_tokens: clampInteger(value, 1, 64),
    }));
  }

  function updateTalkerTokens(value: number) {
    setTurnOptions((current) => ({
      ...current,
      talker_max_new_tokens: clampInteger(value, 24, 512),
    }));
  }

  function updateQwenReferenceFile(file: File | null) {
    setQwenReferenceFile(file);
    setQwenReferenceVoice(null);
    if (file && !qwenReferenceName.trim()) {
      setQwenReferenceName(file.name.replace(/\.[^.]+$/, ""));
    }
  }

  return (
    <main className="lab-shell">
      <header className="topbar">
        <div>
          <h1>Голосовой тест</h1>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel controls-panel">
          <div className="mode-switch" aria-label="Режим">
            <button className={appMode === "s2s" ? "mode-active" : ""} onClick={() => switchMode("s2s")} type="button" disabled={callActive || modelBusy}>
              S2S
            </button>
            <button className={appMode === "tts" ? "mode-active" : ""} onClick={() => switchMode("tts")} type="button" disabled={callActive || modelBusy}>
              TTS
            </button>
          </div>

          <div className="field">
            <label htmlFor="model-select">Модель</label>
            <select id="model-select" value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)} disabled={callActive || modelBusy}>
              {modeModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {modelOptionLabel(model, appMode)}
                </option>
              ))}
            </select>
          </div>

          <div className="model-summary-grid">
            <div aria-label="Выбрана модель">Выбрана: {selectedModel?.display_name ?? "-"}</div>
            <div aria-label="Загруженная модель">Загружена: {runtime.status === "ready" ? loadedModel?.display_name ?? runtime.model_id ?? "-" : "-"}</div>
          </div>

          {selectedModel && (
            <div className="model-card">
              <div className="model-title">
                <strong>{selectedModel.display_name}</strong>
                <div className="status-group">
                  <StatusPill status={selectedModel.status} />
                </div>
              </div>
              <p className="status-detail">{selectedModel.status_detail || runtimeDetailForModel(selectedModel, runtime) || modelHint(selectedModel, selectedModelReady)}</p>
              <dl className="metadata-grid" aria-label="Метаданные модели">
                {modelMetadataRows(selectedCatalogModel).map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
              {selectedModel.voices.length > 0 && (
                <div className="voice-list" aria-label="Голоса модели">
                  {selectedModel.voices.map((voice) => (
                    <div className="voice-row" key={voice.id}>
                      <strong>{voice.display_name}</strong>
                      <span>{voiceDetails(voice)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="model-actions">
            <button className="secondary-button" onClick={startSelectedModel} disabled={!selectedModel || callActive || modelBusy || selectedModelReady}>
              <Power size={16} /> {selectedModelReady ? "Модель готова" : "Запустить модель"}
            </button>
            <button className="secondary-button" onClick={stopLoadedModel} disabled={!runtime.model_id || modelBusy}>
              <Square size={16} /> Остановить модель
            </button>
          </div>

          {appMode === "s2s" ? (
            <>
              <button className={`call-button ${callActive ? "call-button-live" : ""}`} onClick={toggleCall} disabled={!selectedModel || !supportsS2s(selectedModel) || callStatus === "ending" || modelBusy}>
                {callActive ? <Square size={18} /> : <Phone size={18} />}
                {callActive ? "Завершить" : "Начать звонок"}
              </button>

              <div className="mic-meter" aria-label="Уровень микрофона">
                <span style={{ width: `${Math.round(inputLevel * 100)}%` }} />
              </div>

              <div className="activity-line">
                <strong>{activity}</strong>
                {microphoneName && <span>{microphoneName}</span>}
              </div>

              {callStatus === "processing" && (
                <button className="secondary-button" onClick={handleInterrupt} disabled={!session}>
                  <Square size={16} /> Стоп
                </button>
              )}

              <div className="field persona-field">
                <label htmlFor="persona">Промпт</label>
                <textarea id="persona" value={persona} onChange={(event) => setPersona(event.target.value)} disabled={callActive} />
              </div>

              <div className="field">
                <label htmlFor="thinker-tokens">Thinker max new tokens</label>
                <input
                  id="thinker-tokens"
                  type="number"
                  min={1}
                  max={64}
                  step={1}
                  value={turnOptions.thinker_max_new_tokens}
                  onChange={(event) => updateThinkerTokens(event.target.valueAsNumber)}
                  disabled={callActive}
                />
              </div>

              <div className="field">
                <label htmlFor="talker-tokens">Talker max new tokens</label>
                <input
                  id="talker-tokens"
                  type="number"
                  min={24}
                  max={512}
                  step={8}
                  value={turnOptions.talker_max_new_tokens}
                  onChange={(event) => updateTalkerTokens(event.target.valueAsNumber)}
                  disabled={callActive}
                />
                <p className="field-note">
                  Примерная длина озвучки: {estimatedVoiceSeconds.toFixed(1)} c. На этой модели 48 токенов дают около 1 секунды речи, поэтому слишком низкий лимит режет ответ.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="tts-text">Текст</label>
                <textarea id="tts-text" className="tts-text" value={ttsText} onChange={(event) => setTtsText(event.target.value)} placeholder="Введите русский текст для озвучки" />
              </div>

              {selectedModel && selectedModel.voices.length > 0 && (
                <div className="field">
                  <label htmlFor="tts-voice">Голос</label>
                  <select id="tts-voice" value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)}>
                    {selectedModel.voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.display_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {qwenReferenceControlsVisible && (
                <div className="qwen-reference-controls" role="group" aria-label="Qwen reference voice">
                  <div className="field">
                    <label htmlFor="qwen-reference-audio">Референс-аудио</label>
                    <input
                      id="qwen-reference-audio"
                      type="file"
                      accept="audio/wav,audio/flac,audio/mpeg,audio/ogg,audio/mp4,.wav,.flac,.mp3,.ogg,.m4a"
                      onChange={(event) => updateQwenReferenceFile(event.target.files?.[0] ?? null)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="qwen-reference-name">Название голоса</label>
                    <input id="qwen-reference-name" value={qwenReferenceName} onChange={(event) => setQwenReferenceName(event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="qwen-reference-text">Текст референса</label>
                    <textarea id="qwen-reference-text" className="reference-text" value={qwenReferenceText} onChange={(event) => setQwenReferenceText(event.target.value)} />
                  </div>
                  <label className="checkbox-field" htmlFor="qwen-x-vector">
                    <input id="qwen-x-vector" type="checkbox" checked={qwenXVectorOnly} onChange={(event) => setQwenXVectorOnly(event.target.checked)} />
                    Только тембр
                  </label>
                  {qwenReferenceVoice && <div className="reference-status">Выбран: {qwenReferenceVoice.display_name}</div>}
                </div>
              )}

              <button className="call-button" onClick={generateTtsTurn} disabled={!ttsReady || !ttsText.trim() || ttsStatus === "generating"}>
                <Volume2 size={18} />
                {ttsStatus === "generating" ? "Генерирую" : "Сгенерировать"}
              </button>

              <div className="activity-line">
                <strong>{activity}</strong>
                <span>{ttsReady ? "ready" : "not ready"}</span>
              </div>
            </>
          )}

          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}

        </aside>

        <section className="panel runtime-panel">
          <div className="session-strip">
            <div>
              <span>Режим</span>
              <strong>{appMode.toUpperCase()}</strong>
            </div>
            <div>
              <span>Runtime</span>
              <strong>{runtime.status}</strong>
            </div>
            <div>
              <span>Задержка</span>
              <strong>{(appMode === "tts" ? ttsTurn?.latency_ms : lastTurn?.latency_ms) ? `${appMode === "tts" ? ttsTurn?.latency_ms : lastTurn?.latency_ms} ms` : "-"}</strong>
            </div>
            <div>
              <span>Аудио</span>
              <strong>{selectedModel?.output_sample_rate ?? "-"} Hz</strong>
            </div>
          </div>

          <audio ref={audioRef} controls className="audio-player" />

          <div className="response-section">
            <h2>{appMode === "tts" ? "TTS" : "Ответ"}</h2>
            <div className="response-box">{displayedText ?? "..."}</div>
          </div>

          {appMode === "s2s" && (
            <button className="secondary-button compact-button" onClick={handleInterrupt} disabled={!session || callStatus !== "processing"}>
              <Play size={16} /> Interrupt
            </button>
          )}
        </section>
      </section>
    </main>
  );
}

function supportsS2s(model: ModelEntry): boolean {
  return model.type === "audio_to_audio" || model.capabilities.includes("audio_to_audio");
}

function supportsTts(model: ModelEntry): boolean {
  return model.type === "text_to_audio" || model.capabilities.includes("tts") || model.capabilities.includes("text_to_audio");
}

function modeForModel(model: ModelEntry): AppMode | null {
  if (supportsTts(model)) return "tts";
  if (supportsS2s(model)) return "s2s";
  return null;
}

function runtimeDetailForModel(model: ModelEntry, runtime: RuntimeResponse): string | null {
  if (runtime.model_id !== model.id) return null;
  return runtime.detail;
}

function modelHint(model: ModelEntry, ready: boolean): string {
  if (ready) return "Модель загружена и готова.";
  if (model.status === "failed" || model.status === "error") return "Модель не загрузилась.";
  return "Модель не загружена.";
}

function modelMetadataRows(model: CatalogModelMetadata | undefined): Array<{ label: string; value: string }> {
  if (!model) return [];
  const rows: Array<[string, string | null | undefined]> = [
    ["Источник", model.source_url ?? model.hf_repo],
    ["Лицензия", model.license],
    ["Размер", model.size_label ?? formatBytes(model.size_bytes)],
    ["Tier", model.tier],
    ["Доступность", model.availability],
  ];
  return rows.flatMap(([label, value]) => (value ? [{ label, value }] : []));
}

function modelOptionLabel(model: ModelEntry, appMode: AppMode): string {
  if (appMode !== "tts") return model.display_name;
  const catalogModel = model as CatalogModelMetadata;
  const parts = [tierLabel(catalogModel), voiceGenderSummary(model), model.display_name, catalogModel.availability].filter(Boolean);
  return parts.join(" · ");
}

function compareTtsCatalogModels(left: ModelEntry, right: ModelEntry): number {
  const leftCatalog = left as CatalogModelMetadata;
  const rightCatalog = right as CatalogModelMetadata;
  return (
    tierRank(leftCatalog) - tierRank(rightCatalog) ||
    voiceRank(left) - voiceRank(right) ||
    left.display_name.localeCompare(right.display_name)
  );
}

function tierRank(model: CatalogModelMetadata): number {
  const tier = model.tier ?? "";
  if (tier === "lightweight") return 0;
  if (tier === "around-100mb") return 1;
  if (tier === "around-250mb") return 2;
  if (tier === "around-500mb") return 3;
  if (tier === "around-1gb") return 4;
  if (tier === "around-2gb") return 5;
  return 10;
}

function voiceRank(model: ModelEntry): number {
  const genders = new Set(model.voices.map((voice) => voice.gender).filter(Boolean));
  if (genders.has("male") && genders.has("female")) return 0;
  if (genders.has("male")) return 1;
  if (genders.has("female")) return 2;
  return 3;
}

function tierLabel(model: CatalogModelMetadata): string | null {
  if (model.tier === "around-100mb") return "100MB";
  if (model.tier === "around-250mb") return "250MB";
  if (model.tier === "around-500mb") return "500MB";
  if (model.tier === "around-1gb") return "1GB";
  if (model.tier === "around-2gb") return "2GB";
  return model.size_label ?? model.tier ?? formatBytes(model.size_bytes);
}

function voiceGenderSummary(model: ModelEntry): string | null {
  const genders = new Set(model.voices.map((voice) => voice.gender).filter(Boolean));
  if (genders.has("male") && genders.has("female")) return "мужчина+женщина";
  if (genders.has("male")) return "мужчина";
  if (genders.has("female")) return "женщина";
  if (model.voices.some((voice) => voice.id.includes("reference"))) return "референс-голос";
  return model.voices.length ? "пол не указан" : null;
}

function voiceDetails(voice: ModelEntry["voices"][number]): string {
  return [voice.language, voice.gender, voice.sample_rate ? `${voice.sample_rate} Hz` : null, voice.notes].filter(Boolean).join(" · ");
}

function formatBytes(sizeBytes: number | null | undefined): string | null {
  if (!sizeBytes || !Number.isFinite(sizeBytes)) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

function humanError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("NotAllowedError")) return "Нет доступа к микрофону.";
  if (message.includes("NotFoundError")) return "Микрофон не найден.";
  if (message.includes("play()")) return "Браузер заблокировал автозвук. Нажмите play.";
  return message;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
