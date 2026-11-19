import type { Socket } from "bun";

/**
 * A small D-Bus client: the parts of the wire protocol that the main process
 * needs to talk to a session bus over a Unix socket. Marshalling, message
 * headers, framing, and bus addresses are pure and tested without a bus.
 * Messages go out little endian; messages in either byte order are read.
 */

/** A value for a `v` (variant) type: the variant's own signature and its value. */
export interface Variant {
	signature: string;
	value: DBusValue;
}

/**
 * A D-Bus value as this module reads and writes it. `y n q i u d` are
 * numbers, `x t` are bigints, `b` is a boolean, `s o g` are strings, `v` is a
 * `Variant`, arrays and structs are arrays, and a dict (`a{..}`) is a plain
 * object keyed by the key's string form. Dicts may also be passed in as an
 * array of key and value pairs or as a `Map`.
 */
export type DBusValue = number | bigint | boolean | string | Variant | DBusValue[] | { [key: string]: DBusValue } | Map<DBusValue, DBusValue>;

/** Bytes that do not form valid D-Bus data, or a value that does not fit its type. */
export class DBusFormatError extends Error {
	override name = "DBusFormatError";
}

/** An error reply from the bus or a peer. `name` is the D-Bus error name. */
export class DBusError extends Error {
	override name = "DBusError";
	constructor(readonly errorName: string, message: string) {
		super(message);
	}
}

/** A call that got no reply in time. The peer may still act on it later. */
export class DBusTimeoutError extends Error {
	override name = "DBusTimeoutError";
}

/** The largest message this client reads or writes. It needs only small ones. */
export const MAX_MESSAGE_SIZE = 1024 * 1024;

/** The four message types of the protocol. */
export const MessageType = { MethodCall: 1, MethodReturn: 2, Error: 3, Signal: 4 } as const;

/** Flag on a method call that asks for no reply. */
export const NO_REPLY_EXPECTED = 0x1;

/** One D-Bus message. `type` stays a number, as a bus may send types this client does not know. */
export interface Message {
	type: number;
	flags: number;
	serial: number;
	path?: string;
	interface?: string;
	member?: string;
	errorName?: string;
	replySerial?: number;
	destination?: string;
	sender?: string;
	/** The body's signature, empty for no body. */
	signature: string;
	body: DBusValue[];
}

const BASIC_TYPES = "ybnqiuxtdsog";
const MAX_DEPTH = 64;
const MAX_ARRAY_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** The index just past the single complete type that starts at `start`. */
function typeEnd(signature: string, start: number, depth: number): number {
	if (depth > MAX_DEPTH) throw new DBusFormatError("signature nests too deep");
	const code = signature[start];
	if (code === undefined) throw new DBusFormatError("signature ends early");
	if (BASIC_TYPES.includes(code) || code === "v") return start + 1;
	if (code === "a") {
		if (signature[start + 1] === "{") {
			const key = signature[start + 2];
			if (key === undefined || !BASIC_TYPES.includes(key)) throw new DBusFormatError("dict key must be a basic type");
			const valueEnd = typeEnd(signature, start + 3, depth + 1);
			if (signature[valueEnd] !== "}") throw new DBusFormatError("dict entry must have one key and one value");
			return valueEnd + 1;
		}
		return typeEnd(signature, start + 1, depth + 1);
	}
	if (code === "(") {
		let index = start + 1;
		if (signature[index] === ")") throw new DBusFormatError("struct must not be empty");
		while (signature[index] !== ")") {
			if (index >= signature.length) throw new DBusFormatError("struct is not closed");
			index = typeEnd(signature, index, depth + 1);
		}
		return index + 1;
	}
	throw new DBusFormatError("unknown type code in signature");
}

/** A signature split into its single complete types; throws for an invalid signature. */
export function splitSignature(signature: string): string[] {
	if (signature.length > 255) throw new DBusFormatError("signature is too long");
	const types: string[] = [];
	let index = 0;
	while (index < signature.length) {
		const end = typeEnd(signature, index, 0);
		types.push(signature.slice(index, end));
		index = end;
	}
	return types;
}

