#!/usr/bin/env python3
"""
Export rabbit action GIFs from tuzi.psd layers.

Usage:
  python3 scripts/export-rabbit-gifs.py
"""

from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
from PIL import Image
from psd_tools import PSDImage
from scipy import ndimage


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

# Per-action visual tuning:
# - scale multiplier adjusts perceived size by action
# - anchor offset y adjusts feet baseline drift (positive = lower, negative = higher)
ACTION_SCALE_MULTIPLIER: Dict[str, float] = {
    "呼吸演示.gif": 1.01,
    "等待演示.gif": 0.98,
    "观察演示.gif": 1.02,
    "互动演示.gif": 1.02,
    "休息演示.gif": 0.98,
    "吃演示.gif": 1.06,
    "摸演示.gif": 0.98,
}

ACTION_ANCHOR_OFFSET_Y: Dict[str, int] = {
    "呼吸演示.gif": 0,
    "等待演示.gif": -4,
    "观察演示.gif": 0,
    "互动演示.gif": 6,
    "休息演示.gif": -8,
    "吃演示.gif": 4,
    "摸演示.gif": 2,
}


def layer_to_rgba(psd: PSDImage, layer_idx: int) -> Image.Image:
    layer = psd[layer_idx]
    im = layer.composite().convert("RGBA")
    return im


def largest_component_bbox(alpha: np.ndarray, threshold: int = 8) -> Tuple[int, int, int, int]:
    """
    Find bbox of the largest connected non-transparent component.
    Helps ignore tiny detached pixels that inflate bbox width/height.
    """
    mask = alpha > threshold
    if not mask.any():
        h, w = alpha.shape
        return (0, 0, w, h)

    labeled, num_labels = ndimage.label(mask)
    if num_labels <= 1:
        ys, xs = np.where(mask)
        return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)

    counts = np.bincount(labeled.ravel())
    counts[0] = 0  # background
    largest_label = int(np.argmax(counts))
    ys, xs = np.where(labeled == largest_label)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def trim_transparent(img: Image.Image) -> Tuple[Image.Image, Tuple[int, int, int, int]]:
    alpha_img = img.getchannel("A")
    alpha = np.array(alpha_img, dtype=np.uint8)
    x0, y0, x1, y1 = largest_component_bbox(alpha)

    # Add a tiny safety margin to avoid clipping anti-aliased edges.
    margin = 2
    x0 = max(0, x0 - margin)
    y0 = max(0, y0 - margin)
    x1 = min(alpha.shape[1], x1 + margin)
    y1 = min(alpha.shape[0], y1 + margin)

    if x1 <= x0 or y1 <= y0:
        w, h = img.size
        return img, (0, 0, w, h)

    bbox = (x0, y0, x1, y1)
    return img.crop(bbox), bbox


def normalize_frame(
    frame: Image.Image,
    canvas_size: Tuple[int, int],
    target_body_height_ratio: float,
    anchor_bottom_px: int,
    scale_multiplier: float = 1.0,
    anchor_offset_y: int = 0,
) -> Tuple[Image.Image, float, Tuple[int, int, int, int]]:
    cw, ch = canvas_size
    cropped, src_bbox = trim_transparent(frame)
    fw, fh = cropped.size

    target_body_height = max(1, int(ch * target_body_height_ratio))
    scale = target_body_height / max(1, fh)
    scale *= max(0.5, scale_multiplier)
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
    y = max(0, ch - anchor_bottom_px - new_h + anchor_offset_y)
    canvas.alpha_composite(resized, (x, y))
    return canvas, scale, src_bbox


def normalize_frames(
    frames: List[Image.Image],
    action_name: str,
) -> Tuple[List[Image.Image], List[float], List[Tuple[int, int, int, int]], int]:
    normalized: List[Image.Image] = []
    scales: List[float] = []
    bboxes: List[Tuple[int, int, int, int]] = []
    final_heights: List[int] = []
    scale_multiplier = ACTION_SCALE_MULTIPLIER.get(action_name, 1.0)
    anchor_offset_y = ACTION_ANCHOR_OFFSET_Y.get(action_name, 0)
    for frame in frames:
        out, scale, bbox = normalize_frame(
            frame,
            canvas_size=CANVAS_SIZE,
            target_body_height_ratio=TARGET_BODY_HEIGHT_RATIO,
            anchor_bottom_px=ANCHOR_BOTTOM_PX,
            scale_multiplier=scale_multiplier,
            anchor_offset_y=anchor_offset_y,
        )
        normalized.append(out)
        scales.append(scale)
        bboxes.append(bbox)
        src_h = max(1, bbox[3] - bbox[1])
        final_heights.append(int(round(src_h * scale)))
    avg_final_height = int(round(sum(final_heights) / max(1, len(final_heights))))
    return normalized, scales, bboxes, avg_final_height


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
        frames, scales, bboxes, avg_final_height = normalize_frames(raw_frames, action_name=filename)
        out_path = OUT_DIR / filename
        duration_ms = ACTION_DURATION_MS.get(filename, 140)
        save_gif(frames, out_path, duration_ms)
        scales_text = ", ".join(f"{v:.3f}" for v in scales)
        bbox_text = ", ".join(f"{b[2]-b[0]}x{b[3]-b[1]}" for b in bboxes)
        scale_multiplier = ACTION_SCALE_MULTIPLIER.get(filename, 1.0)
        anchor_offset_y = ACTION_ANCHOR_OFFSET_Y.get(filename, 0)
        print(f"Exported {out_path}")
        print(f"  action tune: scale_multiplier={scale_multiplier:.2f}, anchor_offset_y={anchor_offset_y}")
        print(f"  normalize scale: [{scales_text}]")
        print(f"  source bbox: [{bbox_text}]")
        print(f"  avg final height(px): {avg_final_height}")

    print("Rabbit GIF export finished.")


if __name__ == "__main__":
    main()
