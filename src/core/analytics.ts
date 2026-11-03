export const GA_MEASUREMENT_ID = 'G-5HR12TP216';
const CONSENT_STORAGE_KEY = 'meshkit-consent-v2';

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
 * Initializes Google Analytics 4 with Consent Mode v2 (default denied).
 * The default consent command runs before any other tag.
 */
export function initAnalyticsConsentMode(): void {
  if (typeof window === 'undefined') return;

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };

    // Consent Mode v2 default: strictly denied before any tag loads
    window.gtag('consent', 'default', {
      ad_storage: 'denied',
      analytics_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      wait_for_update: 500,
    });

    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID, {
      anonymize_ip: true,
      send_page_view: true,
    });
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

  if (savedChoice === 'granted') {
    updateAnalyticsConsent('granted');
  } else if (savedChoice === null) {
    renderConsentBanner();
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

function renderConsentBanner(): void {
  if (typeof document === 'undefined' || document.getElementById('meshkitConsentBanner')) return;

  const banner = document.createElement('aside');
  banner.id = 'meshkitConsentBanner';
  banner.setAttribute('aria-label', 'Analytics consent');
  banner.style.cssText =
    'position:fixed;bottom:0;left:0;right:0;z-index:999;background:var(--bg-panel);border-top:2px solid var(--border-strong);padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;font-size:12px;';

  banner.innerHTML = `
    <div class="mono" style="color:var(--text-main);max-width:820px;">
      <strong>PRIVACY &amp; CONSENT MODE v2:</strong> MeshKit processes all 3D files locally in your browser (0 bytes uploaded). With your permission, we use anonymous Google Analytics 4 events (never file names or contents) to improve the calculators. <a href="/privacy" style="color:var(--accent);">Privacy Policy</a>
    </div>
    <div style="display:flex;gap:8px;">
      <button type="button" id="consentAcceptBtn" class="btn-primary">ACCEPT ANALYTICS</button>
      <button type="button" id="consentDeclineBtn" class="btn-secondary">DECLINE</button>
    </div>
  `;

  document.body.appendChild(banner);

  document.getElementById('consentAcceptBtn')?.addEventListener('click', () => {
    updateAnalyticsConsent('granted');
  });
  document.getElementById('consentDeclineBtn')?.addEventListener('click', () => {
    updateAnalyticsConsent('denied');
  });
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