/** The alignment in bytes of a value of this type. */
function alignmentOf(type: string): number {
	switch (type[0]) {
		case "y": case "g": case "v": return 1;
		case "n": case "q": return 2;
		case "b": case "i": case "u": case "s": case "o": case "a": return 4;
		default: return 8;
	}
}

/** The types of a struct or dict entry's fields, from its signature with the brackets. */
function fieldTypes(type: string): string[] {
	return splitSignature(type.slice(1, -1));
}

/** Bytes written little endian, aligned from the start of the buffer. */
export class Writer {
	private bytes = new Uint8Array(256);
	private view = new DataView(this.bytes.buffer);
	length = 0;

	private ensure(more: number): void {
		if (this.length + more <= this.bytes.length) return;
		let size = this.bytes.length * 2;
		while (size < this.length + more) size *= 2;
		const grown = new Uint8Array(size);
		grown.set(this.bytes.subarray(0, this.length));
		this.bytes = grown;
		this.view = new DataView(grown.buffer);
	}

	align(alignment: number): void {
		const padding = (alignment - (this.length % alignment)) % alignment;
		this.ensure(padding);
		this.bytes.fill(0, this.length, this.length + padding);
		this.length += padding;
	}

	u8(value: number): void {
		this.ensure(1);
		this.view.setUint8(this.length, value);
		this.length += 1;
	}

	number(type: "n" | "q" | "i" | "u" | "d", value: number): void {
		const size = type === "n" || type === "q" ? 2 : type === "d" ? 8 : 4;
		this.align(size);
		this.ensure(size);
		if (type === "n") this.view.setInt16(this.length, value, true);
		else if (type === "q") this.view.setUint16(this.length, value, true);
		else if (type === "i") this.view.setInt32(this.length, value, true);
		else if (type === "u") this.view.setUint32(this.length, value, true);
		else this.view.setFloat64(this.length, value, true);
		this.length += size;
	}

	big(type: "x" | "t", value: bigint): void {
		this.align(8);
		this.ensure(8);
		if (type === "x") this.view.setBigInt64(this.length, value, true);
		else this.view.setBigUint64(this.length, value, true);
		this.length += 8;
	}

	raw(bytes: Uint8Array): void {
		this.ensure(bytes.length);
		this.bytes.set(bytes, this.length);
		this.length += bytes.length;
	}

	patchU32(at: number, value: number): void {
		this.view.setUint32(at, value, true);
	}

	result(): Uint8Array {
		return this.bytes.slice(0, this.length);
	}
}

const INTEGER_RANGES = {
	y: [0, 0xff],
	n: [-0x8000, 0x7fff],
	q: [0, 0xffff],
	i: [-0x80000000, 0x7fffffff],
	u: [0, 0xffffffff],
} as const;

const BIG_RANGES = {
	x: [-(1n << 63n), (1n << 63n) - 1n],
	t: [0n, (1n << 64n) - 1n],
} as const;

const OBJECT_PATH = /^\/$|^(\/[A-Za-z0-9_]+)+$/;

function checkString(type: string, value: unknown): string {
	if (typeof value !== "string") throw new DBusFormatError(`expected a string for type ${type}`);
	if (value.includes("\0")) throw new DBusFormatError("strings must not contain NUL");
	if (type === "o" && !OBJECT_PATH.test(value)) throw new DBusFormatError("invalid object path");
	if (type === "g") splitSignature(value);
	return value;
}

function isVariant(value: unknown): value is Variant {
	return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Map)
		&& typeof (value as Variant).signature === "string" && "value" in value;
}

/** The key and value pairs of a dict given as an object, a Map, or an array of pairs. */
function dictEntries(value: unknown): [DBusValue, DBusValue][] {
	if (value instanceof Map) return [...value.entries()];
	if (Array.isArray(value)) {
		return value.map(entry => {
			if (!Array.isArray(entry) || entry.length !== 2) throw new DBusFormatError("expected dict entries as key and value pairs");
			return [entry[0] as DBusValue, entry[1] as DBusValue];
		});
	}
	if (typeof value === "object" && value !== null) return Object.entries(value as Record<string, DBusValue>);
	throw new DBusFormatError("expected an object for a dict");
}

