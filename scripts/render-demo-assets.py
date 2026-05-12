#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DEMO_DIR = ROOT / "docs" / "demo"
SCREENSHOT_DIR = DEMO_DIR / "screenshots"
TMP_DIR = ROOT / ".tmp" / "demo-frames"
VIDEO_PATH = DEMO_DIR / "realtime-voice-agent-demo.mp4"
AUDIO_PATH = DEMO_DIR / "output" / "realtime-output.wav"

WHITE = "#FFFFFF"
CHEROKEE = "#F0CC8C"
BUNKER = "#111114"
EUCALYPTUS = "#3AE68A"
PORTAGE = "#A1A5F8"
ORCHID = "#D860F4"
BG = "#E4EAF0"
INK = BUNKER
MUTED = "#646974"
LINE = "#D9DEE5"
GREEN = EUCALYPTUS
DARK = BUNKER
AMBER = CHEROKEE
RED = ORCHID


def font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/SFNS.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for path in candidates:
        if path and Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


F12 = font(12)
F14 = font(14)
F15 = font(15)
F16 = font(16)
F18 = font(18)
F22 = font(22, True)
F28 = font(28, True)
F44 = font(44, True)


def load_demo():
    with open(DEMO_DIR / "azure-foundry-demo.json", "r", encoding="utf-8") as handle:
        return json.load(handle)


def rounded(draw, xy, fill, outline=LINE, radius=10, width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def text(draw, xy, value, fill=INK, font_obj=F14, anchor=None):
    draw.text(xy, value, fill=fill, font=font_obj, anchor=anchor)


def wrap(value, max_chars):
    words = str(value).split()
    lines = []
    line = ""
    for word in words:
        if len(line) + len(word) + 1 <= max_chars:
            line = f"{line} {word}".strip()
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def panel(draw, x, y, w, h, title):
    rounded(draw, (x, y, x + w, y + h), WHITE, radius=6)
    text(draw, (x + 18, y + 18), title.upper(), MUTED, F12)


def accent_bar(draw, x, y, w, color):
    draw.rounded_rectangle((x, y, x + w, y + 8), radius=4, fill=color)


def save_overview(demo):
    image = Image.new("RGB", (1400, 900), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1400, 118), fill=DARK)
    draw.rectangle((0, 118, 1400, 126), fill=EUCALYPTUS)
    draw.rectangle((350, 118, 590, 126), fill=PORTAGE)
    draw.rectangle((590, 118, 820, 126), fill=CHEROKEE)
    draw.rectangle((820, 118, 1040, 126), fill=ORCHID)
    text(draw, (58, 34), "Realtime Voice Agent Kit", WHITE, F28)
    text(draw, (58, 72), "Real audio in. Realtime model audio out. Typed event timeline for your app.", "#D7DCE3", F16)
    text(draw, (1342, 42), demo["azure"]["model"], "#D7DCE3", F14, anchor="ra")

    summary = demo["summary"]
    cards = [
        ("Calls processed", str(summary["calls_processed"])),
        ("Realtime events", str(summary["realtime_events"])),
        ("Control events", str(summary["control_plane_events"])),
        ("Dataset", "MInDS-14"),
    ]
    for i, (label, value) in enumerate(cards):
        x = 58 + i * 322
        panel(draw, x, 150, 292, 124, label)
        draw.rectangle((x, 150, x + 292, 158), fill=[EUCALYPTUS, PORTAGE, CHEROKEE, ORCHID][i])
        text(draw, (x + 18, 196), value, INK, F44)

    panel(draw, 58, 314, 1284, 520, "Generated call runs")
    draw.rectangle((58, 314, 1342, 322), fill=CHEROKEE)
    y = 362
    headers = ["Call", "Model response", "Deployment", "Realtime", "Audio bytes"]
    xs = [86, 270, 760, 980, 1130]
    for x, header in zip(xs, headers):
        text(draw, (x, y), header, MUTED, F12)
    draw.line((78, y + 28, 1322, y + 28), fill=LINE, width=1)
    y += 48
    for item in demo["replays"]:
        realtime = item["realtime"]
        replay = item["replay"]
        values = [
            item["call_id"],
            realtime.get("output_transcript", ""),
            replay.get("events", [{}])[0].get("payload", {}).get("realtime_deployment", demo["azure"]["deployment"]),
            str(realtime.get("raw_event_count", "")),
            str(realtime.get("output_audio_bytes", "")),
        ]
        for x, value in zip(xs, values):
            color = EUCALYPTUS if x == 980 else INK
            for line_idx, line in enumerate(wrap(value, 42 if x == 270 else 18)[:2]):
                text(draw, (x, y + line_idx * 18), line, color, F14)
        draw.line((78, y + 58, 1322, y + 58), fill=LINE, width=1)
        y += 74

    image.save(SCREENSHOT_DIR / "azure-demo-overview.png")


