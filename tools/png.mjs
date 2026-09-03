/*
 * tools/png.mjs — just enough PNG to store and read back a reference picture.
 *
 * Writing is the easy half: one uncompressed filter byte a row and let zlib do
 * the work, which for a picture of flat-shaded hexagons is small enough that
 * anything cleverer would be effort spent on nothing.
 *
 * Reading has to undo the filters, because the encoder that wrote the file may
 * not have been this one — a reference regenerated with a different tool, or
 * hand-edited — and a reader that only understood its own output would be no
 * reader at all.
 *
 * A dependency would do this too. This is forty lines and the project has none
 * outside the browser, which is worth keeping.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buffer) {
	let c = 0xffffffff;
	for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const check = Buffer.alloc(4);
	check.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, check]);
}

/** Write RGBA bytes, top row first, as an 8-bit truecolour-with-alpha PNG. */
export function writePng(file, width, height, rgba) {
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0; // filter: none
		Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // colour type: RGBA

	writeFileSync(
		file,
		Buffer.concat([
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
			chunk('IHDR', ihdr),
			chunk('IDAT', deflateSync(raw, { level: 9 })),
			chunk('IEND', Buffer.alloc(0)),
		]),
	);
}

/** Read one back. Truecolour with or without alpha, 8 bits a channel. */
export function readPng(file) {
	const bytes = readFileSync(file);
	let offset = 8;
	let width = 0;
	let height = 0;
	let colourType = 6;
	const parts = [];

	while (offset < bytes.length) {
		const length = bytes.readUInt32BE(offset);
		const type = bytes.toString('ascii', offset + 4, offset + 8);
		if (type === 'IHDR') {
			width = bytes.readUInt32BE(offset + 8);
			height = bytes.readUInt32BE(offset + 12);
			if (bytes[offset + 16] !== 8) throw new Error(`${file}: only 8 bits a channel`);
			colourType = bytes[offset + 17];
		} else if (type === 'IDAT') {
			parts.push(bytes.subarray(offset + 8, offset + 8 + length));
		} else if (type === 'IEND') {
			break;
		}
		offset += 12 + length;
	}

	if (colourType !== 6 && colourType !== 2) throw new Error(`${file}: only truecolour`);
	const channels = colourType === 6 ? 4 : 3;
	const stride = width * channels;
	const raw = inflateSync(Buffer.concat(parts));
	const out = Buffer.alloc(stride * height);

	// Undo the per-row filters. Each predicts a byte from the one to its left,
	// the one above, and the one diagonally up-left, and stores the difference.
	let read = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[read++];
		const line = raw.subarray(read, read + stride);
		read += stride;
		for (let x = 0; x < stride; x++) {
			const left = x >= channels ? out[y * stride + x - channels] : 0;
			const up = y > 0 ? out[(y - 1) * stride + x] : 0;
			const upLeft = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
			let value = line[x];
			if (filter === 1) value += left;
			else if (filter === 2) value += up;
			else if (filter === 3) value += (left + up) >> 1;
			else if (filter === 4) {
				const p = left + up - upLeft;
				const pa = Math.abs(p - left);
				const pb = Math.abs(p - up);
				const pc = Math.abs(p - upLeft);
				value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
			}
			out[y * stride + x] = value & 0xff;
		}
	}

	if (channels === 4) return { width, height, pixels: out };

	// Widen RGB to RGBA so callers only ever deal with one shape.
	const rgba = Buffer.alloc(width * height * 4, 255);
	for (let i = 0, j = 0; i < out.length; i += 3, j += 4) {
		rgba[j] = out[i];
		rgba[j + 1] = out[i + 1];
		rgba[j + 2] = out[i + 2];
	}
	return { width, height, pixels: rgba };
}
