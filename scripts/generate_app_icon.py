#!/usr/bin/env python3

from __future__ import annotations

import math
import subprocess
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
BUILD_RESOURCES = ROOT / "buildResources"
ICONSET_DIR = BUILD_RESOURCES / "icon.iconset"
MASTER_SIZE = 1024

ICONSET_SPECS = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}


def rgba(value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    red, green, blue = ImageColor.getrgb(value)
    return red, green, blue, alpha


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def blend(color_a: tuple[int, int, int, int], color_b: tuple[int, int, int, int], t: float) -> tuple[int, int, int, int]:
    return tuple(int(round(lerp(left, right, t))) for left, right in zip(color_a, color_b))


def draw_vertical_gradient(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size))
    pixels = image.load()

    top = rgba("#103f49")
    middle = rgba("#205f68")
    bottom = rgba("#c96f4e")

    for y in range(size):
      t = y / (size - 1)
      if t < 0.55:
          row_color = blend(top, middle, t / 0.55)
      else:
          row_color = blend(middle, bottom, (t - 0.55) / 0.45)
      for x in range(size):
          pixels[x, y] = row_color

    return image


def add_soft_glow(target: Image.Image, bounds: tuple[int, int, int, int], color: tuple[int, int, int, int], blur: int) -> None:
    layer = Image.new("RGBA", target.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(bounds, fill=color)
    target.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def draw_star(draw: ImageDraw.ImageDraw, center: tuple[float, float], outer_radius: float, inner_radius: float, fill: tuple[int, int, int, int]) -> None:
    cx, cy = center
    points: list[tuple[float, float]] = []

    for step in range(8):
        angle = math.radians(-90 + step * 45)
        radius = outer_radius if step % 2 == 0 else inner_radius
        points.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))

    draw.polygon(points, fill=fill)


def create_icon() -> Image.Image:
    image = draw_vertical_gradient(MASTER_SIZE)

    add_soft_glow(image, (90, 45, 420, 330), rgba("#f4d693", 72), 70)
    add_soft_glow(image, (610, 560, 1010, 980), rgba("#fff4df", 54), 110)
    add_soft_glow(image, (120, 720, 520, 1080), rgba("#ff9d6d", 45), 120)

    shadow_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_layer)
    card_bounds = (146, 132, 878, 884)
    shadow_draw.rounded_rectangle(card_bounds, radius=150, fill=rgba("#081b20", 88))
    image.alpha_composite(shadow_layer.filter(ImageFilter.GaussianBlur(34)))

    surface = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(surface)

    draw.rounded_rectangle(card_bounds, radius=145, fill=rgba("#fdf8ef"))
    draw.rounded_rectangle((146, 132, 878, 292), radius=145, fill=rgba("#123f4b"))
    draw.rectangle((146, 214, 878, 292), fill=rgba("#123f4b"))

    for x in (286, 512, 738):
        draw.rounded_rectangle((x - 24, 70, x + 24, 172), radius=24, fill=rgba("#fdf8ef"))
        draw.ellipse((x - 17, 198, x + 17, 232), fill=rgba("#f5d58c"))

    draw.rounded_rectangle((696, 176, 812, 238), radius=30, fill=rgba("#f5d58c"))
    draw_star(draw, (754, 206), 22, 9, rgba("#123f4b"))

    grid_left = 220
    grid_top = 352
    cell_gap = 22
    cell_width = 178
    cell_height = 114
    line_color = rgba("#d9e5e1")

    filled_cells = {
        (0, 0): rgba("#d5ece7"),
        (1, 1): rgba("#f3dcc8"),
        (2, 1): rgba("#e7efe1"),
        (0, 2): rgba("#e8f0ee"),
        (1, 2): rgba("#d7ece9"),
        (2, 2): rgba("#f0e5d7"),
    }

    for row in range(3):
        for col in range(3):
            x0 = grid_left + col * (cell_width + cell_gap)
            y0 = grid_top + row * (cell_height + cell_gap)
            x1 = x0 + cell_width
            y1 = y0 + cell_height
            draw.rounded_rectangle(
                (x0, y0, x1, y1),
                radius=32,
                fill=filled_cells.get((col, row), rgba("#ffffff")),
                outline=line_color,
                width=6,
            )

    check_bounds = (
        grid_left + cell_width + cell_gap,
        grid_top + cell_height + cell_gap,
        grid_left + 2 * cell_width + cell_gap,
        grid_top + 2 * cell_height + cell_gap,
    )
    draw.rounded_rectangle(check_bounds, radius=32, fill=rgba("#eb7b55"))
    draw.line(
        (
            check_bounds[0] + 48,
            check_bounds[1] + 62,
            check_bounds[0] + 82,
            check_bounds[1] + 94,
            check_bounds[0] + 132,
            check_bounds[1] + 36,
        ),
        fill=rgba("#fffaf2"),
        width=18,
        joint="curve",
    )

    footer_bounds = (286, 786, 738, 852)
    draw.rounded_rectangle(footer_bounds, radius=32, fill=rgba("#123f4b"))
    for center_x in (392, 512, 632):
        draw.ellipse((center_x - 18, 806, center_x + 18, 842), fill=rgba("#fdf8ef"))

    accent_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    accent_draw = ImageDraw.Draw(accent_layer)
    accent_draw.rounded_rectangle((176, 160, 848, 850), radius=132, outline=rgba("#ffffff", 34), width=5)
    accent_draw.arc((160, 146, 862, 862), start=205, end=340, fill=rgba("#f7d691", 84), width=12)
    image.alpha_composite(accent_layer.filter(ImageFilter.GaussianBlur(1)))

    image.alpha_composite(surface)
    return image


def write_outputs(image: Image.Image) -> None:
    BUILD_RESOURCES.mkdir(parents=True, exist_ok=True)
    ICONSET_DIR.mkdir(parents=True, exist_ok=True)

    png_path = BUILD_RESOURCES / "icon.png"
    ico_path = BUILD_RESOURCES / "icon.ico"
    icns_path = BUILD_RESOURCES / "icon.icns"

    image.save(png_path)
    image.save(ico_path, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    for file_name, size in ICONSET_SPECS.items():
        resized = image.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(ICONSET_DIR / file_name)

    subprocess.run(
        ["iconutil", "-c", "icns", str(ICONSET_DIR), "-o", str(icns_path)],
        check=True,
    )


def main() -> None:
    image = create_icon()
    write_outputs(image)
    print(f"Generated icon assets in {BUILD_RESOURCES}")


if __name__ == "__main__":
    main()
