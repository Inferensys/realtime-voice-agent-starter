const state = {
  callId: null,
  pc: null,
  dc: null,
  stream: null,
  sequence: 0,
  transcript: [],
  running: false
};

const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const replayButton = document.querySelector("#replay");
const statusText = document.querySelector("#status");
const dot = document.querySelector("#dot");
const timeline = document.querySelector("#timeline");
const transcript = document.querySelector("#transcript");
const remoteAudio = document.querySelector("#remote-audio");
const meter = document.querySelector("#meter");

const bars = Array.from({ length: 72 }, (_, index) => {
  const bar = document.createElement("div");
  bar.className = index > 28 && index < 43 ? "bar hot" : "bar";
  bar.style.height = `${20 + Math.round(Math.abs(Math.sin(index / 6)) * 120)}px`;
  meter.appendChild(bar);
  return bar;
});

startButton.addEventListener("click", startCall);
stopButton.addEventListener("click", stopCall);
replayButton.addEventListener("click", fetchReplay);

loadConfig().catch((error) => showError(error.message));

async function loadConfig() {
  const config = await requestJson("/config");
  document.querySelector("#agent-name").textContent = config.agent.name;
  document.querySelector("#agent-model").textContent = config.model;
  document.querySelector("#agent-voice").textContent = config.voice;
}

async function startCall() {
  try {
    setStatus("starting");
    startButton.disabled = true;

    const call = await requestJson("/calls/start", { method: "POST", body: {} });
    state.callId = call.callId || call.id || call.call_id;
    addTimeline("call.started", state.callId);
    await postEvent({
      type: "call.activated",
      timestamp: new Date().toISOString(),
      sequence: nextSequence(),
      payload: { transport: "browser-webrtc" }
    });

    const pc = new RTCPeerConnection();
    state.pc = pc;
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of state.stream.getTracks()) pc.addTrack(track, state.stream);

    pc.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0];
    };

    const dc = pc.createDataChannel("oai-events");
    state.dc = dc;
    dc.onopen = () => {
      addTimeline("data_channel.open", "OpenAI Realtime data channel ready");
      sendRealtimeCommand({
        type: "session.update",
        session: {
          turn_detection: { type: "server_vad" }
        }
      });
    };
    dc.onmessage = (event) => handleRealtimeEvent(JSON.parse(event.data));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const session = await requestJson("/session", {
      method: "POST",
      body: {
        sdp: offer.sdp,
        instructions:
          "You are a practical voice support agent. Keep replies short. Ask for clarification when needed."
      }
    });

    await pc.setRemoteDescription({
      type: "answer",
      sdp: session.answerSdp
    });

    state.running = true;
    stopButton.disabled = false;
    replayButton.disabled = false;
    animateMeter();
    setStatus("live", true);
  } catch (error) {
    showError(error.message);
    await stopCall({ keepReplay: true });
  }
}

async function stopCall({ keepReplay = false } = {}) {
  setStatus("stopping");
  startButton.disabled = false;
  stopButton.disabled = true;
  if (!keepReplay) replayButton.disabled = !state.callId;

  if (state.dc?.readyState === "open") {
    sendRealtimeCommand({ type: "response.cancel" });
  }
  state.dc?.close();
  state.pc?.close();
  for (const track of state.stream?.getTracks() || []) track.stop();

  state.running = false;
  state.pc = null;
  state.dc = null;
  state.stream = null;

  if (state.callId) {
    await postEvent({
      type: "call.closing",
      timestamp: new Date().toISOString(),
      sequence: nextSequence(),
      metadata: { reason: "browser-stop" }
    }).catch((error) => addTimeline("event.forward_failed", error.message));
    await postEvent({
      type: "call.closed",
      timestamp: new Date().toISOString(),
      sequence: nextSequence()
    }).catch((error) => addTimeline("event.forward_failed", error.message));
  }

  setStatus(state.callId ? "stopped" : "idle");
}

