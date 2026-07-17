import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import {
  type BulletinData,
  type CategoryDates,
  type Country,
  type TableData,
  COLUMN_MAP,
  EB_CATEGORY_MAP,
  EB5_PATTERNS,
  FB_CATEGORY_MAP,
  MONTH_NAMES,
  MONTH_ABBR,
} from "./types";

/**
 * Build the URL for a given bulletin month.
 * Visa bulletins use fiscal year in the path (Oct = start of new FY).
 * Example: March 2026 → fiscal year 2026 → /2026/visa-bulletin-for-march-2026.html
 */
export function buildBulletinUrl(year: number, month: number): string {
  // Fiscal year: Oct-Dec of calendar year Y fall in FY Y+1
  const fiscalYear = month >= 10 ? year + 1 : year;
  const monthName = MONTH_NAMES[month - 1];
  return `https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin/${fiscalYear}/visa-bulletin-for-${monthName}-${year}.html`;
}

/**
 * Parse a date value from the bulletin HTML.
 * Input formats: "01JAN23", "C", "U", or whitespace variations.
 * Output: "2023-01-01", "C", or "U"
 */
export function parseDateValue(raw: string): string {
  const trimmed = raw.replace(/\s+/g, "").toUpperCase();

  if (trimmed === "C" || trimmed === "CURRENT") return "C";
  if (trimmed === "U" || trimmed === "UNAVAILABLE") return "U";

  // Match DDMMMYY format
  const match = trimmed.match(/^(\d{2})([A-Z]{3})(\d{2})$/);
  if (!match) {
    // Try to handle variations like "1JAN23" (single digit day)
    const match2 = trimmed.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
    if (!match2) return trimmed; // Return as-is if unrecognized
    const [, day, monthAbbr, yearShort] = match2;
    const monthNum = MONTH_ABBR[monthAbbr];
    if (!monthNum) return trimmed;
    const fullYear = parseInt(yearShort) >= 50 ? `19${yearShort}` : `20${yearShort}`;
    return `${fullYear}-${monthNum}-${day.padStart(2, "0")}`;
  }

  const [, day, monthAbbr, yearShort] = match;
  const monthNum = MONTH_ABBR[monthAbbr];
  if (!monthNum) return trimmed;
  // Assume 2000s for years < 50, 1900s for >= 50
  const fullYear = parseInt(yearShort) >= 50 ? `19${yearShort}` : `20${yearShort}`;
  return `${fullYear}-${monthNum}-${day}`;
}

/**
 * Normalize header text: collapse whitespace, remove &nbsp;, lowercase.
 */
function normalizeText(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Map a column header text to a Country key.
 */
function mapColumnToCountry(headerText: string): Country | null {
  const normalized = normalizeText(headerText);
  for (const [pattern, country] of Object.entries(COLUMN_MAP)) {
    if (normalized.includes(pattern)) return country;
  }
  return null;
}

/**
 * Map a row label to an EB category identifier.
 */
function mapEBCategory(label: string): string | null {
  const normalized = normalizeText(label);

  // Check 5th preference patterns first (they're longer/more specific)
  for (const [pattern, category] of EB5_PATTERNS) {
    if (pattern.test(label)) return category;
  }

  // Check simple mappings
  for (const [key, category] of Object.entries(EB_CATEGORY_MAP)) {
    if (normalized === key) return category;
  }

  return null;
}

/**
 * Map a row label to an FB category identifier.
 */
function mapFBCategory(label: string): string | null {
  const normalized = normalizeText(label);
  return FB_CATEGORY_MAP[normalized] ?? null;
}

interface ParsedTable {
  type: "family" | "employment";
  columns: (Country | null)[];
  rows: { category: string; dates: CategoryDates }[];
}

/**
 * Parse a single HTML table element into structured data.
 */
function parseTable(
  $: cheerio.CheerioAPI,
  table: AnyNode,
): ParsedTable | null {
  const rows = $(table).find("tr");
  if (rows.length < 2) return null;

  // Parse header row to determine table type and column mapping
  const headerCells = $(rows[0]).find("td, th");
  if (headerCells.length < 2) return null;

  const firstHeader = $(headerCells[0]).text();
  const isFamily = /family/i.test(firstHeader);
  const isEmployment = /employment/i.test(firstHeader);

  if (!isFamily && !isEmployment) return null;

  // Map columns 1..n to Country keys
  const columns: (Country | null)[] = [];
  for (let i = 1; i < headerCells.length; i++) {
    columns.push(mapColumnToCountry($(headerCells[i]).text()));
  }

  const type = isFamily ? "family" : "employment";
  const categoryMapper = isFamily ? mapFBCategory : mapEBCategory;

  // Parse data rows
  const dataRows: { category: string; dates: CategoryDates }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = $(rows[i]).find("td");
    if (cells.length < 2) continue;

    const label = $(cells[0]).text();
    const category = categoryMapper(label);
    if (!category) continue;

    const dates: CategoryDates = {
      allOther: "",
      china: "",
      india: "",
      mexico: "",
      philippines: "",
    };

    for (let j = 1; j < cells.length; j++) {
      const country = columns[j - 1];
      if (country) {
        dates[country] = parseDateValue($(cells[j]).text());
      }
    }

    dataRows.push({ category, dates });
  }

  return { type, columns, rows: dataRows };
}

