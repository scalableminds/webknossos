import { HttpResponse } from "msw";
import { sleep } from "libs/utils";

const PARAMS = {
  chunkNumber: "resumableChunkNumber",
  chunkSize: "resumableChunkSize",
  currentChunkSize: "resumableCurrentChunkSize",
  totalSize: "resumableTotalSize",
  identifier: "resumableIdentifier",
  totalChunks: "resumableTotalChunks",
  fileName: "resumableFilename",
  relativePath: "resumableRelativePath",
  type: "resumableType",
};

type ChunkMeta = {
  chunkNumber: number;
  chunkSize: number;
  currentChunkSize: number;
  totalSize: number;
  totalChunks: number;
  identifier: string;
  fileName: string;
  relativePath: string;
  fileType: string;
};

type FailConfig = {
  status: number;
  body?: string;
};

type FailAfterConfig = FailConfig & {
  count: number;
};

type FileState = {
  identifier: string;
  totalSize: number;
  totalChunks: number;
  fileName: string;
  relativePath: string;
  fileType: string;
  receivedChunks: Map<number, Uint8Array>;
};

export type UploadLogEntry = {
  method: string;
  url: string;
  token: string | null;
  chunkNumber: number;
  identifier: string;
  bytes: number;
};

export class ResumableBackendMock {
  private files = new Map<string, FileState>();
  private invariantViolations: string[] = [];
  private failUploadOnRequest = new Map<number, FailConfig>();
  private failUploadsAfterCount: FailAfterConfig | null = null;
  private testResponseOverride:
    | ((meta: ChunkMeta, request: Request) => HttpResponse | null)
    | null = null;
  private testChunkExistsPredicate: ((meta: ChunkMeta) => boolean) | null = null;
  private responseDelayMs = 0;
  private tokenParamName = "token";
  private requiredToken: string | null = null;
  private rotateTokenAfterUploads: { after: number; token: string } | null = null;

  private totalRequestCount = 0;
  private uploadRequestCount = 0;
  private testRequestCount = 0;
  private successfulUploadCount = 0;
  private inflightUploads = 0;
  private maxInflightUploads = 0;

  uploadLog: UploadLogEntry[] = [];
  requestLog: Array<{ method: string; url: string }> = [];

  reset(): void {
    this.files.clear();
    this.invariantViolations = [];
    this.failUploadOnRequest.clear();
    this.failUploadsAfterCount = null;
    this.testResponseOverride = null;
    this.testChunkExistsPredicate = null;
    this.responseDelayMs = 0;
    this.tokenParamName = "token";
    this.requiredToken = null;
    this.rotateTokenAfterUploads = null;
    this.totalRequestCount = 0;
    this.uploadRequestCount = 0;
    this.testRequestCount = 0;
    this.successfulUploadCount = 0;
    this.inflightUploads = 0;
    this.maxInflightUploads = 0;
    this.uploadLog = [];
    this.requestLog = [];
  }

  setResponseDelay(ms: number): void {
    this.responseDelayMs = ms;
  }

  setTokenParamName(name: string): void {
    this.tokenParamName = name;
  }

  setRequiredToken(token: string | null): void {
    this.requiredToken = token;
  }

  rotateTokenAfterUploadCount(after: number, token: string): void {
    this.rotateTokenAfterUploads = { after, token };
  }

  failUploadOnNthRequest(requestNumber: number, status = 503, body = "Transient error"): void {
    this.failUploadOnRequest.set(requestNumber, { status, body });
  }

  failUploadsAfterSuccessfulCount(count: number, status = 409, body = "Upload rejected"): void {
    this.failUploadsAfterCount = { count, status, body };
    this.successfulUploadCount = 0;
  }

  setTestResponseOverride(
    resolver: (meta: ChunkMeta, request: Request) => HttpResponse | null,
  ): void {
    this.testResponseOverride = resolver;
  }

  setTestChunkExistsPredicate(predicate: (meta: ChunkMeta) => boolean): void {
    this.testChunkExistsPredicate = predicate;
  }

  getInvariantViolations(): string[] {
    return [...this.invariantViolations];
  }

  getMaxInflightUploads(): number {
    return this.maxInflightUploads;
  }

  getInflightUploads(): number {
    return this.inflightUploads;
  }

