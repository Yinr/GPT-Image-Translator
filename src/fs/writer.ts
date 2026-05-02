import { dirname } from "@std/path";

export async function writeImageOutput(path: string, bytes: Uint8Array): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeFile(path, bytes);
}