/** Converts a dict key from its string form when the key type is a number. */
function dictKey(type: string, key: DBusValue): DBusValue {
	if (typeof key !== "string") return key;
	if (type === "x" || type === "t") return BigInt(key);
	if ("ynqiud".includes(type)) return Number(key);
	if (type === "b") return key === "true";
	return key;
}

/** Writes one value of a single complete type. */
export function marshal(writer: Writer, type: string, value: unknown, depth = 0): void {
	if (depth > MAX_DEPTH) throw new DBusFormatError("value nests too deep");
	const code = type[0];
	switch (code) {
		case "y": case "n": case "q": case "i": case "u": {
			const [low, high] = INTEGER_RANGES[code];
			if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high) throw new DBusFormatError(`expected an integer in range for type ${code}`);
			if (code === "y") writer.u8(value);
			else writer.number(code, value);
			return;
		}
		case "x": case "t": {
			const big = typeof value === "bigint" ? value : typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : null;
			const [low, high] = BIG_RANGES[code];
			if (big === null || big < low || big > high) throw new DBusFormatError(`expected an integer in range for type ${code}`);
			writer.big(code, big);
			return;
		}
		case "d":
			if (typeof value !== "number") throw new DBusFormatError("expected a number for type d");
			writer.number("d", value);
			return;
		case "b":
			if (typeof value !== "boolean") throw new DBusFormatError("expected a boolean for type b");
			writer.number("u", value ? 1 : 0);
			return;
		case "s": case "o": {
			const bytes = encoder.encode(checkString(code, value));
			writer.number("u", bytes.length);
			writer.raw(bytes);
			writer.u8(0);
			return;
		}
		case "g": {
			const bytes = encoder.encode(checkString(code, value));
			writer.u8(bytes.length);
			writer.raw(bytes);
			writer.u8(0);
			return;
		}
		case "v": {
			if (!isVariant(value)) throw new DBusFormatError("expected { signature, value } for type v");
			if (splitSignature(value.signature).length !== 1) throw new DBusFormatError("a variant holds exactly one complete type");
			marshal(writer, "g", value.signature, depth);
			marshal(writer, value.signature, value.value, depth + 1);
			return;
		}
		case "a": {
			const elementType = type.slice(1);
			writer.align(4);
			const lengthAt = writer.length;
			writer.number("u", 0);
			writer.align(alignmentOf(elementType));
			const start = writer.length;
			if (elementType[0] === "{") {
				const [keyType, valueType] = fieldTypes(elementType) as [string, string];
				for (const [key, entry] of dictEntries(value)) {
					writer.align(8);
					marshal(writer, keyType, dictKey(keyType, key), depth + 1);
					marshal(writer, valueType, entry, depth + 1);
				}
			} else {
				if (!Array.isArray(value)) throw new DBusFormatError("expected an array for type a");
				for (const element of value) marshal(writer, elementType, element, depth + 1);
			}
			const size = writer.length - start;
			if (size > MAX_ARRAY_BYTES) throw new DBusFormatError("array is too long");
			writer.patchU32(lengthAt, size);
			return;
		}
		case "(": {
			const types = fieldTypes(type);
			if (!Array.isArray(value) || value.length !== types.length) throw new DBusFormatError("expected an array with one value per struct field");
			writer.align(8);
			types.forEach((fieldType, index) => marshal(writer, fieldType, value[index], depth + 1));
			return;
		}
		default:
			throw new DBusFormatError("unknown type code");
	}
}

/** Reads values from bytes, aligned from the start of `bytes`. */
export class Reader {
	private readonly view: DataView;
	offset: number;

