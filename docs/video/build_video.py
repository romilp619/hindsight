#!/usr/bin/env python3
"""Build the Hindsight demo video: footage cut and sped up to match the narration, scene by scene.

Each scene is a list of (clip, start, end, speed) segments plus one narration line. Waiting parts
(spinners, loading) are sped up hard; clicks and answers play at (near) real speed. The voice
starts as the scene starts; if a scene's footage is shorter than its line, the last frame is held.
Output: 2560x1440, 30 fps, AAC. No loudness limiter (it caused audible clicks), just fixed gain.
"""
import json
import os
import subprocess

EXP = "/mnt/c/Users/Romil/Swoop/Exports/"
CLIP = {
    "create": EXP + "2026-11-18 11.36.16 1440p 13.33.04.mp4",
    "panel": EXP + "2026-11-18 11.39.19 1440p 13.33.33.mp4",
    "lessons": EXP + "2026-11-18 11.40.02 1440p 13.34.05.mp4",
    "children": EXP + "2026-11-18 11.41.22 1440p 13.34.28.mp4",
    "rovo": EXP + "2026-11-18 11.42.18 1440p 13.34.35.mp4",
    "rovo_scroll": EXP + "2026-11-18 11.43.49 1440p 13.35.50.mp4",
    "cli": EXP + "2026-11-18 13.32.15 1440p 13.36.06.mp4",
    "claude": EXP + "2026-11-18 13.06.31 1440p 13.36.29.mp4",
}
CARD = {"intro": "card_intro.png", "outro": "card_outro.png"}

# (narration id, [segments]); segment = (clip, start, end, speed) or ("card", name, seconds)
SCENES = [
    ("00_intro", [("card", "intro", None)]),
    ("01_create", [("create", 0.0, 19.87, 1.25)]),
    ("02_panel", [("panel", 0.0, 30.37, 1.30)]),
    ("03_tasks", [("lessons", 2.0, 12.5, 1.35)]),
    ("04_child", [("children", 0.0, 4.5, 1.3)]),
    ("05_rovo", [("rovo", 0.0, 30.0, 2.4)]),
    ("06_answer", [("rovo", 30.0, 46.0, 3.0), ("rovo_scroll", 0.0, 18.67, 1.9)]),
    ("07_cli", [("cli", 0.0, 4.2, 1.0), ("cli", 4.2, 18.5, 2.0), ("cli", 18.5, 22.57, 1.0)]),
    ("09_outro", [("card", "outro", None)]),
]
LEAD, TAIL, GAIN_DB = 0.35, 0.7, 0.0
VO = "vo_final/{}.wav"  # Kokoro voice: denoise, declick, soft gate, de-esser, 9 kHz high-cut, peaks at -1.5 dBFS (no compressor: it made s/t harsh)
FIT = "scale=2560:1440:force_original_aspect_ratio=increase,crop=2560:1440,setsar=1,fps=30,format=yuv420p"


def dur(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).decode())


def main(out):
    inputs, vparts, vlabels, apieces = [], [], [], []
    idx = {}

    def inp(path, *pre):
        key = (path, pre)
        if key not in idx:
            idx[key] = len(idx)  # ffmpeg input number, not argument position
            inputs.extend([*pre, "-i", path])
        return idx[key]

    t = 0.0
    timeline = []
    for si, (vo, segs) in enumerate(SCENES):
        voice = dur(VO.format(vo))
        labels, scene_len = [], 0.0
        for gi, seg in enumerate(segs):
            lab = f"v{si}_{gi}"
            if seg[0] == "card":
                length = round(voice + 1.4, 3)
                i = inp(CARD[seg[1]], "-loop", "1", "-framerate", "30", "-t", "30")
                vparts.append(f"[{i}:v]trim=0:{length},setpts=PTS-STARTPTS,{FIT},fade=t=in:st=0:d=0.6,fade=t=out:st={length-0.6}:d=0.6[{lab}]")
            else:
                clip, a, b, speed = seg
                length = (b - a) / speed
                i = inp(CLIP[clip])
                vparts.append(f"[{i}:v]trim={a}:{b},setpts=(PTS-STARTPTS)/{speed},{FIT}[{lab}]")
            labels.append(lab)
            scene_len += length
        need = LEAD + voice + TAIL
        if scene_len < need:  # hold the last frame so the line can finish
            last = labels[-1]
            vparts.append(f"[{last}]tpad=stop_mode=clone:stop_duration={need-scene_len:.3f}[{last}h]")
            labels[-1] = last + "h"
            scene_len = need
        vlabels += labels
        timeline.append((vo, round(t, 2), round(scene_len, 2), round(voice, 2)))
        apieces.append((t + (0.6 if segs[0][0] == "card" else LEAD), vo))
        t += scene_len

    # Narration: silence gaps + lines in sequence (no mixing, no limiter), tiny fades against clicks.
    aparts, alabels, cursor = [], [], 0.0
    for k, (start, vo) in enumerate(apieces):
        i = inp(VO.format(vo))
        d = dur(VO.format(vo))
        aparts.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{max(0.0, start-cursor):.3f}[g{k}]")
        aparts.append(f"[{i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                      f"afade=t=in:d=0.015,afade=t=out:st={d-0.02:.3f}:d=0.02,volume={GAIN_DB}dB[l{k}]")
        alabels += [f"[g{k}]", f"[l{k}]"]
        cursor = start + d
    aparts.append(f"{''.join(alabels)}concat=n={len(alabels)}:v=0:a=1,apad=whole_dur={t:.3f}[a]")

    graph = ";".join(vparts + [f"{''.join('['+l+']' for l in vlabels)}concat=n={len(vlabels)}:v=1:a=0[v]"] + aparts)
    cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[v]", "-map", "[a]",
           "-t", f"{t:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-r", "30",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]
    for row in timeline:
        print("%-10s starts %6.2fs  scene %6.2fs  voice %5.2fs" % row)
    print("total %.2fs" % t, flush=True)
    subprocess.check_call(cmd)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    main(EXP + "Hindsight demo - final v6 (1440p30, clean voice, no Claude Code).mp4")
