import { deflateSync } from "node:zlib";

/** A PNG of this size, of one gray, made the way PNG says: real enough for any reader. */
export function png(width: number, height: number): Uint8Array {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (bytes: Uint8Array) => {
		let c = 0xffffffff;
		for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, data: Uint8Array) => {
		const body = new Uint8Array([...new TextEncoder().encode(type), ...data]);
		const out = new Uint8Array(12 + data.length);
		const view = new DataView(out.buffer);
		view.setUint32(0, data.length);
		out.set(body, 4);
		view.setUint32(8 + data.length, crc(body));
		return out;
	};
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header.set([8, 0, 0, 0, 0], 8);
	const rows = new Uint8Array((width + 1) * height).fill(128);
	for (let row = 0; row < height; row++) rows[row * (width + 1)] = 0;
	const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", new Uint8Array(deflateSync(rows))), chunk("IEND", new Uint8Array())];
	return new Uint8Array(parts.flatMap(part => [...part]));
}