	constructor(readonly bytes: Uint8Array, readonly littleEndian: boolean, offset = 0) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.offset = offset;
	}

	need(count: number): void {
		if (this.offset + count > this.bytes.length) throw new DBusFormatError("data ends early");
	}

	align(alignment: number): void {
		const padding = (alignment - (this.offset % alignment)) % alignment;
		this.need(padding);
		for (let index = 0; index < padding; index++) {
			if (this.bytes[this.offset + index] !== 0) throw new DBusFormatError("padding must be zero");
		}
		this.offset += padding;
	}

	u8(): number {
		this.need(1);
		return this.view.getUint8(this.offset++);
	}

	u32(): number {
		this.align(4);
		this.need(4);
		const value = this.view.getUint32(this.offset, this.littleEndian);
		this.offset += 4;
		return value;
	}

	text(length: number): string {
		this.need(length + 1);
		if (this.bytes[this.offset + length] !== 0) throw new DBusFormatError("string is not NUL terminated");
		let value: string;
		try {
			value = decoder.decode(this.bytes.subarray(this.offset, this.offset + length));
		} catch {
			throw new DBusFormatError("string is not valid UTF-8");
		}
		if (value.includes("\0")) throw new DBusFormatError("strings must not contain NUL");
		this.offset += length + 1;
		return value;
	}
}

/** Reads one value of a single complete type. */
export function unmarshal(reader: Reader, type: string, depth = 0): DBusValue {
	if (depth > MAX_DEPTH) throw new DBusFormatError("value nests too deep");
	const code = type[0];
	const little = reader.littleEndian;
	const view = new DataView(reader.bytes.buffer, reader.bytes.byteOffset, reader.bytes.byteLength);
	const fixed = <T>(size: number, read: (at: number) => T): T => {
		reader.align(size);
		reader.need(size);
		const value = read(reader.offset);
		reader.offset += size;
		return value;
	};
	switch (code) {
		case "y": return reader.u8();
		case "n": return fixed(2, at => view.getInt16(at, little));
		case "q": return fixed(2, at => view.getUint16(at, little));
		case "i": return fixed(4, at => view.getInt32(at, little));
		case "u": return reader.u32();
		case "x": return fixed(8, at => view.getBigInt64(at, little));
		case "t": return fixed(8, at => view.getBigUint64(at, little));
		case "d": return fixed(8, at => view.getFloat64(at, little));
		case "b": {
			const value = reader.u32();
			if (value > 1) throw new DBusFormatError("boolean must be 0 or 1");
			return value === 1;
		}
		case "s": case "o": {
			const value = reader.text(reader.u32());
			if (code === "o" && !OBJECT_PATH.test(value)) throw new DBusFormatError("invalid object path");
			return value;
		}
		case "g": {
			const value = reader.text(reader.u8());
			splitSignature(value);
			return value;
		}
		case "v": {
			const signature = reader.text(reader.u8());
			if (splitSignature(signature).length !== 1) throw new DBusFormatError("a variant holds exactly one complete type");
			return { signature, value: unmarshal(reader, signature, depth + 1) };
		}
		case "a": {
			const elementType = type.slice(1);
			const size = reader.u32();
			if (size > MAX_ARRAY_BYTES) throw new DBusFormatError("array is too long");
			reader.align(alignmentOf(elementType));
			reader.need(size);
			const end = reader.offset + size;
			if (elementType[0] === "{") {
				const [keyType, valueType] = fieldTypes(elementType) as [string, string];
				const entries: [string, DBusValue][] = [];
				while (reader.offset < end) {
					reader.align(8);
					const key = unmarshal(reader, keyType, depth + 1);
					entries.push([String(key), unmarshal(reader, valueType, depth + 1)]);
				}
				if (reader.offset !== end) throw new DBusFormatError("array length does not match its elements");
				return Object.fromEntries(entries);
			}
			const elements: DBusValue[] = [];
			while (reader.offset < end) elements.push(unmarshal(reader, elementType, depth + 1));
			if (reader.offset !== end) throw new DBusFormatError("array length does not match its elements");
			return elements;
		}
		case "(": {
			reader.align(8);
			return fieldTypes(type).map(fieldType => unmarshal(reader, fieldType, depth + 1));
		}
		default:
			throw new DBusFormatError("unknown type code");
	}
}

/** Header field codes, with the type each one's variant must hold. */
const HEADER_FIELDS = [
	[1, "path", "o"],
	[2, "interface", "s"],
	[3, "member", "s"],
	[4, "errorName", "s"],
	[5, "replySerial", "u"],
	[6, "destination", "s"],
	[7, "sender", "s"],
	[8, "signature", "g"],
] as const;

