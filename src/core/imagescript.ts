import { basename, join } from "@std/path";

const WASM_BASE_URL = "https://jsr.io/@matmen/imagescript/1.3.1/utils/wasm/";
const WASM_FETCH_RETRIES = 3;

let imageScriptPromise: Promise<typeof import("@matmen/imagescript")> | undefined;

export function loadImageScript(): Promise<typeof import("@matmen/imagescript")> {
  imageScriptPromise ??= importImageScriptWithWasmCache();
  return imageScriptPromise;
}

async function importImageScriptWithWasmCache(): Promise<typeof import("@matmen/imagescript")> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.startsWith(WASM_BASE_URL) && url.endsWith(".wasm")) {
      return new Response((await readCachedWasm(url, originalFetch)).buffer as ArrayBuffer, {
        headers: { "content-type": "application/wasm" },
      });
    }
    return await originalFetch(input, init);
  };

  try {
    return await import("@matmen/imagescript");
  } finally {
    if (globalThis.fetch !== originalFetch) globalThis.fetch = originalFetch;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return String(input);
}

async function readCachedWasm(
  url: string,
  fetchImpl: typeof fetch,
): Promise<Uint8Array> {
  const cachePath = wasmCachePath(url);
  try {
    return await Deno.readFile(cachePath);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }

  const bytes = await fetchWasmWithRetry(url, fetchImpl);
  await Deno.mkdir(wasmCacheDir(), { recursive: true });
  await Deno.writeFile(cachePath, bytes);
  return bytes;
}

async function fetchWasmWithRetry(
  url: string,
  fetchImpl: typeof fetch,
): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= WASM_FETCH_RETRIES; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Failed to fetch imagescript wasm ${url}: ${message}`);
}

function wasmCachePath(url: string): string {
  const fileName = basename(new URL(url).pathname);
  if (!fileName.endsWith(".wasm")) throw new Error(`Invalid imagescript wasm URL: ${url}`);
  return join(wasmCacheDir(), fileName);
}

function wasmCacheDir(): string {
  const denoDir = Deno.env.get("DENO_DIR");
  if (denoDir) return join(denoDir, "gpt-image-translator", "imagescript-wasm");

  const localAppData = Deno.env.get("LOCALAPPDATA");
  if (localAppData) return join(localAppData, "gpt-image-translator", "imagescript-wasm");

  const xdgCache = Deno.env.get("XDG_CACHE_HOME");
  if (xdgCache) return join(xdgCache, "gpt-image-translator", "imagescript-wasm");

  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (home) return join(home, ".cache", "gpt-image-translator", "imagescript-wasm");

  return join(Deno.cwd(), ".local", "cache", "imagescript-wasm");
}
