/*
 * Colour helpers. Colours are written as 0xRRGGBB the way the labs write them,
 * and unpacked to the 0..1 triples the shaders want.
 *
 * There is no colour-space conversion here on purpose: the renderers hand
 * these values to a non-sRGB swapchain and only modulate them by lighting, so
 * a colour picked in a design tool arrives on screen as it was picked.
 */

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

export function rgbFromHex(hex: number): Rgb {
	return {
		r: ((hex >> 16) & 0xff) / 255,
		g: ((hex >> 8) & 0xff) / 255,
		b: (hex & 0xff) / 255,
	};
}

export function hexFromRgb(c: Rgb): number {
	const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
	return (to255(c.r) << 16) | (to255(c.g) << 8) | to255(c.b);
}

/**
 * Nudges a colour by a small random amount, so a field of tiles cut from one
 * colour does not read as a flat sheet. `spread` is the lightness range.
 */
export function jitter(c: Rgb, random: () => number, spread = 0.05): Rgb {
	const d = (random() - 0.5) * spread;
	return {
		r: Math.max(0, Math.min(1, c.r + d)),
		g: Math.max(0, Math.min(1, c.g + d)),
		b: Math.max(0, Math.min(1, c.b + d)),
	};
}