/** One message as bytes, little endian. The message's `serial` must be set and nonzero. */
export function encodeMessage(message: Message): Uint8Array {
	if (!Number.isInteger(message.serial) || message.serial < 1 || message.serial > 0xffffffff) throw new DBusFormatError("serial must be a nonzero 32-bit number");
	const types = splitSignature(message.signature);
	if (types.length !== message.body.length) throw new DBusFormatError("body does not match its signature");
	const body = new Writer();
	types.forEach((type, index) => marshal(body, type, message.body[index]));
	const fields: [number, Variant][] = [];
	for (const [code, key, type] of HEADER_FIELDS) {
		const value = message[key];
		if (value === undefined || (key === "signature" && value === "")) continue;
		fields.push([code, { signature: type, value }]);
	}
	const header = new Writer();
	header.u8("l".charCodeAt(0));
	header.u8(message.type);
	header.u8(message.flags);
	header.u8(1);
	header.number("u", body.length);
	header.number("u", message.serial);
	marshal(header, "a(yv)", fields);
	header.align(8);
	header.raw(body.result());
	if (header.length > MAX_MESSAGE_SIZE) throw new DBusFormatError("message is too large");
	return header.result();
}

/** The total size of the message at the start of `bytes`, once its first 16 bytes are there. */
function messageSize(bytes: Uint8Array): number {
	const endian = bytes[0];
	if (endian !== 0x6c && endian !== 0x42) throw new DBusFormatError("unknown byte order");
	const view = new DataView(bytes.buffer, bytes.byteOffset, 16);
	const little = endian === 0x6c;
	const bodyLength = view.getUint32(4, little);
	const fieldsLength = view.getUint32(12, little);
	return Math.ceil((16 + fieldsLength) / 8) * 8 + bodyLength;
}

/** One whole message from its bytes, in either byte order. */
export function decodeMessage(bytes: Uint8Array): Message {
	if (bytes.length < 16) throw new DBusFormatError("message ends early");
	if (messageSize(bytes) !== bytes.length) throw new DBusFormatError("message length does not match its header");
	const reader = new Reader(bytes, bytes[0] === 0x6c, 1);
	const type = reader.u8();
	const flags = reader.u8();
	if (reader.u8() !== 1) throw new DBusFormatError("unknown protocol version");
	const bodyLength = reader.u32();
	const serial = reader.u32();
	if (serial === 0) throw new DBusFormatError("serial must not be zero");
	const message: Message = { type, flags, serial, signature: "", body: [] };
	for (const field of unmarshal(reader, "a(yv)") as [number, Variant][]) {
		const [code, variant] = field;
		const known = HEADER_FIELDS.find(([fieldCode]) => fieldCode === code);
		if (!known) continue;
		const [, key, fieldType] = known;
		if (variant.signature !== fieldType) throw new DBusFormatError("header field has the wrong type");
		(message as unknown as Record<string, DBusValue>)[key] = variant.value;
	}
	reader.align(8);
	if (reader.offset + bodyLength !== bytes.length) throw new DBusFormatError("body length does not match the message");
	for (const bodyType of splitSignature(message.signature)) message.body.push(unmarshal(reader, bodyType));
	if (reader.offset !== bytes.length) throw new DBusFormatError("body is longer than its signature");
	const missing =
		type === MessageType.MethodCall ? message.path === undefined || message.member === undefined
		: type === MessageType.MethodReturn ? message.replySerial === undefined
		: type === MessageType.Error ? message.replySerial === undefined || message.errorName === undefined
		: type === MessageType.Signal ? message.path === undefined || message.interface === undefined || message.member === undefined
		: false;
	if (missing) throw new DBusFormatError("message lacks a required header field");
	return message;
}

/** Thrown by a framer when a message is larger than it accepts. */
export class MessageTooLargeError extends DBusFormatError {
	override name = "MessageTooLargeError";
}

/** Turns a stream of socket reads into whole messages. */
export interface MessageFramer {
	/** The whole messages completed by this chunk, in order; throws for one over the size cap or a bad header. */
	push(chunk: Uint8Array): Uint8Array[];
}

