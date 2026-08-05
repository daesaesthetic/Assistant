import axios from "axios";
import { load } from "cheerio";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Search the web via DuckDuckGo HTML — no API key required.
 */
export async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    const response = await axios.post(
      "https://html.duckduckgo.com/html/",
      new URLSearchParams({ q: query, kl: "us-en" }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 12000,
      }
    );

    const $ = load(response.data as string);
    const results: SearchResult[] = [];

    $(".result").each((_i, el) => {
      if (results.length >= 5) return false;

      const titleEl = $(el).find(".result__title a");
      const snippetEl = $(el).find(".result__snippet");
      const urlEl = $(el).find(".result__url");

      const title = titleEl.text().trim();
      const snippet = snippetEl.text().trim();
      let url = urlEl.text().trim() || titleEl.attr("href") || "";

      // Strip DuckDuckGo redirect wrapper if present
      if (url.includes("//duckduckgo.com/l/")) {
        try {
          const qs = url.split("?")[1] ?? "";
          const extracted = new URLSearchParams(qs).get("uddg");
          if (extracted) url = decodeURIComponent(extracted);
        } catch {
          /* keep original */
        }
      }

      if (title && snippet) {
        results.push({ title, url: url || "https://duckduckgo.com", snippet });
      }
      return undefined;
    });

    return results;
  } catch (err) {
    console.error("[Search] DuckDuckGo request failed:", err);
    return [];
  }
}
