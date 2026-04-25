import { Phone, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL, createSession, fetchModels, interruptSession, ModelEntry, SessionResponse, submitTurn, TurnResponse } from "./api";
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

type CallStatus = "idle" | "connecting" | "listening" | "capturing" | "processing" | "playing" | "ending" | "ended";

export function App() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [persona, setPersona] = useState(DEFAULT_PERSONA);
  const [turnOptions, setTurnOptions] = useState(DEFAULT_TURN_OPTIONS);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [lastTurn, setLastTurn] = useState<TurnResponse | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [inputLevel, setInputLevel] = useState(0);
  const [activity, setActivity] = useState("Нажмите кнопку и говорите.");
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
  const vadRef = useRef(new UtteranceVad());

  const selectedModel = useMemo(() => models.find((model) => model.id === selectedModelId), [models, selectedModelId]);
  const callActive = callStatus === "connecting" || callStatus === "listening" || callStatus === "capturing" || callStatus === "processing" || callStatus === "playing";
  const estimatedVoiceSeconds = turnOptions.talker_max_new_tokens / TALKER_TOKENS_PER_SECOND;

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    function loadModels() {
      fetchModels()
        .then((loaded) => {
          if (cancelled) return;
          setModels(loaded);
          const defaultModel =
            loaded.find((model) => model.default) ??
            loaded.find((model) => model.type === "audio_to_audio" && model.status === "ready") ??
            loaded[0];
          setSelectedModelId((current) => current || defaultModel?.id || "");
          if (loaded.some((model) => model.status === "loading" || model.status === "not_checked")) {
            timeoutId = window.setTimeout(loadModels, 3000);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setError(String(err));
          timeoutId = window.setTimeout(loadModels, 3000);
        });
    }

    loadModels();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      stopAudioGraph();
    };
  }, []);

  async function startCall() {
    const model = selectedModelRef.current;
    if (!model || model.status !== "ready") return;
    setError(null);
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
    await audioRef.current?.pause();
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
    const activeSession = sessionRef.current ?? (await createSession(selectedModelId, persona));
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

  return (
    <main className="lab-shell">
      <header className="topbar">
        <div>
          <h1>Голосовой тест</h1>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel controls-panel">
          <div className="field">
            <label htmlFor="model-select">Модель</label>
            <select id="model-select" value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)} disabled={callActive}>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.display_name}
                  {model.status === "ready" ? " (готово)" : ` (${model.status})`}
                </option>
              ))}
            </select>
          </div>

          {selectedModel && (
            <div className="model-card">
              <div className="model-title">
                <strong>{selectedModel.display_name}</strong>
                <div className="status-group">
                  <StatusPill status={selectedModel.status} />
                </div>
              </div>
              {selectedModel.status !== "ready" && <p className="status-detail">Модель недоступна.</p>}
            </div>
          )}

          <button className={`call-button ${callActive ? "call-button-live" : ""}`} onClick={toggleCall} disabled={!selectedModel || selectedModel.status !== "ready" || callStatus === "ending"}>
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

          {error && <div className="error-box">{error}</div>}
        </aside>

        <section className="panel runtime-panel">
          <div className="session-strip">
            <div>
              <span>Звонок</span>
              <strong>{session ? "активен" : "-"}</strong>
            </div>
            <div>
              <span>Статус</span>
              <strong>{statusLabel(callStatus)}</strong>
            </div>
            <div>
              <span>Задержка</span>
              <strong>{lastTurn ? `${lastTurn.latency_ms} ms` : "-"}</strong>
            </div>
            <div>
              <span>Аудио</span>
              <strong>{selectedModel?.output_sample_rate ?? "-"} Hz</strong>
            </div>
          </div>

          <audio ref={audioRef} controls className="audio-player" />

          <div className="response-section">
            <h2>Ответ</h2>
            <div className="response-box">{lastTurn?.text ?? "..."}</div>
          </div>
        </section>
      </section>
    </main>
  );
}

function statusLabel(status: CallStatus): string {
  if (status === "idle") return "ожидание";
  if (status === "connecting") return "подключение";
  if (status === "listening") return "слушаю";
  if (status === "capturing") return "речь";
  if (status === "processing") return "ответ";
  if (status === "playing") return "воспроизведение";
  if (status === "ending") return "завершение";
  return "завершен";
}

function humanError(err: unknown): string {
  const message = String(err);
  if (message.includes("NotAllowedError")) return "Нет доступа к микрофону.";
  if (message.includes("NotFoundError")) return "Микрофон не найден.";
  if (message.includes("play()")) return "Браузер заблокировал автозвук. Нажмите play.";
  return message;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