/** A framer that reassembles messages split across reads and splits several in one read. */
export function createMessageFramer(maxSize = MAX_MESSAGE_SIZE): MessageFramer {
	let buffered: Uint8Array = new Uint8Array(0);
	return {
		push(chunk) {
			if (buffered.length === 0) buffered = chunk.slice();
			else {
				const joined = new Uint8Array(buffered.length + chunk.length);
				joined.set(buffered);
				joined.set(chunk, buffered.length);
				buffered = joined;
			}
			const messages: Uint8Array[] = [];
			while (buffered.length >= 16) {
				const size = messageSize(buffered);
				if (size > maxSize) throw new MessageTooLargeError("message is larger than the size cap");
				if (buffered.length < size) break;
				messages.push(buffered.slice(0, size));
				buffered = buffered.subarray(size);
			}
			return messages;
		},
	};
}

/**
 * The session bus's address: `DBUS_SESSION_BUS_ADDRESS`, or the usual socket
 * in `XDG_RUNTIME_DIR` when that is not set, as sd-bus does. Empty when
 * neither is known.
 */
export function sessionBusAddress(environment: Record<string, string | undefined>): string {
	const given = environment.DBUS_SESSION_BUS_ADDRESS;
	if (given) return given;
	const runtime = environment.XDG_RUNTIME_DIR;
	if (!runtime) return "";
	// Every byte outside the address's plain characters is escaped as %xx, from its UTF-8 form.
	const escaped = Array.from(new TextEncoder().encode(runtime), byte => {
		const character = String.fromCharCode(byte);
		return byte < 0x80 && /[A-Za-z0-9_\-\/.]/.test(character) ? character : `%${byte.toString(16).padStart(2, "0")}`;
	}).join("");
	return `unix:path=${escaped}/bus`;
}

/**
 * The socket path of the first usable entry of a D-Bus address, such as
 * `unix:path=/run/user/1000/bus`, or null when no entry is usable. Entries are
 * separated by `;` and values may contain `%xx` escapes. An abstract socket
 * (`unix:abstract=name`) comes back as its name after a NUL byte, as Bun
 * expects for a Linux abstract socket. Only Unix sockets are used; listening
 * forms such as `unix:tmpdir=` are skipped.
 */
export function parseBusAddress(address: string): string | null {
	for (const entry of address.split(";")) {
		const colon = entry.indexOf(":");
		if (colon < 0 || entry.slice(0, colon) !== "unix") continue;
		const values = new Map<string, string>();
		let valid = true;
		for (const pair of entry.slice(colon + 1).split(",")) {
			const equals = pair.indexOf("=");
			if (equals < 1) {
				valid = false;
				break;
			}
			try {
				values.set(pair.slice(0, equals), decodeURIComponent(pair.slice(equals + 1)));
			} catch {
				valid = false;
				break;
			}
		}
		if (!valid) continue;
		const path = values.get("path");
		if (path) return path;
		const abstract = values.get("abstract");
		if (abstract && process.platform === "linux") return `\0${abstract}`;
	}
	return null;
}

/** A method call to send. */
export interface CallRequest {
	destination: string;
	path: string;
	interface: string;
	member: string;
	signature?: string;
	body?: DBusValue[];
}

/** An open connection to a message bus. */
export interface BusConnection {
	/** The unique name the bus gave this connection, such as `:1.42`. */
	readonly uniqueName: string;
	/** Calls a method and resolves with the reply's body. Rejects with `DBusError` for an error reply, and on a timeout or when the connection closes. */
	call(request: CallRequest, timeoutMs?: number): Promise<DBusValue[]>;
	/** Asks the bus to send this connection the signals that match a rule. */
	addMatch(rule: string): Promise<void>;
	/** Calls the handler for each signal that arrives; returns a function that stops it. */
	onSignal(handler: (message: Message) => void): () => void;
	/** Calls the handler once when the bus or the socket ends the connection, not after `close()`. */
	onClose(handler: () => void): () => void;
	close(): void;
}

export interface ConnectOptions {
	/** The user id sent in the EXTERNAL authentication. Tests pass their own. */
	uid?: number;
	/** How long connecting, authenticating, and saying hello may take. */
	timeoutMs?: number;
	/** The largest message accepted from the bus; a larger one closes the connection. */
	maxMessageSize?: number;
}

