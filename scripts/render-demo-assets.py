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

BG = "#f6f8f5"
INK = "#101513"
MUTED = "#627069"
LINE = "#dce4de"
GREEN = "#0f8f70"
DARK = "#061912"
AMBER = "#b26a00"
RED = "#b33333"


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
    rounded(draw, (x, y, x + w, y + h), "white")
    text(draw, (x + 18, y + 18), title.upper(), MUTED, F12)


def save_overview(demo):
    image = Image.new("RGB", (1400, 900), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1400, 116), fill=DARK)
    text(draw, (58, 34), "Realtime Voice Agent Kit", "white", F28)
    text(draw, (58, 72), "Azure Foundry demo on a small public voice dataset", "#b8cbc3", F16)
    text(draw, (1342, 42), demo["azure"]["model_response"], "#b8cbc3", F14, anchor="ra")

    summary = demo["summary"]
    cards = [
        ("Calls processed", str(summary["calls_processed"])),
        ("Events emitted", str(summary["total_events"])),
        ("Human handoffs", str(summary["handoffs"])),
        ("Dataset", "MInDS-14"),
    ]
    for i, (label, value) in enumerate(cards):
        x = 58 + i * 322
        panel(draw, x, 150, 292, 124, label)
        text(draw, (x + 18, 196), value, INK, F44)

    panel(draw, 58, 314, 1284, 520, "Generated call runs")
    y = 362
    headers = ["Call", "Intent", "Queue", "Handoff", "Events"]
    xs = [86, 270, 630, 920, 1110]
    for x, header in zip(xs, headers):
        text(draw, (x, y), header, MUTED, F12)
    draw.line((78, y + 28, 1322, y + 28), fill=LINE, width=1)
    y += 48
    for item in demo["replays"]:
        plan = item["model_plan"]
        replay = item["replay"]
        handoff = "yes" if plan.get("needs_handoff") else "no"
        values = [
            item["call_id"],
            plan.get("intent_label", ""),
            plan.get("queue", ""),
            handoff,
            str(len(replay.get("events", []))),
        ]
        for x, value in zip(xs, values):
            color = GREEN if value == "yes" else INK
            for line_idx, line in enumerate(wrap(value, 28 if x in [270, 630] else 18)[:2]):
                text(draw, (x, y + line_idx * 18), line, color, F14)
        draw.line((78, y + 58, 1322, y + 58), fill=LINE, width=1)
        y += 74

    image.save(SCREENSHOT_DIR / "azure-demo-overview.png")


def save_timeline(demo):
    item = demo["replays"][0]
    events = item["replay"]["events"]
    image = Image.new("RGB", (1400, 900), "#ffffff")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1400, 96), fill=DARK)
    text(draw, (58, 30), "Replay timeline", "white", F28)
    text(draw, (58, 66), f"{item['call_id']} · {item['model_plan']['intent_label']}", "#b8cbc3", F14)

    panel(draw, 58, 132, 492, 690, "Source transcript")
    transcript = item["source_row"]["transcription"]
    y = 184
    for line in wrap(transcript, 52):
        text(draw, (86, y), line, INK, F18)
        y += 26
    text(draw, (86, y + 24), "Assistant response", MUTED, F12)
    y += 52
    for line in wrap(item["model_plan"]["assistant_response"], 52):
        text(draw, (86, y), line, INK, F16)
        y += 24

    panel(draw, 590, 132, 752, 690, "Normalized events")
    y = 180
    for event in events:
        color = GREEN
        if event["type"].startswith("tool"):
            color = AMBER
        if event["type"].startswith("handoff"):
            color = RED
        draw.ellipse((624, y + 3, 638, y + 17), fill=color)
        text(draw, (660, y), event["type"], INK, F16)
        payload = event.get("payload", {})
        detail = payload.get("tool_name") or payload.get("name") or payload.get("speaker") or payload.get("target_queue") or ""
        if detail:
            text(draw, (920, y + 1), str(detail), MUTED, F14)
        y += 48

    image.save(SCREENSHOT_DIR / "azure-demo-timeline.png")


def save_eval(demo):
    image = Image.new("RGB", (1400, 900), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1400, 104), fill=DARK)
    text(draw, (58, 32), "Demo output", "white", F28)
    text(draw, (58, 68), "Model-generated plans replayed through the Fastify control plane", "#b8cbc3", F14)

    counts = demo["summary"]["event_counts"]
    panel(draw, 58, 144, 560, 650, "Event counts")
    y = 192
    for key, value in counts.items():
        text(draw, (92, y), key, INK, F16)
        draw.rounded_rectangle((380, y - 3, 380 + value * 32, y + 19), radius=6, fill=GREEN)
        text(draw, (510, y), str(value), MUTED, F14)
        y += 42

    panel(draw, 660, 144, 682, 650, "Post-call summaries")
    y = 192
    for item in demo["replays"]:
        text(draw, (692, y), item["call_id"], MUTED, F12)
        y += 22
        summary = item["replay"]["post_summary"]["payload"]["summary_text"]
        for line in wrap(summary, 62)[:3]:
            text(draw, (692, y), line, INK, F15)
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

    total_frames = max(80, len(events) * 7)
    for frame in range(total_frames):
        image = Image.new("RGB", (width, height), BG)
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, width, 90), fill=DARK)
        text(draw, (44, 26), "Realtime Voice Agent Kit", "white", F28)
        text(draw, (44, 62), "Azure Foundry · MInDS-14 · normalized event replay", "#b8cbc3", F14)
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
            draw.ellipse((x, yy + 5, x + 16, yy + 21), fill=color)
            text(draw, (x + 34, yy), event["type"], INK, F16)
            text(draw, (x + 260, yy), item["call_id"], MUTED, F14)
            payload = event.get("payload", {})
            detail = payload.get("text") or payload.get("tool_name") or payload.get("name") or payload.get("target_queue") or ""
            for line in wrap(detail, 58)[:1]:
                text(draw, (x + 420, yy), line, MUTED, F14)

        panel(draw, 820, 138, 390, 418, "Run metrics")
        metrics = [
            ("calls", demo["summary"]["calls_processed"]),
            ("events", demo["summary"]["total_events"]),
            ("handoffs", demo["summary"]["handoffs"]),
            ("model", demo["azure"]["model_response"]),
        ]
        my = 196
        for label, value in metrics:
            text(draw, (852, my), str(label).upper(), MUTED, F12)
            text(draw, (852, my + 22), str(value), INK, F22)
            my += 78

        image.save(TMP_DIR / f"frame_{frame:04d}.png")

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-framerate",
            "10",
            "-i",
            str(TMP_DIR / "frame_%04d.png"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(VIDEO_PATH),
        ],
        check=True,
    )


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
