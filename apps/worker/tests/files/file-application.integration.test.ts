import { beforeEach, describe, expect, it } from "vitest";
import { searchEndpoint } from "@davora/shared";

import { handleRequest } from "../../src/app";
import { authorizedRequest, createSessionToken, env, resetConnectedAccountStoreForTests } from "../support/workerApplicationHarness";

beforeEach(() => {
  resetConnectedAccountStoreForTests();
});

describe("worker file application", () => {
  it("returns a strict account-bound search envelope with the raw query", async () => {
    const { token } = await createSessionToken();
    const response = await authorizedRequest(token, "/api/search?path=Projects&q=%20roadmap%20");
    expect(response.status).toBe(200);
    const payload = searchEndpoint.successSchema.parse(await response.json());
    expect(payload.data.path).toBe("Projects");
    expect(payload.data.query).toBe(" roadmap ");
    expect(payload.data.items.every((entry) => entry.path.startsWith("Projects/") && Number.isFinite(entry.score))).toBe(true);
  })

  it("returns preview results for text, markdown MIME variants, media, and PDFs", async () => {
    const { token } = await createSessionToken();
    const textResponse = await authorizedRequest(token, "/api/file?path=Projects/roadmap.txt");
    const textPayload = (await textResponse.json()) as { data: { file: { content: string; viewer: string } } };
    expect(textPayload.data.file.content).toContain("normalized API");
    expect(textPayload.data.file.viewer).toBe("text");

    const markdownResponse = await authorizedRequest(token, "/api/file?path=Design/spec.md");
    const markdownPayload = (await markdownResponse.json()) as { data: { file: { viewer: string; mimeType?: string } } };
    expect(markdownPayload.data.file.viewer).toBe("markdown");

    const mediaResponse = await authorizedRequest(token, "/api/file?path=Archive/photo.png");
    const mediaPayload = (await mediaResponse.json()) as { data: { file: { viewer: string; requiresOriginalBlob: boolean } } };
    expect(mediaPayload.data.file.viewer).toBe("image");
    expect(mediaPayload.data.file.requiresOriginalBlob).toBe(true);

    const pdfResponse = await authorizedRequest(token, "/api/file?path=Archive/guide.pdf");
    const pdfPayload = (await pdfResponse.json()) as { data: { file: { viewer: string; requiresOriginalBlob: boolean; unsupportedReason?: string } } };
    expect(pdfPayload.data.file.viewer).toBe("pdf");
    expect(pdfPayload.data.file.requiresOriginalBlob).toBe(true);
    expect(pdfPayload.data.file.unsupportedReason).toMatch(/Open the original PDF/i);
  })

  it("supports browser-native POST download handoff for the active account", async () => {
    const { token } = await createSessionToken();
    const formData = new FormData();
    formData.set("path", "Archive/image.bin");
    formData.set("token", token);

    const response = await handleRequest(
      new Request("http://127.0.0.1:8787/api/download", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:4173" },
        body: formData
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename\*=UTF-8''image\.bin/);
  })

  it("streams media ranges for browser-native playback without exposing account credentials", async () => {
    const { token } = await createSessionToken();
    const response = await authorizedRequest(token, "/api/file/stream?path=Projects/song.mp3", {
      headers: { range: "bytes=1-2" }
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBe("bytes 1-2/4");
    expect(response.headers.get("content-length")).toBe("2");
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0x44, 0x33]));
  })

  it("uses a path-bound stream token for browser-native media URLs", async () => {
    const { token } = await createSessionToken();
    const tokenResponse = await authorizedRequest(token, "/api/file/stream-token?path=Projects/song.mp3", {
      method: "POST"
    });
    expect(tokenResponse.status).toBe(200);
    const tokenPayload = (await tokenResponse.json()) as { data: { token: string; path: string; expiresAt: string } };
    expect(tokenPayload.data.path).toBe("Projects/song.mp3");

    const streamResponse = await handleRequest(
      new Request(`http://127.0.0.1:8787/api/file/stream?path=Projects/song.mp3&streamToken=${encodeURIComponent(tokenPayload.data.token)}`, {
        headers: {
          origin: "http://127.0.0.1:4173",
          range: "bytes=0-0"
        }
      }),
      env
    );
    expect(streamResponse.status).toBe(206);

    const wrongPathResponse = await handleRequest(
      new Request(`http://127.0.0.1:8787/api/file/stream?path=Archive/image.bin&streamToken=${encodeURIComponent(tokenPayload.data.token)}`, {
        headers: { origin: "http://127.0.0.1:4173" }
      }),
      env
    );
    expect(wrongPathResponse.status).toBe(401);

    const querySessionResponse = await handleRequest(
      new Request(`http://127.0.0.1:8787/api/file/stream?path=Projects/song.mp3&token=${encodeURIComponent(token)}`, {
        headers: { origin: "http://127.0.0.1:4173" }
      }),
      env
    );
    expect(querySessionResponse.status).toBe(401);

    const regularResponse = await handleRequest(
      new Request(`http://127.0.0.1:8787/api/file/original?path=Projects/song.mp3&streamToken=${encodeURIComponent(tokenPayload.data.token)}`, {
        headers: { origin: "http://127.0.0.1:4173" }
      }),
      env
    );
    expect(regularResponse.status).toBe(401);
  })

  it("validates stream-token paths with the endpoint descriptor before signing", async () => {
    const { token } = await createSessionToken();
    const response = await authorizedRequest(token, "/api/file/stream-token?path=../private", { method: "POST" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ data: { code: "invalid_request", message: "File path query was invalid." } });
  })

  it("supports create/upload/move/copy/delete operations for the active account", async () => {
    const { token } = await createSessionToken();

    const createFolderResponse = await authorizedRequest(token, "/api/folders", {
      method: "POST",
      body: JSON.stringify({ path: "", name: "Temp" })
    });
    expect(createFolderResponse.status).toBe(201);
    await expect(createFolderResponse.json()).resolves.toMatchObject({
      data: {
        result: {
          action: "createFolder",
          parentPath: "",
          path: "Temp",
          item: { path: "Temp", name: "Temp", isFolder: true }
        }
      }
    });

    const bodyAuthoritativeCreateFolderResponse = await authorizedRequest(token, "/api/folders?path=Temp", {
      method: "POST",
      body: JSON.stringify({ path: "", name: "QueryIgnored" })
    });
    expect(bodyAuthoritativeCreateFolderResponse.status).toBe(201);
    await expect(bodyAuthoritativeCreateFolderResponse.json()).resolves.toMatchObject({
      data: {
        result: {
          parentPath: "",
          path: "QueryIgnored",
          item: { path: "QueryIgnored", name: "QueryIgnored", isFolder: true }
        }
      }
    });

    const malformedCreateFolderResponse = await authorizedRequest(token, "/api/folders", {
      method: "POST",
      body: JSON.stringify({ path: "", name: "Rejected", unexpected: true })
    });
    expect(malformedCreateFolderResponse.status).toBe(400);

    for (const invalidPath of [null, false, 0]) {
      const invalidPathResponse = await authorizedRequest(token, "/api/folders?path=Temp", {
        method: "POST",
        body: JSON.stringify({ path: invalidPath, name: "Rejected" })
      });
      expect(invalidPathResponse.status).toBe(400);
    }

    const invalidJsonCreateFolderResponse = await authorizedRequest(token, "/api/folders", {
      method: "POST",
      body: "{"
    });
    expect(invalidJsonCreateFolderResponse.status).toBe(400);

    const uploadResponse = await authorizedRequest(token, "/api/upload", {
      method: "POST",
      body: JSON.stringify({
        path: "Temp",
        name: "note.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("hello world", "utf8").toString("base64")
      })
    });
    expect(uploadResponse.status).toBe(201);
    await expect(uploadResponse.json()).resolves.toMatchObject({
      data: {
        result: {
          action: "upload",
          parentPath: "Temp",
          path: "Temp/note.txt",
          item: { path: "Temp/note.txt", name: "note.txt", isFolder: false }
        }
      }
    });

    const malformedUploadResponse = await authorizedRequest(token, "/api/upload", {
      method: "POST",
      body: JSON.stringify({ path: "Temp", name: "rejected.txt", contentBase64: "YQ==", unexpected: true })
    });
    expect(malformedUploadResponse.status).toBe(400);

    const invalidBase64UploadResponse = await authorizedRequest(token, "/api/upload", {
      method: "POST",
      body: JSON.stringify({ path: "Temp", name: "rejected.txt", contentBase64: "not base64" })
    });
    expect(invalidBase64UploadResponse.status).toBe(400);

    const invalidJsonUploadResponse = await authorizedRequest(token, "/api/upload", {
      method: "POST",
      body: "{"
    });
    expect(invalidJsonUploadResponse.status).toBe(400);

    const moveResponse = await authorizedRequest(token, "/api/move", {
      method: "POST",
      body: JSON.stringify({ path: "Temp/note.txt", destinationPath: "Temp/note-renamed.txt" })
    });
    expect(moveResponse.status).toBe(200);

    const malformedMoveResponse = await authorizedRequest(token, "/api/move", {
      method: "POST",
      body: JSON.stringify({ path: "Temp/note-renamed.txt", destinationPath: "Temp/rejected.txt", unexpected: true })
    });
    expect(malformedMoveResponse.status).toBe(400);

    const copyResponse = await authorizedRequest(token, "/api/copy", {
      method: "POST",
      body: JSON.stringify({ path: "Temp/note-renamed.txt", destinationPath: "Temp/note-copy.txt" })
    });
    expect(copyResponse.status).toBe(201);

    const deleteFailResponse = await authorizedRequest(token, "/api/delete", {
      method: "POST",
      body: JSON.stringify({ path: "Temp/note-copy.txt", confirmName: "wrong" })
    });
    expect(deleteFailResponse.status).toBe(400);

    const malformedDeleteResponse = await authorizedRequest(token, "/api/delete", {
      method: "POST",
      body: JSON.stringify({ path: "Temp/note-copy.txt", confirmName: "note-copy.txt", unexpected: true })
    });
    expect(malformedDeleteResponse.status).toBe(400);

    const rootDeleteResponse = await authorizedRequest(token, "/api/delete", {
      method: "POST",
      body: JSON.stringify({ path: "", confirmName: "" })
    });
    expect(rootDeleteResponse.status).toBe(400);

    const invalidJsonDeleteResponse = await authorizedRequest(token, "/api/delete", {
      method: "POST",
      body: "{"
    });
    expect(invalidJsonDeleteResponse.status).toBe(400);

    const deleteResponse = await authorizedRequest(token, "/api/delete", {
      method: "POST",
      body: JSON.stringify({ path: "Temp/note-copy.txt", confirmName: "note-copy.txt" })
    });
    expect(deleteResponse.status).toBe(200);
  })
});