/** The line that starts EXTERNAL authentication as this user: a NUL byte, then the uid's decimal digits in hex. */
export function authLine(uid: number): string {
	return `\0AUTH EXTERNAL ${Buffer.from(String(uid)).toString("hex")}\r\n`;
}

const DEFAULT_TIMEOUT = 5000;
const MAX_AUTH_LINE = 16 * 1024;

/**
 * Connects to the bus at this address: a Unix socket, EXTERNAL
 * authentication as the current user, then `Hello`. Signal handlers that
 * throw are ignored, so one handler cannot break the connection.
 */
export function connectBus(address: string, options: ConnectOptions = {}): Promise<BusConnection> {
	const path = parseBusAddress(address);
	if (path === null) return Promise.reject(new Error("The bus address has no usable Unix socket"));
	const uid = options.uid ?? process.getuid?.();
	if (uid === undefined) return Promise.reject(new Error("No user id to authenticate with"));
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
	const framer = createMessageFramer(options.maxMessageSize ?? MAX_MESSAGE_SIZE);

	let socket: Socket<undefined> | undefined;
	let state: "auth" | "open" | "closed" = "auth";
	let closedByUs = false;
	let authText = "";
	let nextSerial = 1;
	let uniqueName = "";
	const unsent: Uint8Array[] = [];
	const pending = new Map<number, { resolve: (body: DBusValue[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
	const signalHandlers = new Set<(message: Message) => void>();
	const closeHandlers = new Set<() => void>();

	let settleConnect: { resolve: (connection: BusConnection) => void; reject: (error: Error) => void } | undefined;
	const connected = new Promise<BusConnection>((resolve, reject) => {
		settleConnect = { resolve, reject };
	});
	const connectTimer = setTimeout(() => teardown(new Error("Connecting to the bus timed out")), timeoutMs);

	function flush(): void {
		while (socket && unsent.length > 0) {
			const bytes = unsent[0]!;
			const written = Math.max(0, socket.write(bytes));
			if (written < bytes.length) {
				unsent[0] = bytes.subarray(written);
				return;
			}
			unsent.shift();
		}
	}

	function send(bytes: Uint8Array): void {
		if (state === "closed") return;
		unsent.push(bytes);
		if (unsent.length === 1) flush();
	}

	function takeSerial(): number {
		const serial = nextSerial;
		nextSerial = nextSerial >= 0xffffffff ? 1 : nextSerial + 1;
		return serial;
	}

	function teardown(error: Error): void {
		if (state === "closed") return;
		state = "closed";
		clearTimeout(connectTimer);
		socket?.end();
		for (const [serial, entry] of pending) {
			clearTimeout(entry.timer);
			pending.delete(serial);
			entry.reject(new Error("The D-Bus connection closed"));
		}
		if (settleConnect) {
			settleConnect.reject(error);
			settleConnect = undefined;
			return;
		}
		if (!closedByUs) for (const handler of closeHandlers) handler();
		closeHandlers.clear();
		signalHandlers.clear();
	}

	function call(request: CallRequest, callTimeout = DEFAULT_TIMEOUT): Promise<DBusValue[]> {
		if (state === "closed") return Promise.reject(new Error("The D-Bus connection closed"));
		const serial = takeSerial();
		let bytes: Uint8Array;
		try {
			bytes = encodeMessage({
				type: MessageType.MethodCall,
				flags: 0,
				serial,
				destination: request.destination,
				path: request.path,
				interface: request.interface,
				member: request.member,
				signature: request.signature ?? "",
				body: request.body ?? [],
			});
		} catch (error) {
			return Promise.reject(error);
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(serial);
				reject(new DBusTimeoutError("The D-Bus call timed out"));
			}, callTimeout);
			pending.set(serial, { resolve, reject, timer });
			send(bytes);
		});
	}

	function reply(to: Message, type: number, fields: Partial<Message>): void {
		if (to.flags & NO_REPLY_EXPECTED || to.sender === undefined) return;
		const message: Message = { type, flags: 0, serial: takeSerial(), replySerial: to.serial, destination: to.sender, signature: "", body: [], ...fields };
		send(encodeMessage(message));
	}

	function receive(message: Message): void {
		if (message.type === MessageType.MethodReturn || message.type === MessageType.Error) {
			const entry = pending.get(message.replySerial!);
			if (!entry) return;
			pending.delete(message.replySerial!);
			clearTimeout(entry.timer);
			if (message.type === MessageType.MethodReturn) entry.resolve(message.body);
			else {
				const text = typeof message.body[0] === "string" ? message.body[0] : message.errorName!;
				entry.reject(new DBusError(message.errorName!, text));
			}
		} else if (message.type === MessageType.Signal) {
			for (const handler of [...signalHandlers]) {
				try {
					handler(message);
				} catch {
					// A failing handler must not break the connection or the other handlers.
				}
			}
		} else if (message.type === MessageType.MethodCall) {
			if (message.interface === "org.freedesktop.DBus.Peer" && message.member === "Ping") reply(message, MessageType.MethodReturn, {});
			else reply(message, MessageType.Error, { errorName: "org.freedesktop.DBus.Error.UnknownMethod", signature: "s", body: ["This connection has no methods"] });
		}
	}

	function receiveBytes(chunk: Uint8Array): void {
		let frames: Uint8Array[];
		try {
			frames = framer.push(chunk);
		} catch (error) {
			teardown(error as Error);
			return;
		}
		for (const frame of frames) {
			if (state === "closed") return;
			let message: Message;
			try {
				message = decodeMessage(frame);
			} catch (error) {
				teardown(error as Error);
				return;
			}
			receive(message);
		}
	}

	function receiveAuth(chunk: Uint8Array): void {
		authText += Buffer.from(chunk).toString("latin1");
		const end = authText.indexOf("\r\n");
		if (end < 0) {
			if (authText.length > MAX_AUTH_LINE) teardown(new Error("The bus sent an overlong authentication line"));
			return;
		}
		const line = authText.slice(0, end);
		const rest = Buffer.from(authText.slice(end + 2), "latin1");
		authText = "";
		if (!line.startsWith("OK ")) {
			teardown(new Error("The bus refused authentication"));
			return;
		}
		state = "open";
		send(Buffer.from("BEGIN\r\n"));
		call({ destination: "org.freedesktop.DBus", path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus", member: "Hello" }, timeoutMs).then(
			body => {
				if (typeof body[0] !== "string") {
					teardown(new Error("The bus gave no unique name"));
					return;
				}
				uniqueName = body[0];
				clearTimeout(connectTimer);
				const settle = settleConnect;
				settleConnect = undefined;
				settle?.resolve(connection);
			},
			error => teardown(error as Error),
		);
		if (rest.length > 0) receiveBytes(rest);
	}

	const connection: BusConnection = {
		get uniqueName() {
			return uniqueName;
		},
		call,
		async addMatch(rule) {
			await call({ destination: "org.freedesktop.DBus", path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus", member: "AddMatch", signature: "s", body: [rule] });
		},
		onSignal(handler) {
			signalHandlers.add(handler);
			return () => signalHandlers.delete(handler);
		},
		onClose(handler) {
			closeHandlers.add(handler);
			return () => closeHandlers.delete(handler);
		},
		close() {
			closedByUs = true;
			teardown(new Error("The D-Bus connection was closed"));
		},
	};

	Bun.connect({
		unix: path,
		socket: {
			open(opened) {
				socket = opened;
				if (state === "closed") {
					opened.end();
					return;
				}
				send(Buffer.from(authLine(uid)));
			},
			data(_socket, chunk) {
				if (state === "auth") receiveAuth(chunk);
				else if (state === "open") receiveBytes(chunk);
			},
			drain() {
				flush();
			},
			end() {
				teardown(new Error("The bus ended the connection"));
			},
			close() {
				teardown(new Error("The bus connection closed"));
			},
			error(_socket, error) {
				teardown(error);
			},
			connectError(_socket, error) {
				teardown(error);
			},
		},
	}).catch((error: unknown) => teardown(error instanceof Error ? error : new Error("Could not connect to the bus")));

	return connected;
}
