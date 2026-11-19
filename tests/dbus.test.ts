import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Socket } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DBusError,
	DBusFormatError,
	type DBusValue,
	type Message,
	MessageTooLargeError,
	MessageType,
	Reader,
	Writer,
	authLine,
	connectBus,
	createMessageFramer,
	decodeMessage,
	encodeMessage,
	marshal,
	parseBusAddress,
	sessionBusAddress,
	splitSignature,
	unmarshal,
} from "../src/bun/dbus";
import { connectNotificationServer, signalRule } from "../src/bun/notification-server";

function bytesOf(type: string, value: DBusValue): number[] {
	const writer = new Writer();
	marshal(writer, type, value);
	return [...writer.result()];
}

function roundTrip(type: string, value: DBusValue): DBusValue {
	const writer = new Writer();
	marshal(writer, type, value);
	return unmarshal(new Reader(writer.result(), true), type);
}

const text = (value: string) => [...new TextEncoder().encode(value)];

/** A 32-bit number in either byte order. */
function u32(value: number, little: boolean): number[] {
	const bytes = [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
	return little ? bytes : bytes.reverse();
}

/**
 * The signal `/a b.c.D (u 7)` with serial 5, laid out by hand. Header fields
 * are structs, so each starts on an 8-byte boundary; the body starts on one too.
 */
function signalFixture(little: boolean): Uint8Array {
	return new Uint8Array([
		little ? 0x6c : 0x42, 4, 0, 1, ...u32(4, little), ...u32(5, little), ...u32(55, little),
		1, 1, ...text("o"), 0, ...u32(2, little), ...text("/a"), 0, 0, 0, 0, 0, 0,
		2, 1, ...text("s"), 0, ...u32(3, little), ...text("b.c"), 0, 0, 0, 0, 0,
		3, 1, ...text("s"), 0, ...u32(1, little), ...text("D"), 0, 0, 0, 0, 0, 0, 0,
		8, 1, ...text("g"), 0, 1, ...text("u"), 0, 0,
		...u32(7, little),
	]);
}

const fixtureMessage: Message = { type: MessageType.Signal, flags: 0, serial: 5, path: "/a", interface: "b.c", member: "D", signature: "u", body: [7] };

describe("D-Bus marshalling", () => {
	test("strings are a length, the bytes, and a NUL", () => {
		expect(bytesOf("s", "hi")).toEqual([2, 0, 0, 0, 0x68, 0x69, 0]);
		expect(bytesOf("g", "as")).toEqual([2, 0x61, 0x73, 0]);
	});

	test("each value aligns to its own size inside a struct", () => {
		expect(bytesOf("(yu)", [1, 2])).toEqual([1, 0, 0, 0, 2, 0, 0, 0]);
		expect(bytesOf("(yt)", [1, 2n])).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0]);
		expect(bytesOf("(yn)", [1, -2])).toEqual([1, 0, 0xfe, 0xff]);
	});

	test("an empty array of 8-byte values still pads to its first element", () => {
		expect(bytesOf("at", [])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
	});

	test("a{sv} with mixed variants lays out each entry on an 8-byte boundary", () => {
		const hints = { urgency: { signature: "y", value: 1 }, x: { signature: "s", value: "hi" } };
		expect(bytesOf("a{sv}", hints)).toEqual([
			35, 0, 0, 0, 0, 0, 0, 0,
			7, 0, 0, 0, ...text("urgency"), 0, 1, ...text("y"), 0, 1,
			1, 0, 0, 0, ...text("x"), 0, 1, ...text("s"), 0, 0, 0, 0, 2, 0, 0, 0, ...text("hi"), 0,
		]);
		expect(roundTrip("a{sv}", hints)).toEqual(hints);
	});

	test("every supported type survives a round trip", () => {
		const cases: [string, DBusValue][] = [
			["y", 255], ["b", true], ["b", false], ["n", -32768], ["q", 65535], ["i", -5], ["u", 4294967295],
			["x", -(1n << 63n)], ["t", (1n << 64n) - 1n], ["d", 1.5], ["s", "héllo"], ["o", "/org/x"], ["g", "a{sv}"],
			["v", { signature: "ai", value: [1, 2] }], ["as", ["a", "b"]], ["a{ss}", { a: "b" }], ["a{us}", { 3: "c" }],
			["(sv)", ["k", { signature: "(ii)", value: [1, 2] }]], ["aay", [[1], [2, 3]]],
		];
		for (const [type, value] of cases) expect(roundTrip(type, value)).toEqual(value);
	});

	test("values that do not fit their type are refused", () => {
		expect(() => bytesOf("y", 256)).toThrow(DBusFormatError);
		expect(() => bytesOf("u", -1)).toThrow(DBusFormatError);
		expect(() => bytesOf("s", "a\0b")).toThrow(DBusFormatError);
		expect(() => bytesOf("o", "not/a/path")).toThrow(DBusFormatError);
		expect(() => bytesOf("v", "plain")).toThrow(DBusFormatError);
		expect(() => bytesOf("(ii)", [1])).toThrow(DBusFormatError);
	});

	test("signatures split into complete types and bad ones are refused", () => {
		expect(splitSignature("susssasa{sv}i")).toEqual(["s", "u", "s", "s", "s", "as", "a{sv}", "i"]);
		for (const bad of ["a", "(", "()", "a{vs}", "a{s}", "z", "a{sss}"]) expect(() => splitSignature(bad)).toThrow(DBusFormatError);
	});

	test("bytes that are not valid D-Bus data are refused", () => {
		expect(() => unmarshal(new Reader(new Uint8Array([2, 0, 0, 0, 0x68, 0x69, 1]), true), "s")).toThrow(DBusFormatError);
		expect(() => unmarshal(new Reader(new Uint8Array([2, 0, 0, 0]), true), "b")).toThrow(DBusFormatError);
		expect(() => unmarshal(new Reader(new Uint8Array([9, 0, 0, 0, 1]), true), "ay")).toThrow(DBusFormatError);
	});
});

