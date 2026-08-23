import { isIP } from "node:net";
import type { AddressClassification, ResolvedAddress } from "./types.js";

type IPv4 = readonly [number, number, number, number];
type IPv6 = readonly number[];

function parseIPv4(value: string): IPv4 | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => {
    if (!/^(?:0|[1-9]\d*)$/.test(part)) return -1;
    const number = Number(part);
    return Number.isInteger(number) && number >= 0 && number <= 255
      ? number
      : -1;
  });
  return numbers.some((number) => number < 0)
    ? null
    : ([numbers[0], numbers[1], numbers[2], numbers[3]] as IPv4);
}

function parseIPv6(value: string): IPv6 | null {
  if (value.includes("%")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] === "" ? [] : (halves[0]?.split(":") ?? []);
  const right =
    halves.length === 2 && halves[1] !== ""
      ? (halves[1]?.split(":") ?? [])
      : [];
  const parts = [...left, ...right];
  const words: number[] = [];
  for (const part of parts) {
    if (part.includes(".")) {
      const ipv4 = parseIPv4(part);
      if (ipv4 === null) return null;
      words.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
      continue;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    words.push(Number.parseInt(part, 16));
  }
  if (halves.length === 1) return words.length === 8 ? words : null;
  if (words.length >= 8) return null;
  return [
    ...words.slice(0, left.length),
    ...new Array(8 - words.length).fill(0),
    ...words.slice(left.length),
  ];
}

function ipv4Number(value: IPv4): number {
  return (
    (((value[0] * 256 + value[1]) * 256 + value[2]) * 256 + value[3]) >>> 0
  );
}

function inIPv4Range(value: number, start: number, end: number): boolean {
  return value >= start && value <= end;
}

function prefixMatches(
  value: IPv6,
  prefix: readonly number[],
  bits: number,
): boolean {
  let remaining = bits;
  for (let index = 0; remaining > 0; index += 1) {
    const compareBits = Math.min(remaining, 16);
    const mask =
      compareBits === 16 ? 0xffff : (0xffff << (16 - compareBits)) & 0xffff;
    if (((value[index] ?? 0) & mask) !== ((prefix[index] ?? 0) & mask))
      return false;
    remaining -= compareBits;
  }
  return true;
}

function mappedIPv4(value: IPv6): IPv4 | null {
  if (value.slice(0, 5).some((word) => word !== 0) || value[5] !== 0xffff)
    return null;
  return [
    (value[6] ?? 0) >> 8,
    (value[6] ?? 0) & 0xff,
    (value[7] ?? 0) >> 8,
    (value[7] ?? 0) & 0xff,
  ];
}

function classifyIPv4(value: IPv4): AddressClassification {
  const number = ipv4Number(value);
  if (inIPv4Range(number, 0x00000000, 0x00ffffff)) return "unspecified";
  if (
    inIPv4Range(number, 0x0a000000, 0x0affffff) ||
    inIPv4Range(number, 0xac100000, 0xac1fffff) ||
    inIPv4Range(number, 0xc0a80000, 0xc0a8ffff)
  )
    return "private";
  if (inIPv4Range(number, 0x7f000000, 0x7fffffff)) return "loopback";
  if (inIPv4Range(number, 0xa9fe0000, 0xa9feffff)) return "link-local";
  if (inIPv4Range(number, 0x64400000, 0x647fffff)) return "carrier-grade";
  if (
    inIPv4Range(number, 0xc0000000, 0xc00000ff) ||
    inIPv4Range(number, 0xc0000200, 0xc00002ff) ||
    inIPv4Range(number, 0xc0586300, 0xc05863ff)
  )
    return "reserved";
  if (inIPv4Range(number, 0xc6120000, 0xc613ffff)) return "benchmarking";
  if (
    inIPv4Range(number, 0xc6336400, 0xc63364ff) ||
    inIPv4Range(number, 0xcb007100, 0xcb0071ff)
  )
    return "documentation";
  if (inIPv4Range(number, 0xe0000000, 0xffffffff)) return "multicast";
  return "public";
}

function classifyIPv6(value: IPv6): AddressClassification {
  const mapped = mappedIPv4(value);
  if (mapped !== null) {
    return classifyIPv4(mapped);
  }
  if (value.every((word) => word === 0)) return "unspecified";
  if (value.slice(0, 7).every((word) => word === 0) && value[7] === 1)
    return "loopback";
  if (prefixMatches(value, [0xfc00], 7)) return "private";
  if (prefixMatches(value, [0xfe80], 10)) return "link-local";
  if (prefixMatches(value, [0xff00], 8)) return "multicast";
  if (prefixMatches(value, [0x2001, 0x0db8], 32)) return "documentation";
  if (prefixMatches(value, [0x2001, 0x0000], 32)) return "reserved";
  if (prefixMatches(value, [0x2001, 0x0002, 0x0000], 48)) return "benchmarking";
  if (prefixMatches(value, [0x2001, 0x0010], 28)) return "reserved";
  if (
    prefixMatches(value, [0x0064, 0xff9b, 0x0000, 0x0000, 0x0000, 0x0000], 96)
  )
    return "reserved";
  if (prefixMatches(value, [0x0100], 8)) return "reserved";
  return "public";
}

export function classifyAddress(value: unknown): AddressClassification {
  if (typeof value !== "string") return "invalid";
  const family = isIP(value);
  if (family === 4) {
    const parsed = parseIPv4(value);
    return parsed === null ? "invalid" : classifyIPv4(parsed);
  }
  if (family === 6) {
    const parsed = parseIPv6(value);
    return parsed === null ? "invalid" : classifyIPv6(parsed);
  }
  return "invalid";
}

export function isPublicAddress(value: unknown): boolean {
  return classifyAddress(value) === "public";
}

export function validateResolvedAddresses(
  addresses: readonly ResolvedAddress[],
  maxAddresses: number,
): ResolvedAddress[] | null {
  if (addresses.length === 0 || addresses.length > maxAddresses) return null;
  const checked: ResolvedAddress[] = [];
  for (const address of addresses) {
    if (
      (address.family !== 4 && address.family !== 6) ||
      classifyAddress(address.address) !== "public"
    )
      return null;
    checked.push({ address: address.address, family: address.family });
  }
  checked.sort(
    (left, right) =>
      left.family - right.family ||
      (left.address < right.address
        ? -1
        : left.address > right.address
          ? 1
          : 0),
  );
  return checked;
}
