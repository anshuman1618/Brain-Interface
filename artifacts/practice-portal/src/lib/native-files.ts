import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { isNative } from "@/lib/platform";

/**
 * Getting a document into and out of a case file, on a handset.
 *
 * The upload endpoint needs no help: `POST /cases/:id/documents/content` takes
 * a raw body with the metadata in headers and no multipart parser, so a
 * captured photo is sent by exactly the code path the web page already uses.
 * What the shell has to supply is the Blob at one end and somewhere to put the
 * bytes at the other.
 */

/**
 * JPEG, always.
 *
 * The server's MIME allowlist (blob-store.ts) does not include HEIC, which is
 * what an iPhone produces by default — an untouched capture would come back
 * 415. It also sniffs magic bytes and refuses a body whose content disagrees
 * with the declared type, so the format asked for here and the Content-Type
 * sent later must be the same thing.
 */
const CAPTURE_MIME = "image/jpeg";

/**
 * 25 MB is the server's `MAX_UPLOAD_BYTES`. Quality 85 at a 2400px bound keeps
 * a page of typed text comfortably readable and a capture well inside it — a
 * full-resolution modern sensor can otherwise approach the cap in one shot.
 */
const CAPTURE_QUALITY = 85;
const CAPTURE_MAX_EDGE = 2400;

export type CapturedFile = { blob: Blob; fileName: string; mimeType: string };

/** True when the camera route should be offered at all. */
export function canCapture(): boolean {
  return isNative();
}

/**
 * Photograph a document, or pick one already on the device.
 *
 * Returns null when the user backs out, which is the common case and not an
 * error — the caller should simply do nothing.
 */
export async function captureDocument(
  source: "camera" | "library" = "camera",
): Promise<CapturedFile | null> {
  if (!isNative()) return null;

  const photo = await Camera.getPhoto({
    quality: CAPTURE_QUALITY,
    // Both bounds, not a target size: the plugin documents these as MAXIMA
    // with the aspect ratio respected, so a page stays a page rather than
    // being squared off.
    width: CAPTURE_MAX_EDGE,
    height: CAPTURE_MAX_EDGE,
    correctOrientation: true,
    // Cropping on capture is worth the extra tap: it is how a photograph of a
    // page on a desk becomes a document rather than a photograph.
    allowEditing: true,
    resultType: CameraResultType.Uri,
    source: source === "library" ? CameraSource.Photos : CameraSource.Camera,
  });

  // `webPath` is a local URI the webview can read. Fetching it yields the real
  // bytes — deliberately not `CameraResultType.Base64`: the endpoint treats the
  // body as literal file bytes, so a base64 string would fail the magic-byte
  // check with a confusing 415.
  if (!photo.webPath) return null;
  const response = await fetch(photo.webPath);
  const raw = await response.blob();

  // Re-typed rather than trusted: some Android providers report
  // application/octet-stream for a JPEG they just wrote, and the server
  // compares the declared type against the bytes.
  const blob =
    raw.type === CAPTURE_MIME
      ? raw
      : new Blob([await raw.arrayBuffer()], {
          type: CAPTURE_MIME,
        });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return { blob, fileName: `capture-${stamp}.jpg`, mimeType: CAPTURE_MIME };
}

/**
 * Hand a downloaded document to the OS.
 *
 * The web page creates an object URL and clicks an anchor at it, which does
 * nothing in a webview: there is no download manager behind it and no visible
 * file afterwards. Writing to the app's Cache directory and opening the share
 * sheet is the native equivalent — the user chooses Files, Mail, WhatsApp, or
 * wherever the document is actually going.
 *
 * Cache rather than Documents on purpose: the OS may reclaim it, which is the
 * right lifetime for a copy of something whose record lives on the server.
 */
export async function saveAndShare(
  blob: Blob,
  fileName: string,
  title = "Document",
): Promise<void> {
  const base64 = await blobToBase64(blob);

  const written = await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });

  await Share.share({ title, url: written.uri, dialogTitle: title });
}

/** FileReader rather than a manual btoa loop: it does not blow the call stack on a large PDF. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.onload = () => {
      const result = String(reader.result);
      // Strip the "data:<mime>;base64," prefix — Filesystem wants the payload.
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}
