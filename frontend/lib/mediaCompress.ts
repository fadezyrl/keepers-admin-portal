import imageCompression from "browser-image-compression";

const SKIP_BYTES = 400 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function prepareBrowserFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(
        "File is too large (max 50 MB). Compress the video before uploading.",
      );
    }
    return file;
  }

  if (file.size <= SKIP_BYTES) {
    return file;
  }

  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: 1.5,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: "image/jpeg",
    });
    const name = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([compressed], `${name}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
