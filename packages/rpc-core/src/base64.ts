/**
 * Tiny isomorphic base64 codec — works in browsers and Node 16+ via
 * the globally-available `btoa` / `atob`. Used by the protocol facades
 * (UartClient / CanClient) to wrap binary payloads.
 *
 * NOT optimised for huge buffers; for >>1 MB blobs prefer streaming via
 * the WebSocket binary type or a dedicated codec. The bimmerz-box wire
 * never moves more than a few hundred bytes per frame.
 */

/** Encode a byte array as a standard (non-URL-safe) base64 string. */
export function encodeBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return btoa(s);
}

/** Decode a base64 string into a byte array. */
export function decodeBase64(s: string): Uint8Array {
  if (!s) return new Uint8Array(0);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}
