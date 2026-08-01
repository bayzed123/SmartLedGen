from PIL import Image, ImageDraw, ImageFont
import textwrap

INK = "#10151F"
TEAL = "#0E7C6B"
TEAL_DEEP = "#0A5A4D"
TEAL_LIGHT = "#E4F3EF"
AMBER = "#E8A33D"
AMBER_LIGHT = "#FCEBD5"
OFFWHITE = "#F7F6F3"
LINE = "#D8D4CB"
TEXT_SOFT = "#5B6472"
WHITE = "#FFFFFF"
BLUE = "#3D6FB4"
BLUE_LIGHT = "#E8EEF7"
PURPLE = "#6C5CE7"
PURPLE_LIGHT = "#EEECFD"

FONT_DIR = "/usr/share/fonts/truetype/dejavu/"

def font(size, bold=False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(FONT_DIR + name, size)

def wrap(text, width):
    return textwrap.wrap(text, width=width)

def box(draw, xy, title, subtitle=None, fill=WHITE, border=LINE, title_color=INK,
        sub_color=TEXT_SOFT, radius=16, title_size=19, sub_size=14, border_width=2):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=border, width=border_width)
    tf = font(title_size, bold=True)
    lines = wrap(title, max(10, int((x1 - x0) / (title_size * 0.55))))
    cy = y0 + (y1 - y0) / 2
    if subtitle:
        sf = font(sub_size)
        sub_lines = wrap(subtitle, max(12, int((x1 - x0) / (sub_size * 0.5))))
        total_h = len(lines) * (title_size + 4) + 6 + len(sub_lines) * (sub_size + 3)
        y = cy - total_h / 2
        for ln in lines:
            w = draw.textlength(ln, font=tf)
            draw.text(((x0 + x1) / 2 - w / 2, y), ln, font=tf, fill=title_color)
            y += title_size + 4
        y += 4
        for ln in sub_lines:
            w = draw.textlength(ln, font=sf)
            draw.text(((x0 + x1) / 2 - w / 2, y), ln, font=sf, fill=sub_color)
            y += sub_size + 3
    else:
        total_h = len(lines) * (title_size + 4)
        y = cy - total_h / 2
        for ln in lines:
            w = draw.textlength(ln, font=tf)
            draw.text(((x0 + x1) / 2 - w / 2, y), ln, font=tf, fill=title_color)
            y += title_size + 4

def arrow(draw, p1, p2, color=INK, width=3, head=10):
    draw.line([p1, p2], fill=color, width=width)
    import math
    ang = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
    for side in (0.5, -0.5):
        a = ang + math.pi - side
        x = p2[0] + head * math.cos(a)
        y = p2[1] + head * math.sin(a)
        draw.line([p2, (x, y)], fill=color, width=width)

def cylinder(draw, xy, fill=BLUE_LIGHT, outline=BLUE):
    x0, y0, x1, y1 = xy
    ell_h = (y1 - y0) * 0.22
    draw.rectangle([x0, y0 + ell_h / 2, x1, y1 - ell_h / 2], fill=fill, outline=outline, width=2)
    draw.ellipse([x0, y0, x1, y0 + ell_h], fill=fill, outline=outline, width=2)
    draw.ellipse([x0, y1 - ell_h, x1, y1], fill=fill, outline=outline, width=2)
    draw.line([x0, y0 + ell_h / 2, x0, y1 - ell_h / 2], fill=outline, width=2)
    draw.line([x1, y0 + ell_h / 2, x1, y1 - ell_h / 2], fill=outline, width=2)

def cloud(draw, xy, fill=WHITE, outline=TEAL):
    x0, y0, x1, y1 = xy
    w, h = x1 - x0, y1 - y0
    cx, cy = x0 + w / 2, y0 + h / 2
    draw.ellipse([x0 + w * 0.05, y0 + h * 0.35, x0 + w * 0.45, y1], fill=fill, outline=outline, width=2)
    draw.ellipse([x0 + w * 0.30, y0, x0 + w * 0.75, y0 + h * 0.85], fill=fill, outline=outline, width=2)
    draw.ellipse([x0 + w * 0.55, y0 + h * 0.30, x1 - w * 0.02, y1], fill=fill, outline=outline, width=2)
    draw.rectangle([x0 + w * 0.18, cy, x1 - w * 0.18, y1], fill=fill, outline=None)
    draw.ellipse([x0 + w * 0.05, y0 + h * 0.35, x0 + w * 0.45, y1], outline=outline, width=2)
    draw.ellipse([x0 + w * 0.30, y0, x0 + w * 0.75, y0 + h * 0.85], outline=outline, width=2)
    draw.ellipse([x0 + w * 0.55, y0 + h * 0.30, x1 - w * 0.02, y1], outline=outline, width=2)

def person(draw, xy, fill=INK):
    x0, y0, x1, y1 = xy
    w, h = x1 - x0, y1 - y0
    cx = x0 + w / 2
    draw.ellipse([cx - w * 0.22, y0, cx + w * 0.22, y0 + h * 0.44], fill=fill)
    draw.pieslice([x0, y0 + h * 0.35, x1, y1 + h * 0.55], 180, 360, fill=fill)

def section_label(draw, xy, text, fill=INK):
    tf = font(22, bold=True)
    draw.text(xy, text, font=tf, fill=fill)

def footer(draw, size, text, y_offset=40):
    w, h = size
    tf = font(15)
    tw = draw.textlength(text, font=tf)
    draw.text((w / 2 - tw / 2, h - y_offset), text, font=tf, fill=TEXT_SOFT)