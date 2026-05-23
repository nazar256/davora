import { describe, expect, it } from "vitest";

import { parseMultiStatusXml } from "../src/nextcloud/xml";

describe("multistatus xml parser", () => {
  it("extracts folder and file items", () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
        <d:response>
          <d:href>/remote.php/dav/files/alice/.davora-agent-test</d:href>
          <d:propstat>
            <d:status>HTTP/1.1 200 OK</d:status>
            <d:prop>
              <d:displayname>.davora-agent-test</d:displayname>
              <d:resourcetype><d:collection/></d:resourcetype>
            </d:prop>
          </d:propstat>
        </d:response>
        <d:response>
          <d:href>/remote.php/dav/files/alice/.davora-agent-test/notes.txt</d:href>
          <d:propstat>
            <d:status>HTTP/1.1 200 OK</d:status>
            <d:prop>
              <d:displayname>notes.txt</d:displayname>
              <d:getcontentlength>12</d:getcontentlength>
              <d:getcontenttype>text/plain</d:getcontenttype>
            </d:prop>
          </d:propstat>
        </d:response>
      </d:multistatus>`;

    const items = parseMultiStatusXml(xml);
    expect(items).toHaveLength(2);
    expect(items[0]?.isFolder).toBe(true);
    expect(items[1]).toMatchObject({ displayName: "notes.txt", size: 12, contentType: "text/plain" });
  });
});
