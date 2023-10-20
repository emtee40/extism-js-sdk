import {
  ExtismPluginBase,
  PluginWasi,
  ExtismPluginOptions,
  fetchModuleData,
  instantiateExtismRuntime,
  Manifest,
  ManifestWasm,
  ManifestWasmData,
  ManifestWasmUrl,
  HttpRequest,
  HttpResponse,
  CurrentPlugin,
  StreamingSource,
  isURL,
} from '../plugin.ts';
import {
  embeddedRuntime,
  embeddedRuntimeHash,
} from '../runtime.ts';
import Context from 'https://deno.land/std@0.200.0/wasi/snapshot_preview1.ts';
import minimatch from 'https://deno.land/x/minimatch@v3.0.4/index.js';
import { createHash } from 'https://deno.land/std@0.108.0/hash/mod.ts';
import { decode } from 'https://deno.land/std@0.201.0/encoding/base64.ts';
import * as path from 'https://deno.land/std@0.102.0/path/mod.ts';

class ExtismPlugin extends ExtismPluginBase {
  protected supportsHttpRequests(): boolean {
    return false;
  }

  protected httpRequest(_: HttpRequest, __: Uint8Array | null): HttpResponse {
    throw new Error('Method not implemented.');
  }

  protected matches(text: string, pattern: string): boolean {
    return minimatch(text, pattern);
  }

  protected loadWasi(options: ExtismPluginOptions): PluginWasi {
    const context = new Context({
      preopens: options.allowedPaths,
    });

    return new PluginWasi(context, context.exports, (instance) => this.initialize(context, instance));
  }

  private initialize(context: Context, instance: WebAssembly.Instance) {
    const memory = instance.exports.memory as WebAssembly.Memory;

    if (!memory) {
      throw new Error('The module has to export a default memory.');
    }

    context.start({
      exports: {
        memory,
        _start: () => { },
      },
    });
  }
}

/**
   * Create a new plugin.
   * @param manifestData An Extism manifest {@link Manifest} or a Wasm module.
   * @param options Options for initializing the plugin.
   * @returns {ExtismPlugin} An initialized plugin.
   */
async function createPlugin(
  manifestData: Manifest | ManifestWasm | ArrayBuffer | string | URL,
  options: ExtismPluginOptions,
): Promise<ExtismPlugin> {

  if (typeof manifestData === "string" || manifestData instanceof URL) {
    manifestData = {
      url: manifestData as string | URL
    }
  }
  
  const moduleData = await fetchModuleData(manifestData, fetchWasm, calculateHash);

  const runtimeWasm = options.runtime ?? {
    data: decode(embeddedRuntime),
    hash: embeddedRuntimeHash,
  };

  const runtime = await instantiateExtismRuntime(runtimeWasm, fetchWasm, calculateHash);

  return new ExtismPlugin(runtime, moduleData, options);

  async function fetchWasm(wasm: ManifestWasm): Promise<StreamingSource> {
    let data: ArrayBuffer;

    if ((wasm as ManifestWasmData).data) {
      data = (wasm as ManifestWasmData).data;
    } else if ((wasm as ManifestWasmUrl).url) {
      const url = (wasm as ManifestWasmUrl).url;
      if (isURL(url)) {
        return await fetch(url);
      } else {
        const absolutePath = path.resolve(url as string);
        return await fetch(`file://${absolutePath}`);
      }
    } else {
      throw new Error(`Unrecognized wasm source: ${wasm}`);
    }

    return data;
  }

  function calculateHash(data: ArrayBuffer): Promise<string> {
    return new Promise<string>((resolve) => {
      const hasher = createHash('sha256');
      hasher.update(data);
      resolve(hasher.toString('hex'));
    });
  }
}

export default createPlugin;

export type { ExtismPlugin, CurrentPlugin, ExtismPluginOptions, Manifest, ManifestWasm, ManifestWasmData, ManifestWasmUrl };
