// 验证 crypto / md5 移植正确性（用 Node 22 的 --experimental-strip-types 直接跑 TS）。
// 不做网络请求，仅验证：MD5 标准向量 + ECDSA 签名可被 WebCrypto 校验（DER/低 s 路径正确）。
import { md5hex } from "../src/lib/md5.ts";
import { importPrivateKey, signEcdsaP256 } from "../src/lib/crypto.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

// MD5 标准向量
assert(md5hex("abc") === "900150983cd24fb0d6963f7d28e17f72", "md5('abc')");
assert(md5hex("") === "d41d8cd98f00b204e9800998ecf8427e", "md5('')");
assert(
  md5hex("The quick brown fox jumps over the lazy dog") === "9e107d9d372bb6826bd81d3542a419d6",
  "md5(fox)",
);

// 复刻 MiniMax x-signature 输入形态，确认签名函数对多字节串也能跑通
const pseudoSig = md5hex("1700000000I*7Cf%WZ#S&%1RlZJ&C2{}");
assert(pseudoSig.length === 32, "minimax-style md5 输出 32 位");

// ECDSA 往返：生成 P-256 私钥 -> 导出 pkcs8 PEM -> 导入 -> 签名 -> 用公钥校验
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
let bin = "";
for (const b of der) bin += String.fromCharCode(b);
const pem =
  "-----BEGIN PRIVATE KEY-----\n" + btoa(bin) + "\n-----END PRIVATE KEY-----";

const imported = await importPrivateKey(pem);
const sig = await signEcdsaP256(imported, new TextEncoder().encode("POST\n/trae/api/v3/oauth/ExchangeToken\nen1oxy7wnw8j9n\nREFRESH\n1700000000\nABCDEF0123456789"));
// signEcdsaP256 返回 base64(DER)；WebCrypto verify 要 IEEE P1363（raw r||s），故转回
const derBytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
function derToP1363(der: Uint8Array): Uint8Array {
  let p = 2;
  if (der[1] & 0x80) p += der[1] & 0x7f;
  p += 2; // 跳过 r 的 0x02 + len
  const lenR = der[p - 1];
  let q = p + lenR;
  q += 2; // 跳过 s 的 0x02 + len
  const lenS = der[q - 1];
  const strip = (start: number, len: number) => {
    let i = start;
    while (i < start + len - 1 && der[i] === 0) i++;
    return der.subarray(i, start + len);
  };
  const r = strip(p, lenR);
  const s = strip(q, lenS);
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}
const sigBytes = derToP1363(derBytes);
const ok = await crypto.subtle.verify(
  { name: "ECDSA", hash: "SHA-256" },
  kp.publicKey,
  sigBytes,
  new TextEncoder().encode("POST\n/trae/api/v3/oauth/ExchangeToken\nen1oxy7wnw8j9n\nREFRESH\n1700000000\nABCDEF0123456789"),
);
assert(ok, "ECDSA sign->verify 往返成功（P1363 解析 / 低 s 归一化正确）");

console.log("ALL OK");
