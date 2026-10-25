import { describe, expect, it } from "vitest";
import { IMAGE_MAX_BYTES, imageFileError } from "@/components/admin/ui/entity-image-field";
import { resolveAdminMediaUrl } from "@/components/admin/lib/media-url";
import { BUILTIN_ARTWORK, builtinArtworkImage, effectiveArtworkKey } from "@/lib/builtin-artwork";

describe("panel picture uploads", () => {
  it("checks type and size before uploading (server re-checks)", () => {
    expect(imageFileError({ name: "a.png", type: "image/png", size: 1000 })).toBe("");
    expect(imageFileError({ name: "a.webp", type: "image/webp", size: IMAGE_MAX_BYTES })).toBe("");
    expect(imageFileError({ name: "a.svg", type: "image/svg+xml", size: 10 })).toMatch(/not a JPEG, PNG, WEBP or GIF/);
    expect(imageFileError({ name: "a.pdf", type: "application/pdf", size: 10 })).toMatch(/not a JPEG/);
    expect(imageFileError({ name: "big.jpg", type: "image/jpeg", size: IMAGE_MAX_BYTES + 1 })).toMatch(/at most 5 MB/);
    expect(imageFileError({ name: "empty.png", type: "image/png", size: 0 })).toMatch(/empty/);
  });

  it("resolves uploaded /media/ against the API and bundled /catalog, /home, /brand against the store", () => {
    const api = "https://api.example.com/api/v1";
    expect(resolveAdminMediaUrl("/media/uploads/a.png", api)).toBe("https://api.example.com/media/uploads/a.png");
    expect(resolveAdminMediaUrl("https://api.example.com/media/uploads/a.png", api)).toBe("https://api.example.com/media/uploads/a.png");
    expect(resolveAdminMediaUrl("/catalog/psn-store.webp", api)).toBe("/catalog/psn-store.webp");
    expect(resolveAdminMediaUrl("/home/hero-banner.jpg", api)).toBe("/home/hero-banner.jpg");
    expect(resolveAdminMediaUrl("/brand/IMG_4556.png", api)).toBe("/brand/IMG_4556.png");
  });

  it("every built-in picture key is unique and bundled pictures live in /catalog", () => {
    const keys = BUILTIN_ARTWORK.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of BUILTIN_ARTWORK) if (item.image) expect(item.image).toMatch(/^\/catalog\/[a-z0-9-]+\.webp$/);
    expect(effectiveArtworkKey({ artworkKey: "", slug: "steam" })).toBe("card-steam");
    expect(builtinArtworkImage({ artworkKey: "gift", slug: "steam" })).toBe("");
  });
});
