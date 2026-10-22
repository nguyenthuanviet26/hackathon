import { Providers } from "./providers";

export const metadata = {
  title: "WorkSafe AI",
  description: "Cổng AI nội bộ: che dữ liệu khách hàng, nới quy tắc và mở lịch sử đều cần quorum admin",
};

// Be Vietnam Pro was drawn for Vietnamese: the stacked diacritics (ế, ợ, ữ) sit right instead of
// colliding. JetBrains Mono is only for text shown as the machine sees it.
const FONTS =
  "https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap";

const GLOBAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; padding: 1.5rem 16px 3rem; background: #F5F7FA; color: #0E1B2E;
         font-family: 'Be Vietnam Pro', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  h1, h2, h3 { letter-spacing: -0.01em; }
  a { color: #1D4ED8; }
  code { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.88em; }
  button:hover:not(:disabled) { filter: brightness(0.94); }
  button:disabled { cursor: not-allowed; }
  :focus-visible { outline: 2px solid #1D4ED8; outline-offset: 2px; border-radius: 4px; }
  ::selection { background: #C7D7FB; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
