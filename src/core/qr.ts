const QR_VERSION = 5;
const QR_SIZE = 17 + QR_VERSION * 4;
const DATA_CODEWORDS = 108;
const EC_CODEWORDS = 26;
const FORMAT_MASK = 0x5412;
const FORMAT_GENERATOR = 0x537;

const EXP: number[] = [];
const LOG: number[] = [];

let value = 1;
for (let index = 0; index < 255; index += 1) {
  EXP[index] = value;
  LOG[value] = index;
  value <<= 1;
  if (value & 0x100) value ^= 0x11d;
}
for (let index = 255; index < 512; index += 1) {
  EXP[index] = EXP[index - 255];
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function gfMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return EXP[LOG[left] + LOG[right]];
}

function reedSolomonGenerator(degree: number): number[] {
  let generator = [1];
  for (let exponent = 0; exponent < degree; exponent += 1) {
    const next = new Array(generator.length + 1).fill(0);
    for (let index = 0; index < generator.length; index += 1) {
      next[index] ^= generator[index];
      next[index + 1] ^= gfMultiply(generator[index], EXP[exponent]);
    }
    generator = next;
  }
  return generator;
}

function reedSolomonRemainder(data: number[], degree: number): number[] {
  const generator = reedSolomonGenerator(degree);
  const working = [...data, ...new Array(degree).fill(0)];
  for (let index = 0; index < data.length; index += 1) {
    const coefficient = working[index];
    if (coefficient === 0) continue;
    for (let offset = 1; offset < generator.length; offset += 1) {
      working[index + offset] ^= gfMultiply(generator[offset], coefficient);
    }
  }
  return working.slice(data.length);
}

function appendBits(bits: number[], valueToAppend: number, length: number) {
  for (let index = length - 1; index >= 0; index -= 1) {
    bits.push((valueToAppend >>> index) & 1);
  }
}

function encodeDataCodewords(url: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(url));
  if (bytes.length > DATA_CODEWORDS - 2) {
    throw new Error("Profile URL is too long for the badge QR code.");
  }

  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);

  const capacityBits = DATA_CODEWORDS * 8;
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset += 1) byte = (byte << 1) | bits[index + offset];
    data.push(byte);
  }

  for (let pad = 0; data.length < DATA_CODEWORDS; pad += 1) {
    data.push(pad % 2 === 0 ? 0xec : 0x11);
  }
  return data;
}

function createMatrix() {
  return {
    modules: Array.from({ length: QR_SIZE }, () => new Array<boolean | null>(QR_SIZE).fill(null)),
    functionModules: Array.from({ length: QR_SIZE }, () => new Array<boolean>(QR_SIZE).fill(false))
  };
}

function setFunctionModule(matrix: ReturnType<typeof createMatrix>, x: number, y: number, dark: boolean) {
  if (x < 0 || x >= QR_SIZE || y < 0 || y >= QR_SIZE) return;
  matrix.modules[y][x] = dark;
  matrix.functionModules[y][x] = true;
}

function drawFinder(matrix: ReturnType<typeof createMatrix>, x: number, y: number) {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const xx = x + dx;
      const yy = y + dy;
      const inCore = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const dark = inCore && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setFunctionModule(matrix, xx, yy, dark);
    }
  }
}

function drawAlignment(matrix: ReturnType<typeof createMatrix>, x: number, y: number) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setFunctionModule(matrix, x + dx, y + dy, distance !== 1);
    }
  }
}

function getFormatBits(): number {
  const errorCorrectionLow = 0b01;
  const mask = 0;
  const data = (errorCorrectionLow << 3) | mask;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * FORMAT_GENERATOR);
  }
  return ((data << 10) | remainder) ^ FORMAT_MASK;
}

function getBit(valueToRead: number, index: number): boolean {
  return ((valueToRead >>> index) & 1) !== 0;
}

function drawFormatBits(matrix: ReturnType<typeof createMatrix>) {
  const bits = getFormatBits();
  for (let index = 0; index <= 5; index += 1) setFunctionModule(matrix, 8, index, getBit(bits, index));
  setFunctionModule(matrix, 8, 7, getBit(bits, 6));
  setFunctionModule(matrix, 8, 8, getBit(bits, 7));
  setFunctionModule(matrix, 7, 8, getBit(bits, 8));
  for (let index = 9; index < 15; index += 1) setFunctionModule(matrix, 14 - index, 8, getBit(bits, index));

  for (let index = 0; index < 8; index += 1) setFunctionModule(matrix, QR_SIZE - 1 - index, 8, getBit(bits, index));
  for (let index = 8; index < 15; index += 1) setFunctionModule(matrix, 8, QR_SIZE - 15 + index, getBit(bits, index));
  setFunctionModule(matrix, 8, QR_SIZE - 8, true);
}

function drawFunctionPatterns(matrix: ReturnType<typeof createMatrix>) {
  drawFinder(matrix, 0, 0);
  drawFinder(matrix, QR_SIZE - 7, 0);
  drawFinder(matrix, 0, QR_SIZE - 7);
  drawAlignment(matrix, 30, 30);

  for (let index = 8; index < QR_SIZE - 8; index += 1) {
    const dark = index % 2 === 0;
    setFunctionModule(matrix, 6, index, dark);
    setFunctionModule(matrix, index, 6, dark);
  }
  drawFormatBits(matrix);
}

function applyData(matrix: ReturnType<typeof createMatrix>, codewords: number[]) {
  const bits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, index) => (byte >>> (7 - index)) & 1));
  let bitIndex = 0;
  let upward = true;

  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < QR_SIZE; vertical += 1) {
      const y = upward ? QR_SIZE - 1 - vertical : vertical;
      for (let dx = 0; dx < 2; dx += 1) {
        const x = right - dx;
        if (matrix.functionModules[y][x]) continue;
        let dark = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
        bitIndex += 1;
        if ((x + y) % 2 === 0) dark = !dark;
        matrix.modules[y][x] = dark;
      }
    }
    upward = !upward;
  }
}

export function createQrModules(url: string): boolean[][] {
  const data = encodeDataCodewords(url);
  const codewords = [...data, ...reedSolomonRemainder(data, EC_CODEWORDS)];
  const matrix = createMatrix();
  drawFunctionPatterns(matrix);
  applyData(matrix, codewords);
  return matrix.modules.map((row) => row.map(Boolean));
}

export function renderQrUrlSvg(url: string, moduleSize = 2, quietModules = 4): string {
  const modules = createQrModules(url);
  const rects = modules.flatMap((row, y) =>
    row.map((dark, x) => (dark ? `<rect x="${(x + quietModules) * moduleSize}" y="${(y + quietModules) * moduleSize}" width="${moduleSize}" height="${moduleSize}" fill="#111418"/>` : ""))
  ).join("");
  const size = (QR_SIZE + quietModules * 2) * moduleSize;
  return `<g id="profile-url-qr" data-profile-url="${escapeXml(url)}" data-quiet-modules="${quietModules}">
    <desc>Profile URL QR: ${escapeXml(url)}</desc>
    <rect x="0" y="0" width="${size}" height="${size}" fill="#ffffff"/>
    ${rects}
  </g>`;
}
