/**
 * Converts a string, number, null, or undefined value to a valid number or null.
 * Returns null if the value cannot be parsed or is non-finite.
 *
 * @param v - Input value to convert.
 * @returns Parsed number or null.
 */
export const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined) {
    return null;
  }

  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null;
  }

  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof v === 'bigint') {
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  }

  return null;
};

/**
 * Converts a byte count to gigabytes (1 GB = 1024^3 bytes), rounded to 2 decimal places.
 * Returns null if the input is null, undefined, or not a finite number.
 *
 * @param v - Byte count to convert.
 * @returns Gigabytes as a number rounded to 2 decimal places, or null.
 */
export const bytesToGb = (v: number | null): number | null => {
  if (v === null || v === undefined || typeof v !== 'number' || !Number.isFinite(v)) {
    return null;
  }

  const GIGABYTE = 1024 * 1024 * 1024;
  const gb = v / GIGABYTE;
  return Math.round(gb * 100) / 100;
};

/**
 * Parses CIM / WMI date strings into an ISO 8601 string.
 * Supports Microsoft JSON dates `/Date(1700000000000)/` and DMTF datetime strings
 * like `20240315000000.000000+000`.
 *
 * @param v - Input date string or Date object.
 * @returns Formatted ISO 8601 date string, or null if unparseable.
 */
export const parseCimDate = (v: unknown): string | null => {
  if (v === null || v === undefined) {
    return null;
  }

  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString();
  }

  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (typeof v !== 'string') {
    return null;
  }

  const trimmed = v.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Format 1: Microsoft JSON date /Date(1700000000000)/ or /Date(1700000000000+0000)/
  const msMatch = trimmed.match(/^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/);
  if (msMatch) {
    const ms = parseInt(msMatch[1], 10);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Format 2: DMTF / WMI datetime format: yyyymmddHHMMSS.mmmmmm±UUU
  // Example: 20240315000000.000000+000
  const dmtfMatch = trimmed.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d+))?(?:([+-])(\d+))?$/
  );
  if (dmtfMatch) {
    const year = parseInt(dmtfMatch[1], 10);
    const month = parseInt(dmtfMatch[2], 10) - 1;
    const day = parseInt(dmtfMatch[3], 10);
    const hour = parseInt(dmtfMatch[4], 10);
    const minute = parseInt(dmtfMatch[5], 10);
    const second = parseInt(dmtfMatch[6], 10);

    let ms = 0;
    if (dmtfMatch[7]) {
      const microStr = dmtfMatch[7].padEnd(3, '0').slice(0, 3);
      ms = parseInt(microStr, 10);
    }

    let offsetMinutes = 0;
    if (dmtfMatch[8] && dmtfMatch[9]) {
      const sign = dmtfMatch[8] === '-' ? -1 : 1;
      offsetMinutes = sign * parseInt(dmtfMatch[9], 10);
    }

    const utcTimestamp =
      Date.UTC(year, month, day, hour, minute, second, ms) -
      offsetMinutes * 60 * 1000;
    const d = new Date(utcTimestamp);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Fallback: standard ISO 8601 or date string
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Maps SMBIOS memory type codes to human-readable memory generation names.
 * Note: These are raw SMBIOS Type 17 Memory_Type values per DMTF SMBIOS specification,
 * mapped from Win32_PhysicalMemory.SMBIOSMemoryType.
 * DO NOT confuse with Win32_PhysicalMemory.MemoryType, which uses a different CIM-mapped numbering.
 *
 * @param code - SMBIOS memory type integer.
 * @returns Human-readable memory type label.
 */
export const smbiosMemoryType = (code: number): string => {
  switch (code) {
    case 18:
      return 'DDR';
    case 19:
      return 'DDR2';
    case 20:
      return 'DDR2 FB-DIMM';
    case 24:
      return 'DDR3';
    case 25:
      return 'FBD2';
    case 26:
      return 'DDR4';
    case 27:
      return 'LPDDR';
    case 28:
      return 'LPDDR2';
    case 29:
      return 'LPDDR3';
    case 30:
      return 'LPDDR4';
    case 31:
      return 'Logical non-volatile device';
    case 32:
      return 'HBM';
    case 33:
      return 'HBM2';
    case 34:
      return 'DDR5';
    case 35:
      return 'LPDDR5';
    default:
      return 'Unknown';
  }
};

/**
 * Maps MSFT_PhysicalDisk MediaType codes to friendly labels.
 * 3=HDD, 4=SSD, 5=SCM, else 'Unknown'.
 *
 * @param code - MSFT_PhysicalDisk MediaType integer.
 * @returns Media type label ('HDD', 'SSD', 'SCM', or 'Unknown').
 */
export const mediaTypeLabel = (code: number): string => {
  switch (code) {
    case 3:
      return 'HDD';
    case 4:
      return 'SSD';
    case 5:
      return 'SCM';
    default:
      return 'Unknown';
  }
};

/**
 * Maps MSFT_PhysicalDisk BusType codes to friendly bus interface labels.
 * 7=USB, 8=RAID, 11=SATA, 17=NVMe, else 'Unknown'.
 *
 * @param code - MSFT_PhysicalDisk BusType integer.
 * @returns Bus interface label ('USB', 'RAID', 'SATA', 'NVMe', or 'Unknown').
 */
export const busTypeLabel = (code: number): string => {
  switch (code) {
    case 7:
      return 'USB';
    case 8:
      return 'RAID';
    case 11:
      return 'SATA';
    case 17:
      return 'NVMe';
    default:
      return 'Unknown';
  }
};
