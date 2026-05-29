const MAX_PAGES = parseInt(process.env.AGENT_WEBSITE_CRAWL_MAX_PAGES, 10) || 4;
const MAX_CHARS_PER_PAGE = parseInt(process.env.AGENT_WEBSITE_CRAWL_MAX_CHARS_PER_PAGE, 10) || 12000;
const REQUEST_TIMEOUT_MS = parseInt(process.env.AGENT_WEBSITE_CRAWL_TIMEOUT_MS, 10) || 12000;

const preferredPathPattern = /\/(about|services|solutions|product|products|pricing|customers|case-stud|contact|features|platform|why|industries)/i;

const fetchWithTimeout = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'KaryaAI-Agent/1.0 (+https://karya.ai)'
      }
    });

    if (!response.ok) {
      throw new Error(`Website returned ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      throw new Error('Website did not return HTML content');
    }

    return response.text();
  } finally {
    clearTimeout(timer);
  }
};

const decodeHtml = (text = '') => text
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

const stripHtmlToText = (html = '') => decodeHtml(html)
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const extractTitle = (html = '') => {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return stripHtmlToText(title || '').slice(0, 160);
};

const extractMetaDescription = (html = '') => {
  const meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);
  return decodeHtml(meta?.[1] || '').trim().slice(0, 300);
};

const normalizeUrl = (href, baseUrl) => {
  try {
    const url = new URL(href, baseUrl);
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
};

const extractInternalLinks = (html = '', baseUrl) => {
  const base = new URL(baseUrl);
  const links = [];
  const anchorPattern = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match = anchorPattern.exec(html);

  while (match) {
    const normalized = normalizeUrl(match[1], baseUrl);
    if (normalized) {
      const parsed = new URL(normalized);
      if (parsed.hostname === base.hostname && parsed.protocol.startsWith('http')) {
        links.push(normalized);
      }
    }
    match = anchorPattern.exec(html);
  }

  return [...new Set(links)]
    .sort((left, right) => {
      const leftPreferred = preferredPathPattern.test(new URL(left).pathname) ? 0 : 1;
      const rightPreferred = preferredPathPattern.test(new URL(right).pathname) ? 0 : 1;
      return leftPreferred - rightPreferred;
    })
    .slice(0, MAX_PAGES - 1);
};

const crawlWebsite = async (url) => {
  const pages = [];
  const homeHtml = await fetchWithTimeout(url);
  const homeLinks = extractInternalLinks(homeHtml, url);
  const urlsToFetch = [url, ...homeLinks].slice(0, MAX_PAGES);

  for (const pageUrl of urlsToFetch) {
    try {
      const html = pageUrl === url ? homeHtml : await fetchWithTimeout(pageUrl);
      pages.push({
        url: pageUrl,
        title: extractTitle(html),
        metaDescription: extractMetaDescription(html),
        text: stripHtmlToText(html).slice(0, MAX_CHARS_PER_PAGE)
      });
    } catch (error) {
      pages.push({
        url: pageUrl,
        title: '',
        metaDescription: '',
        text: '',
        error: error.message
      });
    }
  }

  const extractedText = pages
    .map((page) => [
      `URL: ${page.url}`,
      page.title ? `Title: ${page.title}` : '',
      page.metaDescription ? `Description: ${page.metaDescription}` : '',
      page.text ? `Text: ${page.text}` : '',
      page.error ? `Error: ${page.error}` : ''
    ].filter(Boolean).join('\n'))
    .join('\n\n---\n\n');

  return {
    extractedText,
    pagesCrawled: pages.filter((page) => page.text).length,
    pages
  };
};

module.exports = {
  crawlWebsite
};
