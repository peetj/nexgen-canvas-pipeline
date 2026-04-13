import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findLocalImageFile } from "./localImage.js";

async function withTempDir(run: (dirPath: string) => Promise<void>): Promise<void> {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), "nexgen-local-image-"));
  try {
    await run(dirPath);
  } finally {
    await fs.rm(dirPath, { recursive: true, force: true });
  }
}

test("findLocalImageFile allows root-level filenames that begin with '..'", async () => {
  await withTempDir(async (dirPath) => {
    const imagePath = path.join(dirPath, "..hero.jpg");
    await fs.writeFile(imagePath, "test");

    const resolved = await findLocalImageFile(dirPath, "..hero.jpg");

    assert.equal(resolved, imagePath);
  });
});

test("findLocalImageFile rejects traversal outside the folder", async () => {
  await withTempDir(async (dirPath) => {
    const outsideImagePath = path.join(path.dirname(dirPath), "escape.jpg");
    await fs.writeFile(outsideImagePath, "test");

    await assert.rejects(
      () => findLocalImageFile(dirPath, "../escape.jpg"),
      /--image-file must stay inside/
    );

    await fs.rm(outsideImagePath, { force: true });
  });
});

test("findLocalImageFile returns a nested relative image path inside the folder", async () => {
  await withTempDir(async (dirPath) => {
    const nestedDirPath = path.join(dirPath, "images");
    const nestedImagePath = path.join(nestedDirPath, "lesson-photo.png");
    await fs.mkdir(nestedDirPath, { recursive: true });
    await fs.writeFile(nestedImagePath, "test");

    const resolved = await findLocalImageFile(dirPath, "images/lesson-photo.png");

    assert.equal(resolved, nestedImagePath);
  });
});

test("findLocalImageFile prefers image.* when auto-picking from the folder root", async () => {
  await withTempDir(async (dirPath) => {
    const preferredImagePath = path.join(dirPath, "image.png");
    const otherImagePath = path.join(dirPath, "diagram.jpg");
    await fs.writeFile(otherImagePath, "test");
    await fs.writeFile(preferredImagePath, "test");

    const resolved = await findLocalImageFile(dirPath);

    assert.equal(resolved, preferredImagePath);
  });
});

test("findLocalImageFile rejects symlinked files that resolve outside the folder", async (t) => {
  await withTempDir(async (dirPath) => {
    const outsideImagePath = path.join(path.dirname(dirPath), "outside.jpg");
    const symlinkPath = path.join(dirPath, "linked.jpg");
    await fs.writeFile(outsideImagePath, "test");

    try {
      await fs.symlink(outsideImagePath, symlinkPath);
    } catch (err) {
      const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
      if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
        t.skip(`symlink creation not available on this machine (${code})`);
        await fs.rm(outsideImagePath, { force: true });
        return;
      }
      throw err;
    }

    await assert.rejects(
      () => findLocalImageFile(dirPath, "linked.jpg"),
      /--image-file must stay inside/
    );

    await fs.rm(outsideImagePath, { force: true });
  });
});