def save_timeline(demo):
    item = demo["replays"][0]
    events = item["replay"]["events"]
    image = Image.new("RGB", (1400, 900), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1400, 98), fill=DARK)
    draw.rectangle((0, 98, 620, 106), fill=EUCALYPTUS)
    draw.rectangle((620, 98, 900, 106), fill=PORTAGE)
    draw.rectangle((900, 98, 1400, 106), fill=CHEROKEE)
    text(draw, (58, 30), "Replay timeline", WHITE, F28)
    text(draw, (58, 66), f"{item['call_id']} · real audio sent to {item['realtime']['model']}", "#D7DCE3", F14)

    panel(draw, 58, 132, 492, 690, "Source audio")
    draw.rectangle((58, 132, 550, 140), fill=PORTAGE)
    transcript = item["source_row"]["transcription"]
    y = 184
    text(draw, (86, y), item["source_row"]["local_audio"], MUTED, F14)
    y += 36
    for line in wrap(transcript, 52):
        text(draw, (86, y), line, INK, F18)
        y += 26
    text(draw, (86, y + 24), "Realtime model response", MUTED, F12)
    y += 52
    for line in wrap(item["realtime"]["output_transcript"], 52):
        text(draw, (86, y), line, INK, F16)
        y += 24

    panel(draw, 590, 132, 752, 690, "Normalized events")
    draw.rectangle((590, 132, 1342, 140), fill=EUCALYPTUS)
    y = 180
    for event in events[:12]:
        color = GREEN
        if event["type"].startswith("tool"):
            color = AMBER
        if event["type"].startswith("handoff"):
            color = RED
        draw.rounded_rectangle((624, y + 3, 638, y + 17), radius=3, fill=color)
        text(draw, (660, y), event["type"], INK, F16)
        payload = event.get("payload", {})
        detail = payload.get("tool_name") or payload.get("name") or payload.get("speaker") or payload.get("target_queue") or ""
        if detail:
            text(draw, (920, y + 1), str(detail), MUTED, F14)
        y += 48
    if len(events) > 12:
        text(draw, (660, y), f"+ {len(events) - 12} more replay events", MUTED, F14)

    image.save(SCREENSHOT_DIR / "azure-demo-timeline.png")


def save_eval(demo):
    image = Image.new("RGB", (1400, 900), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1400, 104), fill=DARK)
    draw.rectangle((0, 104, 465, 112), fill=EUCALYPTUS)
    draw.rectangle((465, 104, 930, 112), fill=PORTAGE)
    draw.rectangle((930, 104, 1400, 112), fill=ORCHID)
    text(draw, (58, 32), "Demo output", WHITE, F28)
    text(draw, (58, 68), "Realtime audio results replayed through the Fastify control plane", "#D7DCE3", F14)

    counts = demo["summary"]["event_counts"]
    panel(draw, 58, 144, 560, 650, "Event counts")
    draw.rectangle((58, 144, 618, 152), fill=CHEROKEE)
    y = 192
    colors = [EUCALYPTUS, PORTAGE, CHEROKEE, ORCHID]
    for idx, (key, value) in enumerate(counts.items()):
        text(draw, (92, y), key, INK, F16)
        draw.rounded_rectangle((380, y - 3, 380 + value * 32, y + 19), radius=4, fill=colors[idx % len(colors)])
        text(draw, (510, y), str(value), MUTED, F14)
        y += 42

    panel(draw, 660, 144, 682, 650, "Realtime responses")
    draw.rectangle((660, 144, 1342, 152), fill=EUCALYPTUS)
    y = 192
    for item in demo["replays"]:
        text(draw, (692, y), item["call_id"], MUTED, F12)
        y += 22
        summary = item["realtime"]["output_transcript"]
        for line in wrap(summary, 62)[:3]:
            text(draw, (692, y), line, INK, F15)
            y += 22
        text(draw, (692, y + 2), f"audio: {item['realtime']['response_audio_path']}", MUTED, F12)
        y += 22
        y += 24

    image.save(SCREENSHOT_DIR / "azure-demo-output.png")