describe("D-Bus messages", () => {
	test("a message encodes little endian with its header fields", () => {
		expect([...encodeMessage(fixtureMessage)]).toEqual([...signalFixture(true)]);
	});

	test("a big-endian message decodes", () => {
		expect(decodeMessage(signalFixture(false))).toEqual(fixtureMessage);
	});

	test("every header field survives a round trip", () => {
		const call: Message = {
			type: MessageType.Error, flags: 1, serial: 9, path: "/p", interface: "a.b", member: "M", errorName: "a.b.Failed",
			replySerial: 3, destination: ":1.2", sender: ":1.3", signature: "sa{sv}", body: ["why", { k: { signature: "b", value: true } }],
		};
		expect(decodeMessage(encodeMessage(call))).toEqual(call);
	});

	test("a message without its required fields is refused", () => {
		const bytes = encodeMessage({ type: MessageType.MethodReturn, flags: 0, serial: 1, replySerial: 1, signature: "", body: [] });
		bytes[1] = MessageType.Signal;
		expect(() => decodeMessage(bytes)).toThrow(DBusFormatError);
	});
});

describe("message framing", () => {
	const one = encodeMessage(fixtureMessage);
	const two = encodeMessage({ ...fixtureMessage, serial: 6, body: [8] });

	test("a message split across reads comes out whole once", () => {
		const framer = createMessageFramer();
		expect(framer.push(one.subarray(0, 3))).toEqual([]);
		expect(framer.push(one.subarray(3, 20))).toEqual([]);
		expect(framer.push(one.subarray(20))).toEqual([one]);
	});

	test("two messages in one read come out separately, and a partial third waits", () => {
		const framer = createMessageFramer();
		const chunk = new Uint8Array([...one, ...two, ...one.subarray(0, 10)]);
		const frames = framer.push(chunk);
		expect(frames.map(frame => decodeMessage(frame).body)).toEqual([[7], [8]]);
		expect(framer.push(one.subarray(10)).map(frame => decodeMessage(frame).serial)).toEqual([5]);
	});

	test("a message over the size cap is refused from its header alone", () => {
		const framer = createMessageFramer(1024);
		const header = new Uint8Array([0x6c, 4, 0, 1, ...u32(2 * 1024 * 1024, true), ...u32(1, true), ...u32(0, true)]);
		expect(() => framer.push(header)).toThrow(MessageTooLargeError);
	});

	test("an unknown byte order is refused", () => {
		expect(() => createMessageFramer().push(new Uint8Array(16).fill(0x41))).toThrow(DBusFormatError);
	});
});

