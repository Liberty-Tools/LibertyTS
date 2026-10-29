export declare const SERVER_OPTIONS: readonly ["Players", "Staff", "JoinLogs", "Queue", "KillLogs", "CommandLogs", "ModCalls", "EmergencyCalls", "Vehicles"];
export type ServerOption = typeof SERVER_OPTIONS[number];
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export interface HTTPError {
    error: "api-error" | "rate-limited";
    message: string;
    status: number;
    apiResponse: Json;
}
export interface CommandSummary {
    successes: number;
    failures: number;
    failureReasons: unknown[];
    results: Array<{
        command: string;
        response: Json;
    }>;
}
export interface LibertyTSOptions {
    serverKey: string;
    globalApiKey?: string;
    apiUrl?: string;
    libertyApiUrl?: string;
    webhookId?: string;
    webhookToken?: string;
    webhookUrl?: string;
    webhookIngestUrl?: string;
    pollSubscriptionId?: string;
    pollToken?: string;
    webhookPublicKey?: string;
    maxRateLimitRetries?: number;
}
export interface WebhookVerificationInput {
    timestamp?: string;
    signature?: string;
    rawBody?: string | Uint8Array | ArrayBuffer;
    publicKey?: string;
}
export interface CommandEvent {
    id: string;
    type: "CustomCommand";
    command: string;
    argument: string;
    args: string[];
    userId: string;
    serverId: string;
    username: string;
    raw: Record<string, unknown>;
}
export interface CommandContext {
    event: CommandEvent;
    command: string;
    argument: string;
    args: string[];
    userId: string;
    serverId: string;
    reply(message: string): Promise<Json>;
    announce(message: string): Promise<Json>;
}
export interface CommandResult {
    status: string;
    eventId?: string;
    command?: string;
    reason?: string;
    value?: unknown;
    error?: unknown;
}
export declare const ERLC_WEBHOOK_PUBLIC_KEY = "MCowBQYDK2VwAyEAjSICb9pp0kHizGQtdG8ySWsDChfGqi+gyFCttigBNOA=";
export declare class LibertyTS {
    private readonly options;
    private readonly apiUrl;
    private readonly relayUrl;
    private readonly fetcher;
    private readonly webhookId?;
    private readonly pollSubscriptionId?;
    private readonly pollToken?;
    private readonly ingestUrl?;
    private readonly publicKey;
    readonly commands: LibertyCommandRouter;
    readonly webhook: {
        verify: (input?: WebhookVerificationInput) => Promise<boolean>;
        erlcUrl: () => string | null;
        status: (signal?: AbortSignal) => Promise<Json>;
        listEvents: (options?: {
            cursor?: string;
            limit?: number;
            signal?: AbortSignal;
        }) => Promise<Json>;
        events: (options?: {
            cursor?: string;
            limit?: number;
            signal?: AbortSignal;
        }) => Promise<Json>;
        acknowledge: (eventIds: string[], signal?: AbortSignal) => Promise<Json>;
    };
    constructor(options: LibertyTSOptions);
    private get hasRelay();
    getPrivateServerAPI(fields?: ServerOption[]): Promise<Json>;
    sendPrivateServerCommand(commands: string[]): Promise<CommandSummary>;
    private request;
    verifyWebhook(input?: WebhookVerificationInput): Promise<boolean>;
    private listEvents;
    private acknowledge;
    private relayRequest;
}
export declare class LibertyCommandRouter {
    private handlers;
    private seen;
    private cooldowns;
    private controller?;
    private loopPromise?;
    private listeners;
    private poll?;
    private acknowledge?;
    private sendCommands;
    private getServer;
    private verify;
    constructor(opts: {
        poll?: LibertyCommandRouter["poll"];
        acknowledge?: LibertyCommandRouter["acknowledge"];
        sendCommands: (commands: string[]) => Promise<Json>;
        getServer: (fields: ServerOption[]) => Promise<Json>;
        verify: (input?: WebhookVerificationInput) => Promise<boolean>;
    });
    get running(): boolean;
    on(event: "handled" | "unhandled" | "cooldown" | "commandError" | "pollError", listener: (value: any) => void): this;
    off(event: string, listener: (value: any) => void): this;
    private emit;
    command(name: string, handler: (ctx: CommandContext) => unknown | Promise<unknown>, options?: {
        cooldown?: number;
    }): this;
    remove(name: string): boolean;
    handle(raw: unknown): Promise<CommandResult>;
    handleWebhook(input: WebhookVerificationInput): Promise<CommandResult>;
    start(options?: {
        pollInterval?: number;
        signal?: AbortSignal;
    }): Promise<this>;
    stop(): Promise<void>;
    private sanitize;
    private loop;
}