/**
 * Default HTML fetcher: plain HTTP request.
 * NOTE: travel.state.gov is now behind Cloudflare bot protection, which returns
 * 403 to plain HTTP clients. Use the browser-based fetcher (see browser-fetch.ts,
 * `npm run scrape:local`) to actually pass the challenge.
 */
async function fetchHtmlPlain(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/**
 * Fetch and parse a visa bulletin page into structured data.
 * @param fetchHtml Optional HTML fetcher; defaults to a plain HTTP request.
 *                  Pass a browser-based fetcher to bypass Cloudflare.
 */
export async function scrapeBulletin(
  year: number,
  month: number,
  fetchHtml: (url: string) => Promise<string> = fetchHtmlPlain,
): Promise<BulletinData> {
  const url = buildBulletinUrl(year, month);
  const html = await fetchHtml(url);
  return parseBulletinHtml(html);
}

/**
 * Parse bulletin HTML string into structured BulletinData.
 * Exported for testing.
 */
export function parseBulletinHtml(html: string): BulletinData {
  const $ = cheerio.load(html);

  const result: BulletinData = {
    employmentBased: { finalActionDates: {}, datesForFiling: {} },
    familyBased: { finalActionDates: {}, datesForFiling: {} },
  };

  // Track how many tables of each type we've seen
  // First occurrence = Final Action Dates (Chart A), second = Dates for Filing (Chart B)
  const familyCount = { seen: 0 };
  const employmentCount = { seen: 0 };

  // Find all tables with border="1" (main data tables, not grid/noise tables)
  const tables = $("table").filter((_, el) => {
    const border = $(el).attr("border");
    return border === "1";
  });

  tables.each((_, tableEl) => {
    const parsed = parseTable($, tableEl);
    if (!parsed || parsed.rows.length === 0) return;

    const tableData: TableData = {};
    for (const row of parsed.rows) {
      tableData[row.category] = row.dates;
    }

    if (parsed.type === "family") {
      familyCount.seen++;
      if (familyCount.seen === 1) {
        result.familyBased.finalActionDates = tableData;
      } else if (familyCount.seen === 2) {
        result.familyBased.datesForFiling = tableData;
      }
    } else {
      employmentCount.seen++;
      if (employmentCount.seen === 1) {
        result.employmentBased.finalActionDates = tableData;
      } else if (employmentCount.seen === 2) {
        result.employmentBased.datesForFiling = tableData;
      }
    }
  });

  return result;
}

/**
 * Compute the difference in days between two date values.
 * Returns null if either is "C" or "U".
 */
export function computeDaysAdvanced(
  current: string,
  previous: string,
): number | null {
  if (current === "C" || current === "U" || previous === "C" || previous === "U") {
    return null;
  }
  const curr = new Date(current);
  const prev = new Date(previous);
  if (isNaN(curr.getTime()) || isNaN(prev.getTime())) return null;
  return Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
}