describe("bus addresses", () => {
	test("the first usable unix path wins", () => {
		expect(parseBusAddress("unix:path=/run/user/1000/bus")).toBe("/run/user/1000/bus");
		expect(parseBusAddress("tcp:host=localhost,port=1;unix:path=/tmp/b,guid=abc")).toBe("/tmp/b");
		expect(parseBusAddress("unix:tmpdir=/tmp;unix:path=/x")).toBe("/x");
	});

	test("escaped values are unescaped, and bad escapes skip the entry", () => {
		expect(parseBusAddress("unix:path=/tmp/a%20b%2cc")).toBe("/tmp/a b,c");
		expect(parseBusAddress("unix:path=/bad%zz;unix:path=/good")).toBe("/good");
	});

	test("an abstract socket is its name after a NUL on Linux", () => {
		expect(parseBusAddress("unix:abstract=/tmp/dbus-x,guid=1")).toBe(process.platform === "linux" ? "\0/tmp/dbus-x" : null);
	});

	test("no usable entry gives null", () => {
		expect(parseBusAddress("")).toBeNull();
		expect(parseBusAddress("tcp:host=a,port=1")).toBeNull();
		expect(parseBusAddress("unix:guid=1")).toBeNull();
	});

	test("authentication sends the uid's decimal digits in hex", () => {
		expect(authLine(1000)).toBe("\0AUTH EXTERNAL 31303030\r\n");
	});
});

const OWNER = ":1.7";

interface FakeBusOptions {
	/** The notification server is not running until the first call to its name. */
	activate?: boolean;
}

