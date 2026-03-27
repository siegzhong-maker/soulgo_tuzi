#!/usr/bin/env python3
"""
Export rabbit action GIFs from tuzi.psd layers.

Usage:
  python3 scripts/export-rabbit-gifs.py
"""

from pathlib import Path
from typing import Dict, List, Tuple

from PIL import Image
from psd_tools import PSDImage


ROOT = Path(__file__).resolve().parents[1]
PSD_PATH = ROOT / "比卡丘动画导出" / "tuzi.psd"
OUT_DIR = ROOT / "兔子动画导出"
CANVAS_SIZE = (720, 1100)
TARGET_BODY_HEIGHT_RATIO = 0.78
ANCHOR_BOTTOM_PX = 48

# NOTE:
# Layer indices are discovered from current PSD and grouped into action-like loops.
# If PSD structure changes later, update these lists.
ACTION_LAYERS: Dict[str, List[int]] = {
    "呼吸演示.gif": [6, 5, 7, 5],
    "等待演示.gif": [2, 13, 2],
    "观察演示.gif": [2, 8, 2],
    "互动演示.gif": [9, 8, 9],
    "休息演示.gif": [4, 4],  # static hold, repeated to make valid loop
    "吃演示.gif": [8, 9, 8],
    "摸演示.gif": [6, 7, 6],
}

# Per-action frame duration in milliseconds.
ACTION_DURATION_MS: Dict[str, int] = {
    "呼吸演示.gif": 140,
    "等待演示.gif": 180,
    "观察演示.gif": 140,
    "互动演示.gif": 120,
    "休息演示.gif": 240,
    "吃演示.gif": 120,
    "摸演示.gif": 120,
}


def layer_to_rgba(psd: PSDImage, layer_idx: int) -> Image.Image:
    layer = psd[layer_idx]
    im = layer.composite().convert("RGBA")
    return im


def trim_transparent(img: Image.Image) -> Tuple[Image.Image, Tuple[int, int, int, int]]:
    alpha = img.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        w, h = img.size
        return img, (0, 0, w, h)
    return img.crop(bbox), bbox


def normalize_frame(
    frame: Image.Image,
    canvas_size: Tuple[int, int],
    target_body_height_ratio: float,
    anchor_bottom_px: int,
) -> Tuple[Image.Image, float, Tuple[int, int, int, int]]:
    cw, ch = canvas_size
    cropped, src_bbox = trim_transparent(frame)
    fw, fh = cropped.size

    target_body_height = max(1, int(ch * target_body_height_ratio))
    scale = target_body_height / max(1, fh)
    new_w = max(1, int(round(fw * scale)))
    new_h = max(1, int(round(fh * scale)))

    # Avoid overflow to keep every frame inside canvas.
    if new_w > cw or new_h > ch:
        fit_scale = min(cw / max(1, new_w), ch / max(1, new_h))
        scale *= fit_scale
        new_w = max(1, int(round(fw * scale)))
        new_h = max(1, int(round(fh * scale)))

    resized = cropped.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    x = (cw - new_w) // 2
    # Bottom anchor: keep feet baseline stable.
    y = max(0, ch - anchor_bottom_px - new_h)
    canvas.alpha_composite(resized, (x, y))
    return canvas, scale, src_bbox


def normalize_frames(frames: List[Image.Image]) -> Tuple[List[Image.Image], List[float], List[Tuple[int, int, int, int]]]:
    normalized: List[Image.Image] = []
    scales: List[float] = []
    bboxes: List[Tuple[int, int, int, int]] = []
    for frame in frames:
        out, scale, bbox = normalize_frame(
            frame,
            canvas_size=CANVAS_SIZE,
            target_body_height_ratio=TARGET_BODY_HEIGHT_RATIO,
            anchor_bottom_px=ANCHOR_BOTTOM_PX,
        )
        normalized.append(out)
        scales.append(scale)
        bboxes.append(bbox)
    return normalized, scales, bboxes


def save_gif(frames: List[Image.Image], out_path: Path, duration_ms: int) -> None:
    if not frames:
        raise ValueError(f"No frames for {out_path.name}")
    # Save with transparency preserved.
    frames[0].save(
        out_path,
        save_all=True,
        append_images=frames[1:],
        duration=duration_ms,
        loop=0,
        disposal=2,
        optimize=False,
    )


def main() -> None:
    if not PSD_PATH.exists():
        raise FileNotFoundError(f"PSD not found: {PSD_PATH}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    psd = PSDImage.open(PSD_PATH)

    for filename, layer_indices in ACTION_LAYERS.items():
        raw_frames = [layer_to_rgba(psd, idx) for idx in layer_indices]
        frames, scales, bboxes = normalize_frames(raw_frames)
        out_path = OUT_DIR / filename
        duration_ms = ACTION_DURATION_MS.get(filename, 140)
        save_gif(frames, out_path, duration_ms)
        scales_text = ", ".join(f"{v:.3f}" for v in scales)
        bbox_text = ", ".join(f"{b[2]-b[0]}x{b[3]-b[1]}" for b in bboxes)
        print(f"Exported {out_path}")
        print(f"  normalize scale: [{scales_text}]")
        print(f"  source bbox: [{bbox_text}]")

    print("Rabbit GIF export finished.")


if __name__ == "__main__":
    main()
