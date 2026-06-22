import { createQrModules, renderQrUrlSvg } from "./qr";

it("renders a real URL-backed QR matrix", () => {
  const one = createQrModules("https://x.com/anthony");
  const two = createQrModules("https://x.com/codex");
  expect(one).toHaveLength(37);
  expect(one[0]).toHaveLength(37);
  expect(one.flat().filter(Boolean).length).toBeGreaterThan(300);
  expect(one).not.toEqual(two);
});

it("includes the encoded profile URL as public-safe metadata", () => {
  const svg = renderQrUrlSvg("https://x.com/anthony");
  expect(svg).toContain('id="profile-url-qr"');
  expect(svg).toContain('data-profile-url="https://x.com/anthony"');
  expect(svg).toContain('data-quiet-modules="4"');
  expect(svg).toContain('width="90" height="90" fill="#ffffff"');
  expect(svg).toContain("Profile URL QR: https://x.com/anthony");
});
