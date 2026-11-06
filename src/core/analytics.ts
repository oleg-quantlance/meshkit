export const GA_MEASUREMENT_ID = 'G-5HR12TP216';
const CONSENT_STORAGE_KEY = 'meshkit-consent-v3';

export type ConsentChoice = 'granted' | 'denied';

export type FileSizeBucket = '<1' | '1-10' | '10-50' | '>50 MB';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const lastCalculateSentAt: Record<string, number> = {};

export function getFileSizeBucket(bytes: number): FileSizeBucket {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return '<1';
  if (mb <= 10) return '1-10';
  if (mb <= 50) return '10-50';
  return '>50 MB';
}

/**
 * Initializes Google Analytics 4 (G-5HR12TP216) with analytics enabled by default
 * and honors any explicit opt-out stored in localStorage (/privacy).
 */
export function initAnalyticsConsentMode(): void {
  if (typeof window === 'undefined') return;

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };

    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID);
  }

  let savedChoice: ConsentChoice | null = null;
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (raw === 'granted' || raw === 'denied') {
      savedChoice = raw;
    }
  } catch {
    // ignore storage errors
  }

  if (savedChoice === 'denied') {
    updateAnalyticsConsent('denied');
  }
}

export function updateAnalyticsConsent(choice: ConsentChoice): void {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('consent', 'update', {
      analytics_storage: choice,
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  }
  if (typeof document !== 'undefined') {
    const existingBanner = document.getElementById('meshkitConsentBanner');
    if (existingBanner) {
      existingBanner.remove();
    }
  }
}

function sendEvent(eventName: string, params: Record<string, string | number>): void {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', eventName, params);
  }
}

export function trackFileLoadSuccess(
  tool: string,
  fileType: string,
  byteSize: number,
  parseMs: number
): void {
  sendEvent('file_load_success', {
    tool,
    file_type: fileType,
    size_bucket: getFileSizeBucket(byteSize),
    parse_ms: Math.round(parseMs),
  });
}

export function trackFileLoadError(tool: string, errorCode: string): void {
  sendEvent('file_load_error', {
    tool,
    error_code: errorCode,
  });
}

export function trackCalculate(tool: string, channel?: string): void {
  const now = Date.now();
  const last = lastCalculateSentAt[tool] ?? 0;
  if (now - last < 10_000) return;
  lastCalculateSentAt[tool] = now;

  const params: Record<string, string> = { tool };
  if (channel) params.channel = channel;
  sendEvent('calculate', params);
}

export function trackExportDownload(tool: string, outputType: string): void {
  sendEvent('export_download', {
    tool,
    output_type: outputType,
  });
}

export function trackSampleLoad(tool: string): void {
  sendEvent('sample_load', { tool });
}

export function trackInternalToolLink(fromTool: string, toTool: string): void {
  sendEvent('internal_tool_link', {
    from_tool: fromTool,
    to_tool: toTool,
  });
}
