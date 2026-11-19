import { type BusConnection, type ConnectOptions, DBusError, type DBusValue, type Message, type Variant, connectBus } from "./dbus";

const NAME = "org.freedesktop.Notifications";
const PATH = "/org/freedesktop/Notifications";
const BUS = { destination: "org.freedesktop.DBus", path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus" } as const;
const SERVER = { destination: NAME, path: PATH, interface: NAME } as const;

/** One notification to show, as the `Notify` method takes it. */
export interface NotificationRequest {
	appName: string;
	/** The id of an earlier notification this one replaces, or 0 for a new one. */
	replacesId: number;
	icon: string;
	summary: string;
	/** May be read as markup by servers with the `body-markup` capability. */
	body: string;
	/** Action keys and their labels, alternating. The key `default` is a click on the notification itself. */
	actions: string[];
	hints: Record<string, Variant>;
	/** Milliseconds, or -1 for the server's choice and 0 for never. */
	timeout: number;
}

/** A client for the desktop's notification server (Desktop Notifications Specification 1.2). */
export interface NotificationServer {
	capabilities(): Promise<string[]>;
	/** Shows a notification and resolves with its id. */
	notify(request: NotificationRequest): Promise<number>;
	/** Withdraws a notification. Error replies, such as for one already gone, are ignored. */
	close(id: number): Promise<void>;
	onActionInvoked(handler: (id: number, actionKey: string) => void): void;
	/** The activation token to focus a window with, sent just before `ActionInvoked`. */
	onActivationToken(handler: (id: number, token: string) => void): void;
	onClosed(handler: (id: number, reason: number) => void): void;
	/**
	 * The notification server was replaced by another, such as after it
	 * restarted. Ids from before mean nothing to the new one.
	 */
	onRestart(handler: () => void): void;
	/** The bus connection ended other than by `disconnect()`. */
	onDisconnect(handler: () => void): void;
	disconnect(): void;
}

/** The match rule for one of the server's signals. */
export function signalRule(member: string): string {
	return `type='signal',sender='${NAME}',interface='${NAME}',path='${PATH}',member='${member}'`;
}

const OWNER_RULE = `type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='${NAME}'`;

/** The unique name that owns the notification server's name, starting the server through the bus when it is not running. */
async function findOwner(bus: BusConnection): Promise<string> {
	const getOwner = async () => (await bus.call({ ...BUS, member: "GetNameOwner", signature: "s", body: [NAME] }))[0];
	try {
		const owner = await getOwner();
		if (typeof owner === "string") return owner;
	} catch (error) {
		if (!(error instanceof DBusError)) throw error;
	}
	// A call to the well-known name lets the bus start a server that is not running yet.
	await bus.call({ ...SERVER, member: "GetCapabilities" });
	const owner = await getOwner();
	if (typeof owner !== "string") throw new Error("The notification server has no owner");
	return owner;
}

/**
 * Connects to the session bus at this address and to its notification
 * server. Signals count only when they come from the unique name that owns
 * `org.freedesktop.Notifications`; the owner is looked up on connecting and
 * followed through `NameOwnerChanged`.
 */
export async function connectNotificationServer(address: string, options: ConnectOptions = {}): Promise<NotificationServer> {
	const bus = await connectBus(address, options);
	const actionHandlers: ((id: number, actionKey: string) => void)[] = [];
	const tokenHandlers: ((id: number, token: string) => void)[] = [];
	const closedHandlers: ((id: number, reason: number) => void)[] = [];
	const restartHandlers: (() => void)[] = [];
	let owner: string | null = null;

	bus.onSignal((message: Message) => {
		if (message.sender === "org.freedesktop.DBus" && message.member === "NameOwnerChanged" && message.signature === "sss" && message.body[0] === NAME) {
			const next = (message.body[2] as string) || null;
			const replaced = owner !== null && next !== owner;
			owner = next;
			if (replaced) for (const handler of restartHandlers) handler();
			return;
		}
		if (owner === null || message.sender !== owner || message.path !== PATH || message.interface !== NAME) return;
		const [id, value] = message.body as [DBusValue, DBusValue];
		if (message.member === "ActionInvoked" && message.signature === "us") for (const handler of actionHandlers) handler(id as number, value as string);
		else if (message.member === "ActivationToken" && message.signature === "us") for (const handler of tokenHandlers) handler(id as number, value as string);
		else if (message.member === "NotificationClosed" && message.signature === "uu") for (const handler of closedHandlers) handler(id as number, value as number);
	});

	try {
		await bus.addMatch(OWNER_RULE);
		for (const member of ["ActionInvoked", "ActivationToken", "NotificationClosed"]) await bus.addMatch(signalRule(member));
		owner = await findOwner(bus);
	} catch (error) {
		bus.close();
		throw error;
	}

	return {
		async capabilities() {
			const [list] = await bus.call({ ...SERVER, member: "GetCapabilities" });
			return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
		},
		async notify(request) {
			const [id] = await bus.call({
				...SERVER,
				member: "Notify",
				signature: "susssasa{sv}i",
				body: [request.appName, request.replacesId, request.icon, request.summary, request.body, request.actions, request.hints, request.timeout],
			});
			if (typeof id !== "number") throw new Error("The notification server gave no id");
			return id;
		},
		async close(id) {
			try {
				await bus.call({ ...SERVER, member: "CloseNotification", signature: "u", body: [id] });
			} catch (error) {
				if (!(error instanceof DBusError)) throw error;
			}
		},
		onActionInvoked(handler) {
			actionHandlers.push(handler);
		},
		onActivationToken(handler) {
			tokenHandlers.push(handler);
		},
		onClosed(handler) {
			closedHandlers.push(handler);
		},
		onRestart(handler) {
			restartHandlers.push(handler);
		},
		onDisconnect(handler) {
			bus.onClose(handler);
		},
		disconnect() {
			bus.close();
		},
	};
}