/** A pretend session bus on a Unix socket with a pretend notification server behind it. */
function fakeBus(path: string, options: FakeBusOptions = {}) {
	const authLines: string[] = [];
	const rules: string[] = [];
	const notified: DBusValue[][] = [];
	const clients: Socket<{ auth: string; open: boolean; framer: ReturnType<typeof createMessageFramer> }>[] = [];
	let serial = 1;
	let nextId = 1;
	let running = !options.activate;
	const shown = new Set<number>();

	const send = (socket: Socket<unknown>, message: Omit<Message, "serial" | "flags">) => {
		socket.write(encodeMessage({ flags: 0, serial: serial++, ...message }));
	};

	const answer = (socket: Socket<unknown>, call: Message) => {
		const reply = (sender: string, signature = "", body: DBusValue[] = []) =>
			send(socket, { type: MessageType.MethodReturn, replySerial: call.serial, destination: ":1.5", sender, signature, body });
		const fail = (errorName: string) =>
			send(socket, { type: MessageType.Error, replySerial: call.serial, destination: ":1.5", sender: "org.freedesktop.DBus", errorName, signature: "s", body: ["no"] });
		if (call.destination === "org.freedesktop.DBus") {
			if (call.member === "Hello") reply("org.freedesktop.DBus", "s", [":1.5"]);
			else if (call.member === "AddMatch") {
				rules.push(call.body[0] as string);
				reply("org.freedesktop.DBus");
			} else if (call.member === "GetNameOwner") {
				if (running) reply("org.freedesktop.DBus", "s", [OWNER]);
				else fail("org.freedesktop.DBus.Error.NameHasNoOwner");
			} else fail("org.freedesktop.DBus.Error.UnknownMethod");
			return;
		}
		running = true;
		if (call.member === "GetCapabilities") reply(OWNER, "as", [["actions", "body-markup"]]);
		else if (call.member === "Notify") {
			notified.push(call.body);
			const id = (call.body[1] as number) || nextId++;
			shown.add(id);
			reply(OWNER, "u", [id]);
		} else if (call.member === "CloseNotification") {
			if (shown.delete(call.body[0] as number)) reply(OWNER);
			else fail("org.freedesktop.DBus.Error.Failed");
		} else if (call.member === "Huge") {
			socket.write(new Uint8Array([0x6c, 2, 0, 1, ...u32(4 * 1024 * 1024, true), ...u32(serial++, true), ...u32(0, true)]));
		} else if (call.member === "Fail") fail("org.example.Error.Nope");
		// "Hang" gets no reply.
	};

	const server = Bun.listen<{ auth: string; open: boolean; framer: ReturnType<typeof createMessageFramer> }>({
		unix: path,
		socket: {
			open(socket) {
				socket.data = { auth: "", open: false, framer: createMessageFramer() };
				clients.push(socket);
			},
			data(socket, chunk) {
				let bytes: Uint8Array = chunk;
				if (!socket.data.open) {
					socket.data.auth += Buffer.from(chunk).toString("latin1");
					const first = socket.data.auth.indexOf("\r\n");
					if (first >= 0 && authLines.length < clients.length) {
						authLines.push(socket.data.auth.slice(0, first + 2));
						socket.write("OK 0123456789abcdef0123456789abcdef\r\n");
					}
					const begin = socket.data.auth.indexOf("BEGIN\r\n");
					if (begin < 0) return;
					socket.data.open = true;
					bytes = Buffer.from(socket.data.auth.slice(begin + 7), "latin1");
				}
				for (const frame of socket.data.framer.push(bytes)) answer(socket, decodeMessage(frame));
			},
		},
	});

	return {
		authLines,
		rules,
		notified,
		/** Sends a signal from the server's interface, with this sender, to every client. */
		emit(sender: string, member: string, signature: string, body: DBusValue[]) {
			for (const client of clients) {
				send(client, { type: MessageType.Signal, path: "/org/freedesktop/Notifications", interface: "org.freedesktop.Notifications", member, sender, signature, body });
			}
		},
		ownerChanged(newOwner: string) {
			for (const client of clients) {
				send(client, { type: MessageType.Signal, path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus", member: "NameOwnerChanged", sender: "org.freedesktop.DBus", signature: "sss", body: ["org.freedesktop.Notifications", OWNER, newOwner] });
			}
		},
		dropClients() {
			for (const client of clients) client.end();
		},
		stop() {
			server.stop(true);
		},
	};
}

describe("notification server over a fake bus", () => {
	let dir: string;
	let count = 0;
	const start = (options?: FakeBusOptions) => {
		const path = join(dir, `bus-${count++}`);
		return { bus: fakeBus(path, options), address: `unix:path=${path}` };
	};
	const request = { appName: "Timber", replacesId: 0, icon: "", summary: "Codex needs you", body: "a &amp; b", actions: ["default", "Show"], hints: {}, timeout: -1 };

	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), "timber-app-dbus-"));
	});

	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("it authenticates as the uid, subscribes to the three signals, and shows, replaces, and closes notifications", async () => {
		const { bus, address } = start();
		const server = await connectNotificationServer(address, { uid: 4242 });
		expect(bus.authLines).toEqual(["\0AUTH EXTERNAL 34323432\r\n"]);
		for (const member of ["ActionInvoked", "ActivationToken", "NotificationClosed"]) {
			expect(bus.rules).toContain(signalRule(member));
			expect(signalRule(member)).toContain("sender='org.freedesktop.Notifications'");
		}
		expect(await server.capabilities()).toEqual(["actions", "body-markup"]);
		const hints = { urgency: { signature: "y", value: 1 }, "desktop-entry": { signature: "s", value: "timber" } };
		const id = await server.notify({ ...request, hints });
		expect(id).toBe(1);
		expect(bus.notified[0]).toEqual(["Timber", 0, "", "Codex needs you", "a &amp; b", ["default", "Show"], hints, -1]);
		expect(await server.notify({ ...request, replacesId: id })).toBe(id);
		expect(await server.notify(request)).toBe(2);
		await server.close(id);
		await server.close(id);
		server.disconnect();
		bus.stop();
	});

	test("signals count only from the owner of the server's name", async () => {
		const { bus, address } = start();
		const server = await connectNotificationServer(address, { uid: 1 });
		const seen: unknown[] = [];
		server.onActionInvoked((id, key) => seen.push(["action", id, key]));
		server.onActivationToken((id, token) => seen.push(["token", id, token]));
		server.onClosed((id, reason) => seen.push(["closed", id, reason]));
		server.onRestart(() => seen.push(["restart"]));
		bus.emit(":1.99", "ActionInvoked", "us", [1, "default"]);
		bus.emit(OWNER, "ActivationToken", "us", [1, "tok"]);
		bus.emit(OWNER, "ActionInvoked", "us", [1, "default"]);
		bus.emit(OWNER, "NotificationClosed", "uu", [1, 2]);
		bus.emit(OWNER, "ActionInvoked", "s", ["wrong signature"]);
		await server.capabilities();
		expect(seen).toEqual([["token", 1, "tok"], ["action", 1, "default"], ["closed", 1, 2]]);
		bus.ownerChanged(":1.8");
		bus.emit(OWNER, "ActionInvoked", "us", [2, "default"]);
		bus.emit(":1.8", "ActionInvoked", "us", [3, "default"]);
		await server.capabilities();
		expect(seen.slice(3)).toEqual([["restart"], ["action", 3, "default"]]);
		server.disconnect();
		bus.stop();
	});

	test("a server that is not running yet is started by a call to its name", async () => {
		const { bus, address } = start({ activate: true });
		const server = await connectNotificationServer(address, { uid: 1 });
		const seen: number[] = [];
		server.onClosed(id => seen.push(id));
		bus.emit(OWNER, "NotificationClosed", "uu", [4, 1]);
		await server.capabilities();
		expect(seen).toEqual([4]);
		server.disconnect();
		bus.stop();
	});

	test("a call with no reply times out and the connection stays usable", async () => {
		const { bus, address } = start();
		const connection = await connectBus(address, { uid: 1 });
		expect(connection.uniqueName).toBe(":1.5");
		const call = { destination: "org.freedesktop.Notifications", path: "/org/freedesktop/Notifications", interface: "org.freedesktop.Notifications" };
		await expect(connection.call({ ...call, member: "Hang" }, 50)).rejects.toThrow("timed out");
		expect(await connection.call({ ...call, member: "GetCapabilities" })).toEqual([["actions", "body-markup"]]);
		const failure = await connection.call({ ...call, member: "Fail" }).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(DBusError);
		expect((failure as DBusError).errorName).toBe("org.example.Error.Nope");
		connection.close();
		bus.stop();
	});

	test("a dropped connection rejects waiting calls and reports the disconnect", async () => {
		const { bus, address } = start();
		const server = await connectNotificationServer(address, { uid: 1 });
		const connection = await connectBus(address, { uid: 1 });
		let disconnects = 0;
		server.onDisconnect(() => disconnects++);
		const waiting = connection.call({ destination: "org.freedesktop.Notifications", path: "/org/freedesktop/Notifications", interface: "org.freedesktop.Notifications", member: "Hang" });
		bus.dropClients();
		await expect(waiting).rejects.toThrow("closed");
		await Bun.sleep(20);
		expect(disconnects).toBe(1);
		await expect(server.notify(request)).rejects.toThrow("closed");
		bus.stop();
	});

	test("our own disconnect does not report a disconnect", async () => {
		const { bus, address } = start();
		const server = await connectNotificationServer(address, { uid: 1 });
		let disconnects = 0;
		server.onDisconnect(() => disconnects++);
		server.disconnect();
		await Bun.sleep(20);
		expect(disconnects).toBe(0);
		await expect(server.capabilities()).rejects.toThrow("closed");
		bus.stop();
	});

	test("a message over the size cap closes the connection", async () => {
		const { bus, address } = start();
		const connection = await connectBus(address, { uid: 1 });
		let closed = false;
		connection.onClose(() => {
			closed = true;
		});
		const huge = connection.call({ destination: "org.freedesktop.Notifications", path: "/org/freedesktop/Notifications", interface: "org.freedesktop.Notifications", member: "Huge" });
		await expect(huge).rejects.toThrow("closed");
		expect(closed).toBe(true);
		bus.stop();
	});

	test("connecting to a socket that is not there fails", async () => {
		await expect(connectBus(`unix:path=${join(dir, "missing")}`, { uid: 1 })).rejects.toThrow();
		await expect(connectBus("tcp:host=a,port=1", { uid: 1 })).rejects.toThrow("no usable Unix socket");
	});
});

describe("the session bus's address", () => {
	test("the one given, or the usual socket in the runtime folder", () => {
		expect(sessionBusAddress({ DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus", XDG_RUNTIME_DIR: "/other" })).toBe("unix:path=/run/user/1000/bus");
		expect(sessionBusAddress({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBe("unix:path=/run/user/1000/bus");
		expect(sessionBusAddress({ XDG_RUNTIME_DIR: "/run/a b" })).toBe("unix:path=/run/a%20b/bus");
		expect(parseBusAddress(sessionBusAddress({ XDG_RUNTIME_DIR: "/run/a b" }))).toBe("/run/a b/bus");
		expect(parseBusAddress(sessionBusAddress({ XDG_RUNTIME_DIR: "/run/é 用" }))).toBe("/run/é 用/bus");
		expect(sessionBusAddress({})).toBe("");
	});
});