def save_video(demo):
    if TMP_DIR.exists():
        shutil.rmtree(TMP_DIR)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    width, height = 1280, 720
    events = []
    for item in demo["replays"]:
        for event in item["replay"]["events"]:
            events.append((item, event))

    audio_seconds = max(1, int(demo["summary"].get("output_audio_bytes", 0)) / 48000)
    total_frames = max(80, len(events) * 7, int(audio_seconds * 10) + 20)
    for frame in range(total_frames):
        image = Image.new("RGB", (width, height), BG)
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, width, 90), fill=DARK)
        draw.rectangle((0, 90, 430, 98), fill=EUCALYPTUS)
        draw.rectangle((430, 90, 730, 98), fill=PORTAGE)
        draw.rectangle((730, 90, width, 98), fill=CHEROKEE)
        text(draw, (44, 26), "Realtime Voice Agent Kit", WHITE, F28)
        text(draw, (44, 62), "Azure Realtime · MInDS-14 · audio output included", "#D7DCE3", F14)
        active_count = min(len(events), 1 + frame // 7)
        x, y = 62, 138
        text(draw, (x, y - 44), "Live event stream", INK, F22)
        for idx, (item, event) in enumerate(events[:active_count][-10:]):
            yy = y + idx * 48
            color = GREEN
            if event["type"].startswith("tool"):
                color = AMBER
            if event["type"].startswith("handoff"):
                color = RED
            draw.rounded_rectangle((x, yy + 5, x + 16, yy + 21), radius=3, fill=color)
            text(draw, (x + 34, yy), event["type"], INK, F16)
            text(draw, (x + 260, yy), item["call_id"], MUTED, F14)
            payload = event.get("payload", {})
            detail = payload.get("text") or payload.get("tool_name") or payload.get("name") or payload.get("target_queue") or ""
            for line in wrap(detail, 58)[:1]:
                text(draw, (x + 420, yy), line, MUTED, F14)

        panel(draw, 820, 138, 390, 418, "Run metrics")
        draw.rectangle((820, 138, 1210, 146), fill=ORCHID)
        metrics = [
            ("calls", demo["summary"]["calls_processed"]),
            ("realtime events", demo["summary"]["realtime_events"]),
            ("control events", demo["summary"]["control_plane_events"]),
            ("model", demo["azure"]["model"]),
        ]
        my = 196
        for label, value in metrics:
            text(draw, (852, my), str(label).upper(), MUTED, F12)
            text(draw, (852, my + 22), str(value), INK, F22)
            my += 78

        image.save(TMP_DIR / f"frame_{frame:04d}.png")

    audio_mix = save_audio_mix(demo)
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-framerate",
        "10",
        "-i",
        str(TMP_DIR / "frame_%04d.png"),
    ]
    if audio_mix.exists():
        command.extend(["-i", str(audio_mix)])
    command.extend(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
    if audio_mix.exists():
        command.extend(["-c:a", "aac", "-b:a", "128k", "-shortest"])
    command.append(str(VIDEO_PATH))
    subprocess.run(command, check=True)


def save_audio_mix(demo):
    response_paths = [
        ROOT / item["realtime"]["response_audio_path"]
        for item in demo["replays"]
        if item.get("realtime", {}).get("response_audio_path")
    ]
    response_paths = [path for path in response_paths if path.exists()]
    if not response_paths:
        return AUDIO_PATH
    AUDIO_PATH.parent.mkdir(parents=True, exist_ok=True)
    concat_file = TMP_DIR / "response-audio.txt"
    with open(concat_file, "w", encoding="utf-8") as handle:
        for path in response_paths:
            escaped = str(path).replace("'", "'\\''")
            handle.write(f"file '{escaped}'\n")
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-c:a",
            "pcm_s16le",
            str(AUDIO_PATH),
        ],
        check=True,
    )
    return AUDIO_PATH


def main():
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    demo = load_demo()
    save_overview(demo)
    save_timeline(demo)
    save_eval(demo)
    save_video(demo)
    print(f"Wrote {SCREENSHOT_DIR / 'azure-demo-overview.png'}")
    print(f"Wrote {SCREENSHOT_DIR / 'azure-demo-timeline.png'}")
    print(f"Wrote {SCREENSHOT_DIR / 'azure-demo-output.png'}")
    print(f"Wrote {VIDEO_PATH}")


if __name__ == "__main__":
    main()