  getUploadRequestCount(): number {
    return this.uploadRequestCount;
  }

  getTestRequestCount(): number {
    return this.testRequestCount;
  }

  getSuccessfulUploadCount(): number {
    return this.successfulUploadCount;
  }

  getUploadTokens(): Array<string | null> {
    return this.uploadLog.map((entry) => entry.token);
  }

  getUploadedChunkNumbers(identifier: string): number[] {
    const state = this.files.get(identifier);
    if (!state) return [];
    return Array.from(state.receivedChunks.keys()).sort((a, b) => a - b);
  }

  getProgress(identifier: string): number {
    const state = this.files.get(identifier);
    if (!state || state.totalSize === 0) return 0;
    let total = 0;
    for (const chunk of state.receivedChunks.values()) {
      total += chunk.byteLength;
    }
    return Math.min(1, total / state.totalSize);
  }

  getFinalUploadData(identifier: string): Uint8Array {
    const state = this.files.get(identifier);
    if (!state) return new Uint8Array();
    const orderedChunks = Array.from(state.receivedChunks.entries()).sort((a, b) => a[0] - b[0]);
    const result = new Uint8Array(state.totalSize);
    let offset = 0;
    for (const [_chunkNumber, bytes] of orderedChunks) {
      result.set(bytes, offset);
      offset += bytes.byteLength;
    }
    return result;
  }

  async waitForUploadCount(count: number, timeoutMs = 1000): Promise<void> {
    await this.waitForCondition(() => this.uploadRequestCount >= count, timeoutMs);
  }

  async waitForSuccessfulUploads(count: number, timeoutMs = 1000): Promise<void> {
    await this.waitForCondition(() => this.successfulUploadCount >= count, timeoutMs);
  }

  async waitForInflightUploads(count: number, timeoutMs = 1000): Promise<void> {
    await this.waitForCondition(() => this.inflightUploads >= count, timeoutMs);
  }

  async waitForIdle(timeoutMs = 1000): Promise<void> {
    await this.waitForCondition(() => this.inflightUploads === 0, timeoutMs);
  }

  async handle(request: Request): Promise<HttpResponse> {
    this.totalRequestCount++;
    this.requestLog.push({ method: request.method, url: request.url });

    const url = new URL(request.url);
    const params = url.searchParams;
    const token = params.get(this.tokenParamName);

    if (request.method === "GET") {
      this.testRequestCount++;
      const meta = this.extractChunkMeta(params);
      if (!meta) {
        return HttpResponse.text("Missing parameters", { status: 400 });
      }

      if (this.testResponseOverride) {
        const overrideResponse = this.testResponseOverride(meta, request);
        if (overrideResponse) return overrideResponse;
      }

      const state = this.files.get(meta.identifier);
      const existsFromState = state?.receivedChunks.has(meta.chunkNumber) ?? false;
      const exists = this.testChunkExistsPredicate
        ? this.testChunkExistsPredicate(meta)
        : existsFromState;
      if (exists) {
        return HttpResponse.text("Found", { status: 200 });
      }
      return HttpResponse.text("", { status: 204 });
    }

    if (request.method !== "POST" && request.method !== "PUT" && request.method !== "PATCH") {
      return HttpResponse.text("Method not allowed", { status: 405 });
    }

    if (this.rotateTokenAfterUploads && this.uploadRequestCount === this.rotateTokenAfterUploads.after) {
      this.requiredToken = this.rotateTokenAfterUploads.token;
      this.rotateTokenAfterUploads = null;
    }

    if (this.requiredToken && token !== this.requiredToken) {
      return HttpResponse.text("Invalid token", { status: 401 });
    }

    this.uploadRequestCount++;
    this.inflightUploads++;
    this.maxInflightUploads = Math.max(this.maxInflightUploads, this.inflightUploads);

    try {
      const meta = this.extractChunkMeta(params);
      if (!meta) {
        return HttpResponse.text("Missing parameters", { status: 400 });
      }

      const failure = this.failUploadOnRequest.get(this.uploadRequestCount);
      if (failure) {
        return HttpResponse.text(failure.body ?? "Error", { status: failure.status });
      }

      if (this.failUploadsAfterCount && this.successfulUploadCount >= this.failUploadsAfterCount.count) {
        return HttpResponse.text(
          this.failUploadsAfterCount.body ?? "Upload rejected",
          { status: this.failUploadsAfterCount.status },
        );
      }

      const bytes = await this.extractChunkBytes(request);
      if (!bytes) {
        return HttpResponse.text("Missing chunk data", { status: 400 });
      }

      const validationError = this.validateChunk(meta, bytes);
      if (validationError) {
        this.invariantViolations.push(validationError);
        return HttpResponse.text(validationError, { status: 400 });
      }

      const fileState = this.ensureFileState(meta);
      if (fileState.receivedChunks.has(meta.chunkNumber)) {
        const message = `Duplicate chunk ${meta.chunkNumber} for ${meta.identifier}`;
        this.invariantViolations.push(message);
        return HttpResponse.text(message, { status: 409 });
      }

      fileState.receivedChunks.set(meta.chunkNumber, bytes);

      if (this.responseDelayMs > 0) {
        await sleep(this.responseDelayMs);
      }

      this.successfulUploadCount++;
      this.uploadLog.push({
        method: request.method,
        url: request.url,
        token,
        chunkNumber: meta.chunkNumber,
        identifier: meta.identifier,
        bytes: bytes.byteLength,
      });

      return HttpResponse.text("OK", { status: 200 });
    } finally {
      this.inflightUploads = Math.max(0, this.inflightUploads - 1);
    }
  }

