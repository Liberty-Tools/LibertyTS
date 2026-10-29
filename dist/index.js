export const SERVER_OPTIONS = [
    "Players", "Staff", "JoinLogs", "Queue", "KillLogs", "CommandLogs",
    "ModCalls", "EmergencyCalls", "Vehicles"
];
const DEFAULT_RELAY_URL = "https://api.libertytools.dev/";
export const ERLC_WEBHOOK_PUBLIC_KEY = "MCowBQYDK2VwAyEAjSICb9pp0kHizGQtdG8ySWsDChfGqi+gyFCttigBNOA=";
const validServerOptions = new Set(SERVER_OPTIONS);
function normalizeBase(value) {
    const url = new URL(value);
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    return url;
}
function extractWebhookId(value) {
    if (!value?.trim())
        return "";
    const clean = value.trim().split(/[?#]/, 1)[0].replace(/\/+$/, "");
    const parts = clean.split("/").filter(Boolean);
    if (parts.length > 1 && parts.at(-1)?.toLowerCase() === "events")
        return parts.at(-2);
    return parts.at(-1) ?? "";
}
function commandName(value) {
    const name = value.trim().replace(/^;/, "").toLowerCase();
    return name && !/\s/.test(name) ? name : "";
}
function parseArgs(input) {
    const args = [];
    let current = "";
    let quote = "";
    let escaped = false;
    for (const c of input) {
        if (escaped) {
            current += c;
            escaped = false;
            continue;
        }
        if (c === "\\") {
            escaped = true;
            continue;
        }
        if (quote) {
            if (c === quote)
                quote = "";
            else
                current += c;
            continue;
        }
        if (c === "\"" || c === "'") {
            quote = c;
            continue;
        }
        if (/\s/.test(c)) {
            if (current)
                args.push(current);
            current = "";
            continue;
        }
        current += c;
    }
    if (escaped)
        current += "\\";
    if (current)
        args.push(current);
    return args;
}
function normalizeCommandEvent(input) {
    if (!input || typeof input !== "object")
        return null;
    const data = input.data && typeof input.data === "object" ? input.data : {};
    const type = String(input.event ?? input.type ?? data.event ?? data.type ?? "");
    if (type.toLowerCase() !== "customcommand")
        return null;
    const command = commandName(String(input.command ?? data.command ?? ""));
    if (!command)
        return null;
    const argument = String(input.argument ?? data.argument ?? "");
    const userId = String(input.userId ?? data.userId ?? data.userID ?? "");
    const serverId = String(input.serverId ?? input.server ?? data.serverId ?? data.server ?? "");
    const player = input.player ?? input.Player ?? data.player ?? data.Player;
    const username = String(input.username ?? input.playerName ?? data.username ?? data.playerName ?? (typeof player === "string" ? player.split(":")[0] : ""));
    const raw = input;
    return { id: String(input.id ?? input._id ?? JSON.stringify(input)), type: "CustomCommand", command, argument, args: parseArgs(argument), userId, serverId, username, raw };
}
export class LibertyTS {
    options;
    apiUrl;
    relayUrl;
    fetcher;
    webhookId;
    pollSubscriptionId;
    pollToken;
    ingestUrl;
    publicKey;
    commands;
    webhook;
    constructor(options) {
        this.options = options;
        if (!options.serverKey?.trim())
            throw new Error("serverKey is required");
        if (!Number.isInteger(options.maxRateLimitRetries ?? 3) || (options.maxRateLimitRetries ?? 3) < 0) {
            throw new Error("maxRateLimitRetries must be a non-negative integer");
        }
        this.apiUrl = new URL(options.apiUrl ?? "https://api.erlc.gg/v2/");
        if (!this.apiUrl.pathname.endsWith("/"))
            this.apiUrl.pathname += "/";
        this.fetcher = globalThis.fetch;
        this.relayUrl = normalizeBase(options.pollSubscriptionId
            ? (options.libertyApiUrl ?? DEFAULT_RELAY_URL)
            : (options.webhookUrl ?? options.libertyApiUrl ?? DEFAULT_RELAY_URL));
        if (options.webhookId && options.webhookToken && extractWebhookId(options.webhookId) !== extractWebhookId(options.webhookToken))
            throw new Error("webhookId and webhookToken must identify the same webhook");
        this.webhookId = extractWebhookId(options.webhookId ?? options.webhookToken) || undefined;
        this.pollSubscriptionId = options.pollSubscriptionId;
        this.pollToken = options.pollToken;
        this.ingestUrl = options.webhookIngestUrl ? new URL(options.webhookIngestUrl).toString() : undefined;
        this.publicKey = options.webhookPublicKey ?? ERLC_WEBHOOK_PUBLIC_KEY;
        if (Boolean(this.pollSubscriptionId) !== Boolean(this.pollToken))
            throw new Error("pollSubscriptionId and pollToken must be provided together");
        if (options.webhookUrl && !this.webhookId)
            throw new Error("webhookId is required when webhookUrl is configured");
        this.webhook = {
            verify: input => this.verifyWebhook(input),
            erlcUrl: () => this.ingestUrl ?? (this.webhookId ? new URL(`webhook/${encodeURIComponent(this.webhookId)}`, normalizeBase(options.webhookUrl ?? DEFAULT_RELAY_URL)).toString() : null),
            status: signal => this.hasRelay ? this.relayRequest(new URL("health", this.relayUrl), "GET", undefined, signal) : Promise.resolve({ error: "webhook_disabled", message: "Webhook relay is not configured" }),
            listEvents: opts => this.listEvents(opts), events: opts => this.listEvents(opts),
            acknowledge: (ids, signal) => this.acknowledge(ids, signal)
        };
        this.commands = new LibertyCommandRouter({
            poll: this.pollSubscriptionId ? (opts) => this.webhook.events(opts) : undefined,
            acknowledge: this.pollSubscriptionId ? (ids, signal) => this.webhook.acknowledge(ids, signal) : undefined,
            sendCommands: async (commands) => await this.sendPrivateServerCommand(commands),
            getServer: (fields) => this.getPrivateServerAPI(fields),
            verify: (input) => this.verifyWebhook(input)
        });
    }
    get hasRelay() { return Boolean(this.webhookId || this.pollSubscriptionId); }
    async getPrivateServerAPI(fields = []) {
        const url = new URL("server", this.apiUrl);
        for (const field of new Set(fields))
            url.searchParams.set(field, "true");
        return this.request(url);
    }
    async sendPrivateServerCommand(commands) {
        if (!Array.isArray(commands) || commands.length === 0)
            throw new Error("commands must contain at least one item");
        const results = [];
        let successes = 0;
        const failureReasons = [];
        for (const value of commands) {
            const command = value.trim();
            if (!command) {
                failureReasons.push({ command: value, error: "Command must be a non-empty string" });
                continue;
            }
            const response = await this.request(new URL("server/command", this.apiUrl), "POST", { command });
            results.push({ command, response });
            if (typeof response === "object" && response !== null && "error" in response)
                failureReasons.push({ command, response });
            else
                successes++;
        }
        return { successes, failures: failureReasons.length, failureReasons, results };
    }
    async request(url, method = "GET", body) {
        const retries = this.options.maxRateLimitRetries ?? 3;
        for (let attempt = 0;; attempt++) {
            let response;
            try {
                response = await this.fetcher(url, {
                    method,
                    headers: {
                        "server-key": this.options.serverKey,
                        ...(this.options.globalApiKey ? { Authorization: this.options.globalApiKey } : {}),
                        ...(body === undefined ? {} : { "content-type": "application/json" })
                    },
                    ...(body === undefined ? {} : { body: JSON.stringify(body) })
                });
            }
            catch (error) {
                return { error: "network-error", message: String(error) };
            }
            let data = null;
            try {
                data = await response.json();
            }
            catch { /* empty response */ }
            if (response.status === 429 && attempt < retries) {
                const retryAfter = Number(response.headers.get("retry-after"));
                const delay = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : 1;
                await new Promise(resolve => setTimeout(resolve, Math.max(0, delay * 1000)));
                continue;
            }
            if (!response.ok)
                return {
                    error: response.status === 429 ? "rate-limited" : "api-error",
                    status: response.status,
                    message: `ER:LC API returned HTTP ${response.status}`,
                    apiResponse: data
                };
            return data;
        }
    }
    async verifyWebhook(input = {}) {
        const { timestamp, signature, rawBody, publicKey = this.publicKey } = input;
        if (!timestamp || !/^\d+$/.test(timestamp) || !signature || !/^(?:[0-9a-f]{2})+$/i.test(signature) || rawBody === undefined)
            return false;
        const time = Number(timestamp);
        const ms = time > 10_000_000_000 ? time : time * 1000;
        if (!Number.isFinite(ms) || Math.abs(Date.now() - ms) > 300_000)
            return false;
        try {
            if (!globalThis.crypto?.subtle)
                return false;
            const keyDer = Uint8Array.from(atob(publicKey), c => c.charCodeAt(0));
            const sig = Uint8Array.from(signature.match(/.{2}/g), x => parseInt(x, 16));
            const body = typeof rawBody === "string" ? new TextEncoder().encode(rawBody) : rawBody instanceof ArrayBuffer ? new Uint8Array(rawBody) : rawBody;
            const ts = new TextEncoder().encode(timestamp);
            const message = new Uint8Array(ts.length + body.length);
            message.set(ts);
            message.set(body, ts.length);
            const key = await globalThis.crypto.subtle.importKey("spki", keyDer, { name: "Ed25519" }, false, ["verify"]);
            return await globalThis.crypto.subtle.verify("Ed25519", key, sig, message);
        }
        catch {
            return false;
        }
    }
    async listEvents(options = {}) {
        if (!this.webhookId && !this.pollSubscriptionId)
            return { error: "webhook_disabled", message: "Webhook relay is not configured" };
        if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100))
            throw new RangeError("limit must be from 1 to 100");
        const path = this.pollSubscriptionId ? `v1/poll/subscriptions/${encodeURIComponent(this.pollSubscriptionId)}/events` : `webhook/${encodeURIComponent(this.webhookId)}/events`;
        const url = new URL(path, this.relayUrl);
        if (this.pollSubscriptionId && options.cursor)
            url.searchParams.set("cursor", options.cursor);
        if (this.pollSubscriptionId && options.limit)
            url.searchParams.set("limit", String(options.limit));
        return this.relayRequest(url, "GET", undefined, options.signal, this.pollToken ? { Authorization: `Bearer ${this.pollToken}` } : undefined);
    }
    async acknowledge(eventIds, signal) {
        if (!this.pollSubscriptionId || !this.pollToken)
            return { error: "webhook_disabled", message: "v2 Poll mode is not configured" };
        return this.relayRequest(new URL(`v1/poll/subscriptions/${encodeURIComponent(this.pollSubscriptionId)}/events/acknowledge`, this.relayUrl), "POST", { eventIds }, signal, { Authorization: `Bearer ${this.pollToken}` });
    }
    async relayRequest(url, method, body, signal, extraHeaders) {
        try {
            const response = await this.fetcher(url, { method, signal, headers: { ...extraHeaders, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            let data = null;
            try {
                data = await response.json();
            }
            catch { }
            if (!response.ok)
                return { error: response.status === 429 ? "rate-limited" : "api-error", status: response.status, message: `Webhook relay returned HTTP ${response.status}`, apiResponse: data };
            return data;
        }
        catch (error) {
            return { error: "network-error", message: String(error) };
        }
    }
}
export class LibertyCommandRouter {
    handlers = new Map();
    seen = new Set();
    cooldowns = new Map();
    controller;
    loopPromise;
    listeners = new Map();
    poll;
    acknowledge;
    sendCommands;
    getServer;
    verify;
    constructor(opts) { this.poll = opts.poll; this.acknowledge = opts.acknowledge; this.sendCommands = opts.sendCommands; this.getServer = opts.getServer; this.verify = opts.verify; }
    get running() { return !!this.controller; }
    on(event, listener) { const items = this.listeners.get(event) ?? new Set(); items.add(listener); this.listeners.set(event, items); return this; }
    off(event, listener) { this.listeners.get(event)?.delete(listener); return this; }
    emit(event, value) { for (const listener of this.listeners.get(event) ?? []) {
        try {
            listener(value);
        }
        catch { /* listener errors do not stop routing */ }
    } }
    command(name, handler, options = {}) { const key = commandName(name); if (!key || !Number.isFinite(options.cooldown ?? 0) || (options.cooldown ?? 0) < 0)
        throw new Error("invalid command registration"); this.handlers.set(key, { handler, cooldown: options.cooldown ?? 0 }); return this; }
    remove(name) { return this.handlers.delete(commandName(name)); }
    async handle(raw) {
        const event = normalizeCommandEvent(raw);
        if (!event)
            return { status: "ignored", reason: "unsupported_event" };
        if (this.seen.has(event.id))
            return { status: "duplicate", eventId: event.id, command: event.command };
        this.seen.add(event.id);
        if (this.seen.size > 1000)
            this.seen.delete(this.seen.values().next().value);
        const reg = this.handlers.get(event.command);
        if (!reg) {
            const result = { status: "unhandled", eventId: event.id, command: event.command };
            this.emit("unhandled", result);
            return result;
        }
        const key = `${event.command}:${event.userId || "unknown"}`;
        const now = Date.now();
        const until = this.cooldowns.get(key) ?? 0;
        if (until > now) {
            const result = { status: "cooldown", eventId: event.id, command: event.command, remaining: until - now };
            this.emit("cooldown", result);
            return result;
        }
        if (reg.cooldown)
            this.cooldowns.set(key, now + reg.cooldown);
        const context = { event, command: event.command, argument: event.argument, args: event.args, userId: event.userId, serverId: event.serverId,
            reply: async (message) => { const safe = this.sanitize(message); const server = await this.getServer(["Players"]); const players = server?.Players; if (!Array.isArray(players))
                return { error: "player_not_found" }; const p = players.find((x) => String(x.Id ?? x.id ?? x.UserId ?? x.userId) === event.userId); const username = String(p?.Username ?? p?.username ?? p?.Name ?? p?.name ?? ""); if (!/^[A-Za-z0-9_]+$/.test(username))
                return { error: "player_not_found" }; return this.sendCommands([`:pm ${username} ${safe}`]); },
            announce: message => this.sendCommands([`:h ${this.sanitize(message)}`]) };
        try {
            const value = await reg.handler(context);
            const result = { status: "handled", eventId: event.id, command: event.command, value };
            this.emit("handled", result);
            return result;
        }
        catch (error) {
            this.seen.delete(event.id);
            this.cooldowns.delete(key);
            const result = { status: "failed", eventId: event.id, command: event.command, error };
            this.emit("commandError", result);
            return result;
        }
    }
    async handleWebhook(input) { if (!await this.verify(input))
        return { status: "rejected", reason: "invalid_signature" }; try {
        const body = typeof input.rawBody === "string" ? input.rawBody : input.rawBody instanceof ArrayBuffer ? new Uint8Array(input.rawBody) : input.rawBody;
        return this.handle(JSON.parse(typeof body === "string" ? body : new TextDecoder().decode(body)));
    }
    catch {
        return { status: "rejected", reason: "invalid_json" };
    } }
    async start(options = {}) { if (!this.poll)
        throw new Error("Poll transport is not configured"); if (this.controller)
        return this; const interval = options.pollInterval ?? 2000; if (interval < 100)
        throw new Error("pollInterval must be at least 100ms"); this.controller = new AbortController(); options.signal?.addEventListener("abort", () => this.controller?.abort(), { once: true }); this.loopPromise = this.loop(interval, this.controller.signal); return this; }
    async stop() { this.controller?.abort(); await this.loopPromise; this.controller = undefined; this.loopPromise = undefined; }
    sanitize(value) { const text = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim(); if (!text || text.length > 200)
        throw new Error("message must be 1-200 characters"); return text; }
    async loop(interval, signal) { let cursor; while (!signal.aborted) {
        let delay = interval;
        try {
            const response = await this.poll({ cursor, signal });
            if (response?.error) {
                this.emit("pollError", { error: response });
                if (response.error === "rate-limited" && Number.isFinite(response.retryAfter))
                    delay = Math.max(delay, response.retryAfter * 1000);
            }
            else if (response && Array.isArray(response.events)) {
                const ids = [];
                for (const event of response.events) {
                    const result = await this.handle(event);
                    if (result.status !== "failed" && typeof event.id === "string")
                        ids.push(event.id);
                }
                if (ids.length && this.acknowledge) {
                    const ack = await this.acknowledge(ids, signal);
                    if (ack?.error)
                        this.emit("pollError", { error: ack });
                }
                cursor = response.hasMore ? response.nextCursor : undefined;
            }
            else
                this.emit("pollError", { error: new Error("Poll response did not include an events array") });
        }
        catch (error) {
            if (!signal.aborted)
                this.emit("pollError", { error });
        }
        await new Promise(resolve => { const timer = setTimeout(resolve, delay); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); });
    } }
}