async function fetchReplay() {
  if (!state.callId) return;
  const replay = await requestJson(`/replay/${encodeURIComponent(state.callId)}`);
  addTimeline("replay.loaded", `${replay.events?.length || 0} events`);
}

function handleRealtimeEvent(event) {
  if (!event?.type) return;
  addTimeline(event.type, summarizeRealtimeEvent(event));

  const normalized = normalizeRealtimeEvent(event);
  if (!normalized) return;
  postEvent(normalized).catch((error) => addTimeline("event.forward_failed", error.message));

  if (normalized.type === "transcript.final" && normalized.text) {
    state.transcript.push(`${normalized.speaker}: ${normalized.text}`);
    transcript.textContent = state.transcript.join("\n");
  }
}

function normalizeRealtimeEvent(event) {
  const timestamp = new Date().toISOString();

  if (event.type === "input_audio_buffer.speech_started") {
    return {
      type: "turn.interrupted",
      timestamp,
      sequence: nextSequence(),
      by: "user",
      metadata: { providerEventId: event.event_id }
    };
  }

  if (event.type === "response.audio.delta") {
    return {
      type: "audio.output",
      timestamp,
      sequence: nextSequence(),
      codec: "provider-native",
      sampleRateHz: 24000,
      bytes: estimateBase64Bytes(event.delta),
      metadata: { providerEventId: event.event_id }
    };
  }

  if (event.type === "response.audio_transcript.delta") {
    return {
      type: "transcript.partial",
      timestamp,
      sequence: nextSequence(),
      speaker: "assistant",
      text: event.delta || "",
      confidence: 0.8,
      metadata: { providerEventId: event.event_id }
    };
  }

  if (event.type === "response.audio_transcript.done") {
    return {
      type: "transcript.final",
      timestamp,
      sequence: nextSequence(),
      speaker: "assistant",
      text: event.transcript || "",
      confidence: 0.9,
      metadata: { providerEventId: event.event_id }
    };
  }

  if (event.type === "conversation.item.input_audio_transcription.completed") {
    return {
      type: "transcript.final",
      timestamp,
      sequence: nextSequence(),
      speaker: "caller",
      text: event.transcript || "",
      confidence: 0.9,
      metadata: { providerEventId: event.event_id }
    };
  }

  return null;
}

async function postEvent(event) {
  if (!state.callId) return;
  await requestJson("/events", {
    method: "POST",
    body: {
      callId: state.callId,
      event
    }
  });
}

function sendRealtimeCommand(command) {
  if (state.dc?.readyState !== "open") return;
  state.dc.send(JSON.stringify(command));
}

function addTimeline(type, detail = "") {
  const item = document.createElement("div");
  item.className = "event";
  item.innerHTML = `<strong></strong><span></span>`;
  item.querySelector("strong").textContent = type;
  item.querySelector("span").textContent = detail;
  timeline.prepend(item);
}

function setStatus(text, live = false) {
  statusText.textContent = text;
  dot.classList.toggle("live", live);
}

function showError(message) {
  setStatus("error");
  addTimeline("error", message);
  transcript.innerHTML = `<span class="error">${escapeHtml(message)}</span>`;
}

function nextSequence() {
  state.sequence += 1;
  return state.sequence;
}

function summarizeRealtimeEvent(event) {
  return event.transcript || event.delta || event.item_id || event.response_id || "";
}

function estimateBase64Bytes(value = "") {
  if (!value) return 0;
  return Math.floor((value.length * 3) / 4);
}

function animateMeter() {
  if (!state.running) return;
  for (const [index, bar] of bars.entries()) {
    const wave = Math.abs(Math.sin(Date.now() / 260 + index / 5));
    bar.style.height = `${18 + Math.round(wave * 134)}px`;
  }
  requestAnimationFrame(animateMeter);
}

async function requestJson(url, { method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `${method} ${url} failed`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
