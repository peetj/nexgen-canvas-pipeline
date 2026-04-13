import fs from "node:fs/promises";
import path from "node:path";

export const LOCAL_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".avif"
]);

function isPathOutsideDirectory(basePath: string, candidatePath: string): boolean {
  const relative = path.relative(basePath, candidatePath);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function invalidImageFilePathMessage(folderPath: string): string {
  return `--image-file must stay inside "${folderPath}". Provide a relative path such as "image.jpg".`;
}

export async function findLocalImageFile(
  folderPath: string,
  requestedPath?: string
): Promise<string | undefined> {
  const normalizedRequestedPath = requestedPath?.trim();
  if (normalizedRequestedPath) {
    if (path.isAbsolute(normalizedRequestedPath)) {
      throw new Error(invalidImageFilePathMessage(folderPath));
    }

    const resolved = path.resolve(folderPath, normalizedRequestedPath);
    if (isPathOutsideDirectory(folderPath, resolved)) {
      throw new Error(invalidImageFilePathMessage(folderPath));
    }

    let stats: Awaited<ReturnType<typeof fs.stat>> | undefined;
    try {
      stats = await fs.stat(resolved);
    } catch {
      stats = undefined;
    }

    if (!stats?.isFile()) {
      throw new Error(`Local image "${normalizedRequestedPath}" was not found in "${folderPath}".`);
    }

    const [realFolderPath, realResolvedPath] = await Promise.all([
      fs.realpath(folderPath),
      fs.realpath(resolved)
    ]);
    if (isPathOutsideDirectory(realFolderPath, realResolvedPath)) {
      throw new Error(invalidImageFilePathMessage(folderPath));
    }

    if (!LOCAL_IMAGE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
      throw new Error(`Unsupported local image type for "${normalizedRequestedPath}".`);
    }

    return resolved;
  }

  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => LOCAL_IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()));

  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => {
    const aImage = /^image\./i.test(a) ? 0 : 1;
    const bImage = /^image\./i.test(b) ? 0 : 1;
    if (aImage !== bImage) return aImage - bImage;
    return a.localeCompare(b);
  });
  return path.resolve(folderPath, candidates[0]);
}