  private ensureFileState(meta: ChunkMeta): FileState {
    const existing = this.files.get(meta.identifier);
    if (existing) return existing;

    const created: FileState = {
      identifier: meta.identifier,
      totalSize: meta.totalSize,
      totalChunks: meta.totalChunks,
      fileName: meta.fileName,
      relativePath: meta.relativePath,
      fileType: meta.fileType,
      receivedChunks: new Map(),
    };
    this.files.set(meta.identifier, created);
    return created;
  }

  private extractChunkMeta(params: URLSearchParams): ChunkMeta | null {
    const chunkNumber = Number(params.get(PARAMS.chunkNumber));
    const chunkSize = Number(params.get(PARAMS.chunkSize));
    const currentChunkSize = Number(params.get(PARAMS.currentChunkSize));
    const totalSize = Number(params.get(PARAMS.totalSize));
    const totalChunks = Number(params.get(PARAMS.totalChunks));
    const identifier = params.get(PARAMS.identifier) ?? "";
    const fileName = params.get(PARAMS.fileName) ?? "";
    const relativePath = params.get(PARAMS.relativePath) ?? "";
    const fileType = params.get(PARAMS.type) ?? "";

    if (
      Number.isNaN(chunkNumber) ||
      Number.isNaN(chunkSize) ||
      Number.isNaN(currentChunkSize) ||
      Number.isNaN(totalSize) ||
      Number.isNaN(totalChunks) ||
      !identifier
    ) {
      return null;
    }

    return {
      chunkNumber,
      chunkSize,
      currentChunkSize,
      totalSize,
      totalChunks,
      identifier,
      fileName,
      relativePath,
      fileType,
    };
  }

  private validateChunk(meta: ChunkMeta, bytes: Uint8Array): string | null {
    if (meta.chunkNumber < 1 || meta.chunkNumber > meta.totalChunks) {
      return `Invalid chunk number ${meta.chunkNumber} for ${meta.identifier}`;
    }
    if (bytes.byteLength !== meta.currentChunkSize) {
      return `Chunk size mismatch for ${meta.identifier} chunk ${meta.chunkNumber}`;
    }
    return null;
  }

  private async extractChunkBytes(request: Request): Promise<Uint8Array | null> {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const value = formData.get("file");
      if (value == null) return null;
      if (typeof value === "string") {
        return this.decodeBase64(value);
      }
      if (value instanceof Blob) {
        const buffer = await value.arrayBuffer();
        return new Uint8Array(buffer);
      }
      return null;
    }

    const buffer = await request.arrayBuffer();
    return new Uint8Array(buffer);
  }

  private decodeBase64(dataUrl: string): Uint8Array {
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    return new Uint8Array(Buffer.from(base64, "base64"));
  }

  private async waitForCondition(predicate: () => boolean, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error("Timed out waiting for backend mock condition");
      }
      await sleep(5);
    }
  }
}
